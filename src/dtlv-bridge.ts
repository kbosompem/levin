import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import { parseEdn } from './utils/edn-parser';
import { formatQueryError } from './utils/error-formatter';

/** Release tag on kbosompem/babashka that binaries are downloaded from. */
const LEVIN_BB_RELEASE = 'levin-bb-v0.1.0';

/** Map node's platform/arch to a levin-bb release asset name, or null if unsupported. */
function levinBbAssetName(): string | null {
    const key = `${process.platform}-${process.arch}`;
    const assets: Record<string, string> = {
        'darwin-arm64': 'levin-bb-macos-aarch64.tar.gz',
        'darwin-x64': 'levin-bb-macos-x64.tar.gz',
        'linux-x64': 'levin-bb-linux-amd64.tar.gz',
        'linux-arm64': 'levin-bb-linux-aarch64.tar.gz'
    };
    return assets[key] ?? null;
}

/** Download a URL to a file, following redirects (GitHub releases redirect to a CDN). */
function downloadFile(url: string, dest: string, redirectsLeft: number = 5): Promise<void> {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'levin-vscode' } }, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                if (redirectsLeft <= 0) { reject(new Error('Too many redirects')); return; }
                downloadFile(res.headers.location, dest, redirectsLeft - 1).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`Download failed: HTTP ${res.statusCode} for ${url}`));
                return;
            }
            const out = fs.createWriteStream(dest);
            res.pipe(out);
            out.on('finish', () => out.close(() => resolve()));
            out.on('error', reject);
            res.on('error', reject);
        }).on('error', reject);
    });
}

export interface QueryResult {
    success: boolean;
    data?: unknown;
    error?: string;
    stdout?: string;
    stderr?: string;
}

export interface SchemaAttribute {
    attribute: string;
    valueType?: string;      // now includes 'vec'
    cardinality?: string;
    unique?: string;
    index?: boolean;
    fulltext?: boolean;
    isComponent?: boolean;
    // Vector fields
    vectorDimensions?: number;
    vectorMetricType?: string;
    vectorDomains?: string[];
}

export interface DatabaseInfo {
    path: string;
    name: string;
    exists: boolean;
    isRemote?: boolean;
}

export interface CreateDatabaseOptions {
    schema?: string;              // EDN schema map string
    autoEntityTime?: boolean;
    validateData?: boolean;
    closedSchema?: boolean;
    vectorOpts?: {
        dimensions: number;
        metricType?: string;
        quantization?: string;
        connectivity?: number;
        expansionAdd?: number;
        expansionSearch?: number;
    };
}

export interface VectorOpts {
    dimensions: number;
    metricType?: string;
}

/**
 * Server loop evaluated by the levin-bb binary (custom babashka build with
 * datalevin + core.logic baked in). Speaks newline-delimited JSON over stdio:
 *   request:  {"id": 1, "code": "(+ 1 2)"}
 *   response: {"id": 1, "ok": true, "result": "3", "out": ""}
 * Prints during eval are captured into "out" so they cannot corrupt the protocol.
 */
const BB_SERVER_SCRIPT = `
(require '[cheshire.core :as json])
(let [rdr (java.io.BufferedReader. *in*)]
  (loop []
    (when-let [line (.readLine rdr)]
      (let [{:strs [id code]} (try (json/parse-string line) (catch Exception _ nil))]
        (when id
          (let [sw (java.io.StringWriter.)
                resp (try
                       (let [v (binding [*out* sw] (load-string code))]
                         {:id id :ok true :result (pr-str v) :out (str sw)})
                       (catch Throwable t
                         {:id id :ok false
                          :err (or (ex-message t) (str (class t)))
                          :cause (some-> (ex-cause t) ex-message)
                          :out (str sw)}))]
            (println (json/generate-string resp))
            (flush))))
      (recur))))
`.trim();

interface BbResponse {
    id?: number;
    ok: boolean;
    result?: string;
    out?: string;
    err?: string;
    cause?: string;
}

/**
 * Long-lived levin-bb process. One instance serves all requests for the
 * session: no per-query process spawn, no repeated LMDB env open/close races.
 * If the process dies (or a request times out) it is killed and respawned on
 * the next request.
 */
class BbServer {
    private proc: import('child_process').ChildProcess | null = null;
    private buf = '';
    private nextId = 1;
    private pending = new Map<number, (resp: BbResponse) => void>();

    constructor(
        private binPath: string,
        private log: (message: string) => void,
        private requestTimeoutMs: number = 120000
    ) {}

    private ensureStarted(): boolean {
        if (this.proc && this.proc.exitCode === null) {
            return true;
        }
        try {
            this.proc = spawn(this.binPath, ['-e', BB_SERVER_SCRIPT], {
                env: { ...process.env }
            });
        } catch {
            this.proc = null;
            return false;
        }
        this.buf = '';
        this.proc.stdout?.on('data', (data) => this.onData(data.toString()));
        this.proc.stderr?.on('data', (data) => this.log('[levin-bb] ' + data.toString().trimEnd()));
        this.proc.on('close', (code) => {
            this.failAllPending(`levin-bb server exited (code ${code})`);
            this.proc = null;
        });
        this.proc.on('error', (error) => {
            this.failAllPending(`levin-bb server error: ${error.message}`);
            this.proc = null;
        });
        this.log(`[levin-bb] server started (pid ${this.proc.pid})`);
        return true;
    }

    private failAllPending(err: string): void {
        this.log('[levin-bb] ' + err);
        for (const cb of this.pending.values()) {
            cb({ ok: false, err });
        }
        this.pending.clear();
    }

    private onData(chunk: string): void {
        this.buf += chunk;
        let idx: number;
        while ((idx = this.buf.indexOf('\n')) >= 0) {
            const line = this.buf.slice(0, idx).trim();
            this.buf = this.buf.slice(idx + 1);
            if (!line) { continue; }
            try {
                const resp = JSON.parse(line) as BbResponse;
                if (resp.id !== undefined && this.pending.has(resp.id)) {
                    const cb = this.pending.get(resp.id)!;
                    this.pending.delete(resp.id);
                    cb(resp);
                }
            } catch {
                this.log('[levin-bb] unparseable server output: ' + line);
            }
        }
    }

    exec(code: string): Promise<BbResponse> {
        if (!this.ensureStarted() || !this.proc?.stdin?.writable) {
            return Promise.resolve({ ok: false, err: 'levin-bb server not available' });
        }
        const id = this.nextId++;
        return new Promise<BbResponse>((resolve) => {
            const timer = setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    this.log(`[levin-bb] request ${id} timed out; restarting server`);
                    this.proc?.kill();
                    this.proc = null;
                    resolve({ ok: false, err: `levin-bb request timed out after ${this.requestTimeoutMs}ms` });
                }
            }, this.requestTimeoutMs);
            this.pending.set(id, (resp) => {
                clearTimeout(timer);
                resolve(resp);
            });
            this.proc!.stdin!.write(JSON.stringify({ id, code }) + '\n');
        });
    }

    dispose(): void {
        this.proc?.kill();
        this.proc = null;
        this.pending.clear();
    }
}

export class DtlvBridge {
    private dtlvPath: string = 'dtlv';
    private bbPath: string = '';
    private backend: 'bb' | 'dtlv' = 'dtlv';
    private bbServer: BbServer | null = null;
    private storageDir: string = '';
    private openDatabases: Map<string, DatabaseInfo> = new Map();
    private outputChannel?: vscode.OutputChannel;

    /**
     * Per-database vector opts. Datalevin requires :vector-opts {:dimensions N}
     * on EVERY get-conn against a database that has :db.type/vec attributes;
     * they are connection-level and not recoverable from the database itself.
     */
    private vectorOptsByDb: Map<string, VectorOpts> = new Map();

    /** Persistence hook, wired by extension.ts to globalState */
    onVectorOptsChanged?: (dbPath: string, opts: VectorOpts) => void;

    // Mutex locks for remote connections to prevent "multiple LMDB connections" error
    private remoteLocks: Map<string, Promise<void>> = new Map();

    constructor(outputChannel?: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.loadSettings();
    }

    private loadSettings(): void {
        const config = vscode.workspace.getConfiguration('levin');
        this.dtlvPath = config.get<string>('dtlvPath', 'dtlv');
        this.bbPath = config.get<string>('bbPath', '');
    }

    /**
     * Probe a binary by running `<bin> --version` (no shell involved).
     */
    private probeBinary(bin: string): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                const proc = spawn(bin, ['--version']);
                proc.on('close', (code) => resolve(code === 0));
                proc.on('error', () => resolve(false));
            } catch {
                resolve(false);
            }
        });
    }

    /**
     * Where downloaded binaries live (the extension's globalStorage dir).
     * Wired by extension.ts during activation.
     */
    setStorageDir(dir: string): void {
        this.storageDir = dir;
    }

    /**
     * Find the levin-bb binary: explicit setting, then a previously
     * downloaded copy in globalStorage, then the copy bundled with the
     * extension (bin/levin-bb), then PATH.
     */
    private async resolveBbPath(): Promise<string | null> {
        const candidates = [
            this.bbPath,
            this.storageDir ? path.join(this.storageDir, 'levin-bb') : '',
            path.join(__dirname, '..', 'bin', 'levin-bb'),
            'levin-bb'
        ].filter(c => c && c.length > 0);
        for (const candidate of candidates) {
            if (await this.probeBinary(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    /**
     * Download the levin-bb binary for this platform into globalStorage
     * and activate the bb backend. Returns the binary path, or null when
     * the platform has no prebuilt binary or the download fails.
     */
    async downloadLevinBb(): Promise<string | null> {
        const asset = levinBbAssetName();
        if (!asset) {
            vscode.window.showWarningMessage(
                `No prebuilt levin-bb binary for ${process.platform}-${process.arch} yet; falling back to dtlv.`
            );
            return null;
        }
        if (!this.storageDir) {
            this.log('[levin-bb] no storage dir set; cannot download');
            return null;
        }
        const url = `https://github.com/kbosompem/babashka/releases/download/${LEVIN_BB_RELEASE}/${asset}`;
        const tarball = path.join(this.storageDir, asset);
        const binPath = path.join(this.storageDir, 'levin-bb');

        try {
            return await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Levin: downloading query engine (${LEVIN_BB_RELEASE}, ~70MB)…`,
                    cancellable: false
                },
                async () => {
                    fs.mkdirSync(this.storageDir, { recursive: true });
                    this.log(`[levin-bb] downloading ${url}`);
                    await downloadFile(url, tarball);
                    await new Promise<void>((resolve, reject) => {
                        const proc = spawn('tar', ['-xzf', tarball], { cwd: this.storageDir });
                        proc.on('close', (code) =>
                            code === 0 ? resolve() : reject(new Error(`tar exited with code ${code}`)));
                        proc.on('error', reject);
                    });
                    fs.rmSync(tarball, { force: true });
                    fs.chmodSync(binPath, 0o755);
                    if (!(await this.probeBinary(binPath))) {
                        throw new Error('downloaded binary failed to run');
                    }
                    this.bbPath = binPath;
                    this.backend = 'bb';
                    this.bbServer?.dispose();
                    this.bbServer = new BbServer(binPath, (m) => this.log(m));
                    this.log(`[levin-bb] installed at ${binPath}`);
                    vscode.window.showInformationMessage('Levin: query engine installed.');
                    return binPath;
                }
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`[levin-bb] download failed: ${message}`, true);
            vscode.window.showErrorMessage(`Levin: query engine download failed (${message}). Falling back to dtlv.`);
            return null;
        }
    }

    /**
     * Log message to output channel
     */
    private log(message: string, show: boolean = false): void {
        if (this.outputChannel) {
            this.outputChannel.appendLine(message);
            if (show) {
                this.outputChannel.show(true);
            }
        }
    }

    /**
     * Check if a query backend is available. Prefers the levin-bb custom
     * babashka build (long-lived server, datalevin + core.logic built in);
     * falls back to the dtlv CLI (spawn per query).
     */
    async checkDtlvInstalled(): Promise<boolean> {
        const bb = await this.resolveBbPath();
        if (bb) {
            this.bbPath = bb;
            this.backend = 'bb';
            if (!this.bbServer) {
                this.bbServer = new BbServer(bb, (m) => this.log(m));
            }
            this.log(`Backend: levin-bb (${bb})`);
            return true;
        }
        this.backend = 'dtlv';
        const dtlvOk = await new Promise<boolean>((resolve) => {
            const proc = spawn(this.dtlvPath, ['help'], { shell: true });
            proc.on('close', (code) => {
                if (code === 0) { this.log(`Backend: dtlv (${this.dtlvPath})`); }
                resolve(code === 0);
            });
            proc.on('error', () => resolve(false));
        });
        if (dtlvOk) {
            this.suggestBbUpgrade();
        }
        return dtlvOk;
    }

    private bbUpgradeSuggested = false;

    /**
     * dtlv works, but the levin-bb engine is faster (persistent process) and
     * adds core.logic. Offer the switch once per session, without blocking.
     */
    private suggestBbUpgrade(): void {
        if (this.bbUpgradeSuggested || !levinBbAssetName()) { return; }
        this.bbUpgradeSuggested = true;
        void vscode.window.showInformationMessage(
            'Levin can install its bundled query engine (faster queries, adds logic solving). Install now?',
            'Install',
            'Keep using dtlv'
        ).then((choice) => {
            if (choice === 'Install') {
                void this.downloadLevinBb();
            }
        });
    }

    /**
     * Shut down the long-lived levin-bb server, if any.
     */
    dispose(): void {
        this.bbServer?.dispose();
        this.bbServer = null;
    }

    /**
     * Show installation instructions if dtlv is not found
     */
    async promptInstallDtlv(): Promise<void> {
        const action = await vscode.window.showErrorMessage(
            'No query backend found. Download the levin-bb engine (recommended), or install the Datalevin CLI (dtlv).',
            'Download Engine',
            'Show Instructions',
            'Set Custom Path'
        );

        if (action === 'Download Engine') {
            await this.downloadLevinBb();
        } else if (action === 'Show Instructions') {
            vscode.env.openExternal(vscode.Uri.parse('https://github.com/juji-io/datalevin#installation'));
        } else if (action === 'Set Custom Path') {
            const customPath = await vscode.window.showInputBox({
                prompt: 'Enter full path to dtlv executable',
                placeHolder: '/usr/local/bin/dtlv'
            });
            if (customPath) {
                const config = vscode.workspace.getConfiguration('levin');
                await config.update('dtlvPath', customPath, vscode.ConfigurationTarget.Global);
                this.dtlvPath = customPath;
            }
        }
    }

    /**
     * Check if a path is a remote server URI
     */
    private isRemoteUri(dbPath: string): boolean {
        return dbPath.startsWith('dtlv://');
    }

    /**
     * Extract database name from remote URI or local path
     */
    private extractDatabaseName(dbPath: string): string {
        if (this.isRemoteUri(dbPath)) {
            // Extract database name from dtlv://[user:pass@]host:port/dbname
            const match = dbPath.match(/\/([^/?#]+)(?:[?#]|$)/);
            return match ? match[1] : 'remote-db';
        }
        return path.basename(dbPath);
    }

    /**
     * Open/register a database
     */
    openDatabase(dbPath: string): DatabaseInfo {
        const isRemote = this.isRemoteUri(dbPath);
        const resolvedPath = isRemote ? dbPath : this.resolvePath(dbPath);
        const name = this.extractDatabaseName(resolvedPath);

        const info: DatabaseInfo = {
            path: resolvedPath,
            name: name,
            exists: true, // We'll assume it exists when opened
            isRemote: isRemote
        };

        this.openDatabases.set(resolvedPath, info);
        return info;
    }

    /**
     * Close/unregister a database
     */
    closeDatabase(dbPath: string): void {
        const resolvedPath = this.isRemoteUri(dbPath) ? dbPath : this.resolvePath(dbPath);
        this.openDatabases.delete(resolvedPath);
    }

    /**
     * Get all open databases
     */
    getOpenDatabases(): DatabaseInfo[] {
        return Array.from(this.openDatabases.values());
    }

    /**
     * Remember vector opts for a database (needed on every get-conn).
     */
    setVectorOpts(dbPath: string, opts: VectorOpts): void {
        const resolved = this.isRemoteUri(dbPath) ? dbPath : this.resolvePath(dbPath);
        this.vectorOptsByDb.set(resolved, opts);
        this.onVectorOptsChanged?.(resolved, opts);
    }

    getVectorOpts(dbPath: string): VectorOpts | undefined {
        const resolved = this.isRemoteUri(dbPath) ? dbPath : this.resolvePath(dbPath);
        return this.vectorOptsByDb.get(resolved);
    }

    /**
     * Bulk-load persisted vector opts at activation.
     */
    loadVectorOpts(entries: Record<string, VectorOpts>): void {
        for (const [dbPath, opts] of Object.entries(entries)) {
            if (opts && typeof opts.dimensions === 'number') {
                this.vectorOptsByDb.set(dbPath, opts);
            }
        }
    }

    /**
     * Build the get-conn options map, including :vector-opts when known.
     */
    private connOpts(resolvedPath: string): string {
        const vo = this.vectorOptsByDb.get(resolvedPath);
        if (!vo) {
            return '{:mapsize 1000}';
        }
        const metric = vo.metricType ? ` :metric-type :${vo.metricType}` : '';
        return `{:mapsize 1000 :vector-opts {:dimensions ${vo.dimensions}${metric}}}`;
    }

    /**
     * Ask the user for vector dimensions/metric when a database with vector
     * attributes is opened without known opts.
     */
    private async promptVectorOpts(dbPath: string): Promise<VectorOpts | undefined> {
        const dimsInput = await vscode.window.showInputBox({
            prompt: `"${this.extractDatabaseName(dbPath)}" has vector attributes. Enter its vector dimensions to enable queries.`,
            placeHolder: 'e.g. 8, 384, 768, 1536',
            validateInput: v => {
                const n = parseInt(v, 10);
                return (!isNaN(n) && n > 0 && String(n) === v.trim()) ? null : 'Enter a positive integer';
            }
        });
        if (!dimsInput) {
            return undefined;
        }
        const metric = await vscode.window.showQuickPick(
            [
                { label: 'cosine', description: 'most common for embeddings' },
                { label: 'euclidean' },
                { label: 'dot' }
            ],
            { placeHolder: 'Distance metric used when the index was created' }
        );
        return { dimensions: parseInt(dimsInput, 10), metricType: metric?.label ?? 'cosine' };
    }

    /**
     * Check if a database exists by trying to get its stats
     */
    async databaseExists(dbPath: string): Promise<boolean> {
        const resolvedPath = this.isRemoteUri(dbPath) ? dbPath : this.resolvePath(dbPath);
        const result = await this.runCode(resolvedPath, '(datalevin.core/schema conn)');
        return result.success;
    }

    /**
     * Create a new database
     */
    async createDatabase(dbPath: string, options?: CreateDatabaseOptions): Promise<QueryResult> {
        const resolvedPath = this.isRemoteUri(dbPath) ? dbPath : this.resolvePath(dbPath);

        // Build schema arg
        const schemaArg = options?.schema || '{}';

        // Build options map
        const optParts: string[] = [];
        if (options?.autoEntityTime) { optParts.push(':auto-entity-time? true'); }
        if (options?.validateData) { optParts.push(':validate-data? true'); }
        if (options?.closedSchema) { optParts.push(':closed-schema? true'); }
        if (options?.vectorOpts) {
            const vo = options.vectorOpts;
            const voParts: string[] = [`:dimensions ${vo.dimensions}`];
            if (vo.metricType) { voParts.push(`:metric-type :${vo.metricType}`); }
            if (vo.quantization) { voParts.push(`:quantization :${vo.quantization}`); }
            if (vo.connectivity) { voParts.push(`:connectivity ${vo.connectivity}`); }
            if (vo.expansionAdd) { voParts.push(`:expansion-add ${vo.expansionAdd}`); }
            if (vo.expansionSearch) { voParts.push(`:expansion-search ${vo.expansionSearch}`); }
            optParts.push(`:vector-opts {${voParts.join(' ')}}`);
        }

        const optsArg = optParts.length > 0 ? `{${optParts.join(' ')}}` : '{}';

        const code = `
            (let [conn (datalevin.core/get-conn "${this.escapeString(resolvedPath)}" ${schemaArg} ${optsArg})]
              (datalevin.core/close conn)
              {:created true :path "${this.escapeString(resolvedPath)}"})
        `.trim();

        const result = await this.execDtlv(code);

        if (result.success) {
            this.openDatabase(resolvedPath);
            if (options?.vectorOpts) {
                this.setVectorOpts(resolvedPath, {
                    dimensions: options.vectorOpts.dimensions,
                    metricType: options.vectorOpts.metricType
                });
            }
        }

        return result;
    }

    /**
     * Execute a Datalog query
     */
    async query(dbPath: string, queryStr: string): Promise<QueryResult> {
        return this.runCode(dbPath, `(datalevin.core/q '${queryStr} @conn)`);
    }

    /**
     * Execute a query and return parsed results.
     * Optional inputs support `.dtlv.edn` statement keys:
     *   :rules ["name" ...] | :all  - stored rule bodies passed as the % input
     *   :args  [edn ...]            - extra values passed to d/q after @conn, in order
     */
    async runQuery(
        dbPath: string,
        query: string,
        limit: number = 100,
        inputs?: { rules?: string[] | 'all'; args?: string[] }
    ): Promise<QueryResult> {
        const argsEdn = inputs?.args?.length ? ' ' + inputs.args.join(' ') : '';
        const shape = `
              {:total (count results)
               :truncated (> (count results) ${limit})
               :results (vec (take ${limit} results))}
        `.trim();

        let code: string;
        if (inputs?.rules) {
            const named = inputs.rules !== 'all';
            const bodiesQuery = named
                ? `[:find ?body
                    :in $ [?name ...]
                    :where
                    [?e :levin.rule/name ?name]
                    [?e :levin.rule/body ?body]]`
                : `[:find ?body
                    :where
                    [?e :levin.rule/body ?body]]`;
            const namesEdn = named
                ? ' [' + (inputs.rules as string[]).map(n => `"${this.escapeString(n)}"`).join(' ') + ']'
                : '';
            code = `
            (let [rule-bodies (datalevin.core/q '${bodiesQuery} @conn${namesEdn})
                  rules (->> rule-bodies
                             (map first)
                             (map read-string)
                             (apply concat)
                             vec)
                  results (datalevin.core/q '${query} @conn rules${argsEdn})]
              ${shape})
            `.trim();
        } else {
            code = `
            (let [results (datalevin.core/q '${query} @conn${argsEdn})]
              ${shape})
            `.trim();
        }

        return this.runCode(dbPath, code);
    }

    /**
     * Get database schema using datalevin.core/schema
     * This returns the schema map directly (not queryable entities like Datomic)
     */
    async getSchema(dbPath: string): Promise<SchemaAttribute[]> {
        const code = `
            (let [schema (datalevin.core/schema conn)]
              (->> schema
                   (map (fn [[attr props]]
                          {:attribute (str attr)
                           :valueType (some-> (:db/valueType props) name)
                           :cardinality (some-> (:db/cardinality props) name)
                           :unique (some-> (:db/unique props) name)
                           :index (:db/index props)
                           :fulltext (:db/fulltext props)
                           :isComponent (:db/isComponent props)
                           :vectorDomains (some-> (:db.vec/domains props) vec)}))
                   (sort-by :attribute)
                   vec))
        `.trim();

        const result = await this.runCode(dbPath, code);

        if (result.success && result.data) {
            return result.data as SchemaAttribute[];
        }

        return [];
    }

    /**
     * Get entity counts by namespace
     */
    async getEntityCounts(dbPath: string): Promise<Array<{namespace: string; count: number}>> {
        const code = `
            (->> (datalevin.core/q '[:find ?a :where [_ ?a _]] @conn)
                 (map first)
                 (map namespace)
                 (remove nil?)
                 frequencies
                 (map (fn [[ns cnt]] {:namespace ns :count cnt}))
                 (sort-by :namespace)
                 vec)
        `.trim();

        const result = await this.runCode(dbPath, code);

        if (result.success && result.data) {
            return result.data as Array<{namespace: string; count: number}>;
        }

        return [];
    }

    /**
     * Get entity by ID, including ref attribute info and outgoing references
     */
    async getEntity(dbPath: string, entityId: number): Promise<QueryResult> {
        // Pull entity, identify refs, and find what this entity references
        // Note: Datalevin returns refs as {:db/id N} maps, so we need to extract the ID
        const code = `
            (let [db @conn
                  result (datalevin.core/pull db '[*] ${entityId})
                  attrs (dissoc result :db/id)
                  ;; Find which attributes are ref type from schema
                  schema (datalevin.core/schema conn)
                  ref-attr-set (->> schema
                                    (filter (fn [[_ props]] (= :db.type/ref (:db/valueType props))))
                                    (map first)
                                    set)
                  ;; Helper to extract entity ID from ref (could be {:db/id N} or just N)
                  extract-id (fn [v]
                               (cond
                                 (number? v) v
                                 (and (map? v) (:db/id v)) (:db/id v)
                                 :else nil))
                  ;; Normalize attrs: replace {:db/id N} with just N for display (one level)
                  normalize-one (fn [v]
                                  (if (and (map? v) (:db/id v) (= (count v) 1))
                                    (:db/id v)
                                    v))
                  normalize-val (fn [v]
                                  (if (sequential? v)
                                    (mapv normalize-one v)
                                    (normalize-one v)))
                  normalized-attrs (into {} (map (fn [[k v]] [k (normalize-val v)]) attrs))
                  ;; For each ref attribute on this entity, get the referenced entity preview
                  refs-out (for [[attr val] attrs
                                 :when (contains? ref-attr-set attr)
                                 :let [;; Handle single value or collection
                                       vals (if (sequential? val) val [val])
                                       ;; Extract IDs from {:db/id N} maps
                                       ids (keep extract-id vals)]]
                             (for [ref-id ids
                                   :let [ref-entity (datalevin.core/pull db '[*] ref-id)
                                         ref-attrs (dissoc ref-entity :db/id)
                                         preview (some->> ref-attrs first ((fn [[k v]] (str k " " v))))
                                         ns (some->> ref-attrs keys (map namespace) (remove nil?) first)]]
                               {:id ref-id
                                :attribute (str attr)
                                :namespace ns
                                :preview preview}))]
              {:eid ${entityId}
               :attributes normalized-attrs
               :refAttributes (vec (map str ref-attr-set))
               :references (vec (flatten refs-out))})
        `.trim();

        return this.runCode(dbPath, code);
    }

    /**
     * Execute a transaction
     */
    async transact(dbPath: string, txData: string): Promise<QueryResult> {
        const code = `
            (let [result (datalevin.core/transact! conn ${txData})]
              {:tx-id (:max-tx result)
               :tempids (:tempids result)
               :datoms-count (count (:tx-data result))})
        `.trim();

        return this.runCode(dbPath, code);
    }

    /**
     * Add schema attribute
     */
    async addSchema(dbPath: string, attr: {
        attribute: string;
        valueType: string;
        cardinality: string;
        index?: boolean;
        unique?: string;
        fulltext?: boolean;
        isComponent?: boolean;
        vectorDomains?: string[];
    }): Promise<QueryResult> {
        let schemaMap = `{:db/ident :${attr.attribute}
                          :db/valueType :db.type/${attr.valueType}
                          :db/cardinality :db.cardinality/${attr.cardinality}`;

        if (attr.index) { schemaMap += ' :db/index true'; }
        if (attr.unique) { schemaMap += ` :db/unique :db.unique/${attr.unique}`; }
        if (attr.fulltext) { schemaMap += ' :db/fulltext true'; }
        if (attr.isComponent) { schemaMap += ' :db/isComponent true'; }
        if (attr.vectorDomains && attr.vectorDomains.length > 0) {
            const domains = attr.vectorDomains.map(d => `"${d}"`).join(' ');
            schemaMap += ` :db.vec/domains [${domains}]`;
        }

        schemaMap += '}';

        return this.transact(dbPath, `[${schemaMap}]`);
    }

    /**
     * Convert and transact Datomic-style schema directly
     * Datomic: {:movie/title {:db/valueType :db.type/string ...}}
     * Converts and transacts as: [{:db/ident :movie/title :db/valueType :db.type/string ...}]
     */
    async transactDatomicSchema(dbPath: string, schemaEdn: string): Promise<QueryResult> {
        const resolvedPath = this.isRemoteUri(dbPath) ? dbPath : this.resolvePath(dbPath);

        // Convert and transact in one step to avoid string escaping issues
        const code = `
            (let [conn (datalevin.core/get-conn "${this.escapeString(resolvedPath)}" {} ${this.connOpts(resolvedPath)})
                  datomic-schema ${schemaEdn}
                  datalevin-schema (->> datomic-schema
                                        (map (fn [[attr props]]
                                               (-> props
                                                   (assoc :db/ident attr)
                                                   (dissoc :db.install/_attribute))))
                                        vec)
                  result (datalevin.core/transact! conn datalevin-schema)]
              (datalevin.core/close conn)
              {:tx-id (:max-tx result)
               :datoms-count (count (:tx-data result))
               :schema-count (count datalevin-schema)})
        `.trim();

        return this.execDtlv(code);
    }

    /**
     * Import data with proper temp ID resolution.
     * Datalevin requires schema to be known at connection time for temp IDs to resolve.
     * This method gets schema via datalevin.core/schema, then reopens with it to transact data.
     */
    async importWithTempIds(dbPath: string, dataEdn: string): Promise<QueryResult> {
        const resolvedPath = this.isRemoteUri(dbPath) ? dbPath : this.resolvePath(dbPath);

        // Get schema from database, then reopen with it for proper temp ID resolution
        const code = `
            (let [;; Get schema via schema fn
                  conn1 (datalevin.core/get-conn "${this.escapeString(resolvedPath)}" {} ${this.connOpts(resolvedPath)})
                  schema-map (datalevin.core/schema conn1)
                  _ (datalevin.core/close conn1)
                  ;; Reopen with schema for proper temp ID resolution
                  conn2 (datalevin.core/get-conn "${this.escapeString(resolvedPath)}" schema-map ${this.connOpts(resolvedPath)})
                  result (datalevin.core/transact! conn2 ${dataEdn})]
              (datalevin.core/close conn2)
              {:tx-id (:max-tx result)
               :tempids (:tempids result)
               :datoms-count (count (:tx-data result))})
        `.trim();

        return this.execDtlv(code);
    }

    /**
     * Get sample values for an attribute
     */
    async getSampleValues(dbPath: string, attribute: string, limit: number = 10): Promise<unknown[]> {
        const code = `
            (->> (datalevin.core/q '[:find ?v :where [_ :${attribute} ?v]] @conn)
                 (map first)
                 (take ${limit})
                 vec)
        `.trim();

        const result = await this.runCode(dbPath, code);

        if (result.success && result.data) {
            return result.data as unknown[];
        }

        return [];
    }

    /**
     * Get all attributes for autocomplete
     */
    async getAttributes(dbPath: string): Promise<string[]> {
        const code = `
            (->> (datalevin.core/schema conn)
                 keys
                 (map str)
                 sort
                 vec)
        `.trim();

        const result = await this.runCode(dbPath, code);

        if (result.success && result.data) {
            return result.data as string[];
        }

        return [];
    }

    /**
     * Get database stats
     */
    async getStats(dbPath: string): Promise<QueryResult> {
        const code = `
            {:datom-count (count (datalevin.core/q '[:find ?e ?a ?v :where [?e ?a ?v]] @conn))
             :schema-count (count (datalevin.core/schema conn))}
        `.trim();

        return this.runCode(dbPath, code);
    }

    /**
     * Query all entities with a preview (first non-db attribute value)
     */
    async queryEntitiesWithPreview(dbPath: string): Promise<QueryResult> {
        const code = `
            (let [db @conn
                  ;; Get all unique entity IDs
                  eids (datalevin.core/q '[:find ?e :where [?e _ _]] db)
                  ;; For each entity, get first attribute and namespace
                  entities (->> eids
                                (map first)
                                (map (fn [eid]
                                       (let [entity (datalevin.core/pull db '[*] eid)
                                             attrs (dissoc entity :db/id)
                                             first-attr (first attrs)
                                             ns (some->> (keys attrs)
                                                         (map namespace)
                                                         (remove nil?)
                                                         first)]
                                         {:id eid
                                          :namespace ns
                                          :preview (when first-attr
                                                     (str (first first-attr) " " (second first-attr)))})))
                                (sort-by :id)
                                vec)]
              entities)
        `.trim();

        return this.runCode(dbPath, code);
    }

    /**
     * Get all ref-type attributes (for relationships panel)
     */
    async getRefAttributes(dbPath: string): Promise<QueryResult> {
        const code = `
            (let [schema (datalevin.core/schema conn)
                  ;; Filter attributes with ref valueType from schema
                  ref-attrs (->> schema
                                 (filter (fn [[_ props]] (= :db.type/ref (:db/valueType props)))))]
              (->> ref-attrs
                   (map (fn [[attr props]]
                          {:attribute (str attr)
                           :cardinality (name (or (:db/cardinality props) :db.cardinality/one))
                           :isComponent (or (:db/isComponent props) false)}))
                   (sort-by :attribute)
                   vec))
        `.trim();

        return this.runCode(dbPath, code);
    }

    /**
     * Discover actual ref targets by querying data.
     * For each ref attribute, find what namespaces the referenced entities belong to.
     * Returns: [{:attribute ":movie/cast" :source "movie" :targets ["person"]}]
     */
    async discoverRefTargets(dbPath: string): Promise<QueryResult> {
        const code = `
            (let [db @conn
                  schema (datalevin.core/schema conn)
                  ;; Get all ref attributes from schema
                  ref-attrs (->> schema
                                 (filter (fn [[_ props]] (= :db.type/ref (:db/valueType props))))
                                 (map first))
                  ;; For each ref attr, find target entity namespaces from actual data
                  results (for [attr ref-attrs
                                :let [;; Query: find namespaces of attributes on referenced entities
                                      targets (datalevin.core/q '[:find ?target-ns
                                                                  :in $ ?ref-attr
                                                                  :where
                                                                  [?e ?ref-attr ?ref]
                                                                  [?ref ?target-attr _]
                                                                  [(namespace ?target-attr) ?target-ns]
                                                                  [(some? ?target-ns)]]
                                                                db attr)
                                      target-nses (->> targets (map first) distinct sort vec)
                                      source-ns (namespace attr)
                                      props (get schema attr)]]
                            {:attribute (str attr)
                             :source source-ns
                             :targets target-nses
                             :cardinality (name (or (:db/cardinality props) :db.cardinality/one))})]
              (vec results))
        `.trim();

        return this.runCode(dbPath, code);
    }

    /**
     * Execute a :solve statement: run the query, then pick `pick` rows
     * satisfying every :such-that constraint. Declarative constraints:
     *   [:distinct ?v]          picked values of ?v all differ
     *   [:same ?v]              picked values of ?v all equal
     *   [(< (sum ?v) 30)]       predicate over aggregates: sum/max/min/avg/gap/count
     *   [(< ?v 20)]             bare ?v = predicate applies to every picked row
     * Returns {:total :truncated :find-vars :results} where each result row is
     * [solution-number & row], so existing table rendering works unchanged.
     */
    async solve(dbPath: string, stmt: {
        solveText: string; pickText?: string; suchThatText?: string; limit?: number;
    }): Promise<QueryResult> {
        const pick = parseInt(stmt.pickText ?? '', 10);
        if (isNaN(pick) || pick < 1) {
            return { success: false, error: 'A :solve statement needs :pick <n> (how many rows to choose).' };
        }
        const limit = stmt.limit ?? 5;
        const constraints = stmt.suchThatText ?? '[]';

        const code = `
            (let [q '${stmt.solveText}
                  cs '${constraints}
                  pick ${pick}
                  lim ${limit}
                  fvars (vec (take-while symbol? (rest q)))
                  rows (vec (datalevin.core/q q @conn))
                  _ (when (> (count rows) 400)
                      (throw (ex-info (str "Too many candidates for :solve (" (count rows)
                                           "); narrow the query with :where clauses") {})))
                  col (zipmap fvars (range))
                  pvar? (fn [x] (and (symbol? x) (clojure.string/starts-with? (name x) "?")))
                  vals-of (fn [sel v]
                            (if-not (contains? col v)
                              (throw (ex-info (str "Unknown variable " v " in :such-that") {}))
                              (mapv #(nth % (col v)) sel)))
                  agg (fn [sel [f v]]
                        (case f
                          sum   (reduce + (vals-of sel v))
                          max   (apply max (vals-of sel v))
                          min   (apply min (vals-of sel v))
                          avg   (/ (reduce + (vals-of sel v)) (double (count sel)))
                          gap   (- (apply max (vals-of sel v)) (apply min (vals-of sel v)))
                          count (count sel)
                          (throw (ex-info (str "Unknown aggregate " f " (use sum/max/min/avg/gap/count)") {}))))
                  ops {'< < '<= <= '> > '>= >= '= = 'not= not=}
                  ok? (fn [sel c]
                        (cond
                          (= :distinct (first c)) (apply distinct? (vals-of sel (second c)))
                          (= :same (first c))     (apply = (vals-of sel (second c)))
                          (seq? (first c))
                          (let [[op & args] (first c)
                                f (or (ops op)
                                      (throw (ex-info (str "Unknown predicate " op " (use < <= > >= = not=)") {})))]
                            (if (some pvar? args)
                              (every? (fn [row]
                                        (apply f (map #(cond (pvar? %) (nth row (col %))
                                                             (seq? %) (agg sel %)
                                                             :else %)
                                                      args)))
                                      sel)
                              (apply f (map #(if (seq? %) (agg sel %) %) args))))
                          :else (throw (ex-info (str "Unknown constraint " (pr-str c)) {}))))
                  combos (fn combos [start k]
                           (if (zero? k)
                             '(())
                             (for [i (range start (count rows))
                                   t (combos (inc i) (dec k))]
                               (cons i t))))
                  sols (->> (combos 0 pick)
                            (map (fn [is] (mapv rows is)))
                            (filter (fn [sel] (every? #(ok? sel %) cs)))
                            (take (inc lim)))
                  shown (vec (take lim sols))]
              {:total (count shown)
               :truncated (> (count sols) lim)
               :findVars (mapv name fvars)
               :results (vec (for [[i sel] (map-indexed vector shown)
                                   row sel]
                               (into [(inc i)] row)))})
        `.trim();

        return this.runCode(dbPath, code);
    }

    /**
     * Run code with a database connection
     * This wraps the code with connection setup/teardown
     */
    private async runCode(dbPath: string, code: string): Promise<QueryResult> {
        const resolvedPath = this.isRemoteUri(dbPath) ? dbPath : this.resolvePath(dbPath);

        // Use fully qualified names to avoid shadowing issues in dtlv's sci environment
        const wrap = (opts: string) => `
            (let [conn (datalevin.core/get-conn "${this.escapeString(resolvedPath)}" {} ${opts})]
              (try
                ${code}
                (finally (datalevin.core/close conn))))
        `.trim();

        let result = await this.execDtlv(wrap(this.connOpts(resolvedPath)));

        // A database with vector attributes fails every get-conn without
        // :vector-opts. Ask once, remember, and retry.
        if (!result.success &&
            result.error?.includes(':dimensions is required') &&
            !this.vectorOptsByDb.has(resolvedPath)) {
            const opts = await this.promptVectorOpts(resolvedPath);
            if (opts) {
                this.setVectorOpts(resolvedPath, opts);
                result = await this.execDtlv(wrap(this.connOpts(resolvedPath)));
            }
        }

        return result;
    }

    /**
     * Public wrapper for running code with a database connection
     * Used by panels that need to execute custom queries
     */
    async runCode_public(dbPath: string, code: string): Promise<QueryResult> {
        return this.runCode(dbPath, code);
    }

    /**
     * Acquire a lock for a remote database connection
     * This ensures only one query runs at a time per remote host/db
     */
    private async acquireRemoteLock(lockKey: string): Promise<() => void> {
        // Wait for any existing lock to be released
        while (this.remoteLocks.has(lockKey)) {
            await this.remoteLocks.get(lockKey);
        }

        // Create a new lock with a resolver we can call to release it
        let releaseLock: () => void;
        const lockPromise = new Promise<void>(resolve => {
            releaseLock = resolve;
        });
        this.remoteLocks.set(lockKey, lockPromise);

        // Return the release function
        return () => {
            this.remoteLocks.delete(lockKey);
            releaseLock!();
        };
    }

    /**
     * Execute dtlv command with code
     * For remote connections, requests are serialized to prevent "multiple LMDB connections" error
     */
    private async execDtlv(code: string, retries: number = 0, maxRetries: number = 3): Promise<QueryResult> {
        // Check if this is a remote connection
        const isRemote = code.includes('dtlv://');

        // Extract database path for lock key (host + db name)
        const dbMatch = code.match(/dtlv:\/\/[^"]+/);
        const lockKey = dbMatch ? dbMatch[0] : null;

        // Acquire lock for remote connections (only on first attempt)
        let releaseLock: (() => void) | null = null;
        if (isRemote && lockKey && retries === 0) {
            releaseLock = await this.acquireRemoteLock(lockKey);
        }

        try {
            // Only log full query on first attempt
            if (retries === 0) {
                this.log('\n' + '='.repeat(60));
                this.log(`[${new Date().toISOString()}] Executing query...`);
                this.log('Code:\n' + code);
                this.log('='.repeat(60));
            }

            const result = await this.execDtlvInternal(code);

            // Check if this is a remote connection failure
            const isRemoteConnectionError = result.error && (
                result.error.includes('Connection refused') ||
                result.error.includes('Unable to connect') ||
                result.error.includes('java.net.ConnectException') ||
                result.error.includes('Connection error')
            );

            // Also check for the "multiple connections" error - this means we need to retry
            const isMultipleConnectionError = result.error &&
                result.error.includes('multiple LMDB connections');

            if (!result.success && (isRemoteConnectionError || isMultipleConnectionError) && retries < maxRetries) {
                const attempt = retries + 1;
                this.log(`⚠️  Retry ${attempt}/${maxRetries}...`);

                // Wait before retrying (exponential backoff)
                const delay = Math.min(1000 * Math.pow(2, retries), 5000);
                await new Promise(resolve => setTimeout(resolve, delay));

                // Release lock before retry so retry can acquire it
                if (releaseLock) {
                    releaseLock();
                    releaseLock = null;
                }

                return this.execDtlv(code, retries + 1, maxRetries);
            }

            // Log the result
            if (result.success) {
                this.log('\n✓ Success');
                this.log('Result:\n' + JSON.stringify(result.data, null, 2));
            } else {
                // Log a one-line summary only - the full stack trace lives in the error panel
                this.log('\n✗ Error: ' + formatQueryError(result.error || '').summary, true);
                this.log('  (full error details shown in the Query Error panel)');

                if ((isRemoteConnectionError || isMultipleConnectionError) && retries >= maxRetries) {
                    vscode.window.showErrorMessage(
                        `Failed to connect to remote database after ${maxRetries} retries. Check connection and credentials.`
                    );
                }
            }

            return result;
        } finally {
            // Always release the lock
            if (releaseLock) {
                releaseLock();
            }
        }
    }

    /**
     * Internal method to execute code via the active backend (single attempt)
     */
    private async execDtlvInternal(code: string): Promise<QueryResult> {
        if (this.backend === 'bb' && this.bbServer) {
            const resp = await this.bbServer.exec(code);
            if (resp.ok) {
                const raw = resp.result ?? '';
                try {
                    return {
                        success: true,
                        data: parseEdn(raw),
                        stdout: (resp.out ?? '') + raw,
                        stderr: ''
                    };
                } catch {
                    return { success: true, data: raw, stdout: (resp.out ?? '') + raw, stderr: '' };
                }
            }
            const error = [resp.err, resp.cause].filter(Boolean).join('\n');
            return { success: false, error, stdout: resp.out ?? '', stderr: error };
        }
        return this.execDtlvSpawn(code);
    }

    /**
     * Legacy backend: spawn a dtlv process per request
     */
    private execDtlvSpawn(code: string): Promise<QueryResult> {
        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';

            // Use single quotes for shell, escape any single quotes in code
            const escapedCode = code.replace(/'/g, "'\"'\"'");
            const fullCommand = `${this.dtlvPath} exec '${escapedCode}'`;

            const proc = spawn('sh', ['-c', fullCommand], {
                env: { ...process.env }
            });

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    try {
                        // dtlv sometimes prints intermediate nil values
                        // We want the LAST value in the output
                        const trimmed = stdout.trim();
                        const lines = trimmed.split('\n').filter(l => l.trim().length > 0);
                        const lastLine = lines.length > 0 ? lines[lines.length - 1] : trimmed;

                        const parsed = parseEdn(lastLine);
                        resolve({
                            success: true,
                            data: parsed,
                            stdout,
                            stderr
                        });
                    } catch {
                        resolve({
                            success: true,
                            data: stdout.trim(),
                            stdout,
                            stderr
                        });
                    }
                } else {
                    resolve({
                        success: false,
                        error: stderr || stdout || `Exit code: ${code}`,
                        stdout,
                        stderr
                    });
                }
            });

            proc.on('error', (error) => {
                resolve({
                    success: false,
                    error: error.message
                });
            });
        });
    }

    /**
     * Escape string for use in Clojure code
     */
    private escapeString(str: string): string {
        return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    /**
     * Resolve path (expand ~, etc)
     */
    private resolvePath(dbPath: string): string {
        if (dbPath.startsWith('~')) {
            const homedir = process.env.HOME || process.env.USERPROFILE || '';
            return path.join(homedir, dbPath.slice(1));
        }
        return path.resolve(dbPath);
    }

    // ==================== RULES MANAGEMENT ====================

    /**
     * Ensure the rules schema exists in the database
     */
    async ensureRulesSchema(dbPath: string): Promise<QueryResult> {
        const code = `
            (let [schema (datalevin.core/schema conn)
                  has-rules? (contains? schema :levin.rule/name)]
              (when-not has-rules?
                (datalevin.core/transact! conn
                  [{:db/ident :levin.rule/name
                    :db/valueType :db.type/string
                    :db/cardinality :db.cardinality/one
                    :db/unique :db.unique/identity}
                   {:db/ident :levin.rule/body
                    :db/valueType :db.type/string
                    :db/cardinality :db.cardinality/one}
                   {:db/ident :levin.rule/description
                    :db/valueType :db.type/string
                    :db/cardinality :db.cardinality/one}]))
              {:success true :had-schema has-rules?})
        `.trim();

        return this.runCode(dbPath, code);
    }

    /**
     * Get all stored rules
     */
    async getRules(dbPath: string): Promise<QueryResult> {
        const code = `
            (let [db @conn
                  rules (datalevin.core/q '[:find ?e ?name ?body ?desc
                                            :where
                                            [?e :levin.rule/name ?name]
                                            [?e :levin.rule/body ?body]
                                            [(get-else $ ?e :levin.rule/description "") ?desc]]
                                          db)]
              (->> rules
                   (map (fn [[eid name body desc]]
                          {:eid eid
                           :name name
                           :body body
                           :description desc}))
                   (sort-by :name)
                   vec))
        `.trim();

        return this.runCode(dbPath, code);
    }

    /**
     * Save a rule (create or update)
     */
    async saveRule(dbPath: string, name: string, body: string, description?: string): Promise<QueryResult> {
        // First ensure schema exists
        await this.ensureRulesSchema(dbPath);

        const descPart = description ? `:levin.rule/description "${this.escapeString(description)}"` : '';
        const code = `
            (datalevin.core/transact! conn
              [{:levin.rule/name "${this.escapeString(name)}"
                :levin.rule/body "${this.escapeString(body)}"
                ${descPart}}])
        `.trim();

        return this.runCode(dbPath, code);
    }

    /**
     * Delete a rule by name
     */
    async deleteRule(dbPath: string, name: string): Promise<QueryResult> {
        const code = `
            (let [eid (datalevin.core/q '[:find ?e .
                                          :in $ ?name
                                          :where [?e :levin.rule/name ?name]]
                                        @conn "${this.escapeString(name)}")]
              (when eid
                (datalevin.core/transact! conn [[:db/retractEntity eid]]))
              {:deleted (some? eid)})
        `.trim();

        return this.runCode(dbPath, code);
    }

    /**
     * Run a query with rules from the database
     * ruleNames: array of rule names to include
     */
    async queryWithRules(dbPath: string, query: string, ruleNames: string[]): Promise<QueryResult> {
        if (ruleNames.length === 0) {
            // No rules, just run regular query
            return this.query(dbPath, query);
        }

        const ruleNamesEdn = '[' + ruleNames.map(n => `"${this.escapeString(n)}"`).join(' ') + ']';
        const code = `
            (let [db @conn
                  ;; Fetch rule bodies for requested names
                  rule-bodies (datalevin.core/q '[:find ?body
                                                  :in $ [?name ...]
                                                  :where
                                                  [?e :levin.rule/name ?name]
                                                  [?e :levin.rule/body ?body]]
                                                db ${ruleNamesEdn})
                  ;; Parse and combine rules
                  rules (->> rule-bodies
                             (map first)
                             (map read-string)
                             (apply concat)
                             vec)
                  ;; Run query with rules
                  query-form (read-string "${this.escapeString(query)}")]
              (if (seq rules)
                (datalevin.core/q query-form db rules)
                (datalevin.core/q query-form db)))
        `.trim();

        return this.runCode(dbPath, code);
    }

    /**
     * Execute a vector similarity search
     */
    async vectorSearch(dbPath: string, attribute: string, queryVector: string, options: {
        top?: number;
        display?: string;
        domains?: string[];
    } = {}): Promise<QueryResult> {
        const top = options.top || 10;
        const displayOpt = options.display === 'refs+dists' ? ':display :refs+dists' : '';

        let searchOpts = `{:top ${top} ${displayOpt}}`;

        let whereClause: string;
        if (options.domains && options.domains.length > 0) {
            const domainsList = options.domains.map(d => `"${d}"`).join(' ');
            searchOpts = `{:top ${top} ${displayOpt} :domains [${domainsList}]}`;
            whereClause = `[(vec-neighbors $ ?query ${searchOpts}) [[?e ?a ?v]]]`;
        } else {
            whereClause = `[(vec-neighbors $ :${attribute} ?query ${searchOpts}) [[?e ?a ?v]]]`;
        }

        const code = `
            (let [query-vec ${queryVector}
                  results (datalevin.core/q '[:find ?e ?a ?v
                                             :in $ ?query
                                             :where
                                             ${whereClause}]
                                           @conn query-vec)]
              {:total (count results)
               :results (vec (take ${top} results))})
        `.trim();

        return this.runCode(dbPath, code);
    }

    // ==================== DISPLAY TYPE MANAGEMENT ====================

    /**
     * Ensure the display type schema exists in the database
     */
    async ensureDisplaySchema(dbPath: string): Promise<QueryResult> {
        const code = `
            (let [schema (datalevin.core/schema conn)
                  has-display? (contains? schema :levin.display/attribute)]
              (when-not has-display?
                (datalevin.core/transact! conn
                  [{:db/ident :levin.display/attribute
                    :db/valueType :db.type/string
                    :db/cardinality :db.cardinality/one
                    :db/unique :db.unique/identity}
                   {:db/ident :levin.display/type
                    :db/valueType :db.type/string
                    :db/cardinality :db.cardinality/one}]))
              {:success true :had-schema has-display?})
        `.trim();

        return this.runCode(dbPath, code);
    }

    /**
     * Get all display type settings
     * Returns map of attribute -> display type
     */
    async getDisplayTypes(dbPath: string): Promise<Record<string, string>> {
        const code = `
            (let [db @conn
                  displays (datalevin.core/q '[:find ?attr ?type
                                               :where
                                               [?e :levin.display/attribute ?attr]
                                               [?e :levin.display/type ?type]]
                                             db)]
              (into {} displays))
        `.trim();

        const result = await this.runCode(dbPath, code);
        if (result.success && result.data) {
            return result.data as Record<string, string>;
        }
        return {};
    }

    /**
     * Set display type for an attribute
     * Types: "image", "hyperlink", "email", "json", "code", "html"
     */
    async setDisplayType(dbPath: string, attribute: string, displayType: string): Promise<QueryResult> {
        await this.ensureDisplaySchema(dbPath);

        const code = `
            (datalevin.core/transact! conn
              [{:levin.display/attribute "${this.escapeString(attribute)}"
                :levin.display/type "${this.escapeString(displayType)}"}])
        `.trim();

        return this.runCode(dbPath, code);
    }

    /**
     * Remove display type for an attribute
     */
    async removeDisplayType(dbPath: string, attribute: string): Promise<QueryResult> {
        const code = `
            (let [eid (datalevin.core/q '[:find ?e .
                                          :in $ ?attr
                                          :where [?e :levin.display/attribute ?attr]]
                                        @conn "${this.escapeString(attribute)}")]
              (when eid
                (datalevin.core/transact! conn [[:db/retractEntity eid]]))
              {:deleted (some? eid)})
        `.trim();

        return this.runCode(dbPath, code);
    }

    // ==================== KEY-VALUE STORE OPERATIONS ====================

    /**
     * List all DBIs (sub-databases) in a KV database
     * Filters out system DBIs (datalevin/*)
     */
    async listKvDatabases(dbPath: string): Promise<string[]> {
        const resolvedPath = this.isRemoteUri(dbPath) ? dbPath : this.resolvePath(dbPath);

        // levin-bb backend: use the datalevin API instead of the dtlv CLI dump
        if (this.backend === 'bb' && this.bbServer) {
            const code = `
                (require '[datalevin.core :as d])
                (let [db (d/open-kv "${this.escapeString(resolvedPath)}")]
                  (try
                    (vec (remove #(clojure.string/starts-with? % "datalevin/") (d/list-dbis db)))
                    (finally (d/close-kv db))))
            `.trim();
            const result = await this.execDtlv(code);
            if (result.success && Array.isArray(result.data)) {
                return result.data as string[];
            }
            throw new Error(result.error || 'Failed to list DBIs');
        }

        return new Promise((resolve, reject) => {
            let stdout = '';
            let stderr = '';

            const args = ['-d', resolvedPath, '-l', 'dump'];
            const proc = spawn(this.dtlvPath, args, { shell: true });

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    try {
                        // Output is a Clojure set like: #{"dbi1" "dbi2"}
                        const parsed = parseEdn(stdout.trim()) as string[];
                        const allDbis = Array.isArray(parsed) ? parsed : [];

                        // Filter out system DBIs (datalevin/* are internal)
                        const userDbis = allDbis.filter(dbi => !dbi.startsWith('datalevin/'));

                        resolve(userDbis);
                    } catch (error) {
                        reject(new Error(`Failed to parse DBI list: ${error}`));
                    }
                } else {
                    reject(new Error(stderr || stdout || `Exit code: ${code}`));
                }
            });

            proc.on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * Get all key-value pairs from a DBI
     */
    async getKvRange(dbPath: string, dbiName: string): Promise<Array<[unknown, unknown]>> {
        const resolvedPath = this.isRemoteUri(dbPath) ? dbPath : this.resolvePath(dbPath);

        const code = `
            (require '[datalevin.core :as d])
            (let [db (d/open-kv "${this.escapeString(resolvedPath)}")]
              (d/open-dbi db "${this.escapeString(dbiName)}")
              (try
                (let [result (d/get-range db "${this.escapeString(dbiName)}" [:all])]
                  (d/close-kv db)
                  result)
                (catch Exception e
                  (d/close-kv db)
                  [])))
        `.trim();

        const result = await this.execDtlv(code);

        if (result.success && result.data) {
            return result.data as Array<[unknown, unknown]>;
        }

        return [];
    }

    /**
     * Get a single value from a KV store
     */
    async getKvValue(dbPath: string, dbiName: string, key: string): Promise<QueryResult> {
        const resolvedPath = this.isRemoteUri(dbPath) ? dbPath : this.resolvePath(dbPath);

        const code = `
            (require '[datalevin.core :as d])
            (let [db (d/open-kv "${this.escapeString(resolvedPath)}")]
              (d/open-dbi db "${this.escapeString(dbiName)}")
              (let [result (d/get-value db "${this.escapeString(dbiName)}" ${key})]
                (d/close-kv db)
                result))
        `.trim();

        return this.execDtlv(code);
    }

    /**
     * Put a key-value pair into a DBI
     */
    async putKvValue(dbPath: string, dbiName: string, key: string, value: string): Promise<QueryResult> {
        const resolvedPath = this.isRemoteUri(dbPath) ? dbPath : this.resolvePath(dbPath);

        const code = `
            (require '[datalevin.core :as d])
            (let [db (d/open-kv "${this.escapeString(resolvedPath)}")]
              (d/open-dbi db "${this.escapeString(dbiName)}")
              (d/transact-kv db [[:put "${this.escapeString(dbiName)}" ${key} ${value}]])
              (d/close-kv db)
              {:success true})
        `.trim();

        return this.execDtlv(code);
    }

    /**
     * Delete a key from a DBI
     */
    async deleteKvKey(dbPath: string, dbiName: string, key: string): Promise<QueryResult> {
        const resolvedPath = this.isRemoteUri(dbPath) ? dbPath : this.resolvePath(dbPath);

        const code = `
            (require '[datalevin.core :as d])
            (let [db (d/open-kv "${this.escapeString(resolvedPath)}")]
              (d/open-dbi db "${this.escapeString(dbiName)}")
              (d/transact-kv db [[:del "${this.escapeString(dbiName)}" ${key}]])
              (d/close-kv db)
              {:success true})
        `.trim();

        return this.execDtlv(code);
    }

    /**
     * Create a new DBI (sub-database) in the KV store
     */
    async createKvDatabase(dbPath: string, dbiName: string): Promise<QueryResult> {
        const resolvedPath = this.isRemoteUri(dbPath) ? dbPath : this.resolvePath(dbPath);

        const code = `
            (require '[datalevin.core :as d])
            (let [db (d/open-kv "${this.escapeString(resolvedPath)}")]
              (d/open-dbi db "${this.escapeString(dbiName)}")
              (d/close-kv db)
              {:success true :dbi "${this.escapeString(dbiName)}"})
        `.trim();

        return this.execDtlv(code);
    }

    /**
     * Export all key-value pairs from a DBI as an EDN map
     */
    async exportKvDbi(dbPath: string, dbiName: string): Promise<QueryResult> {
        const resolvedPath = this.isRemoteUri(dbPath) ? dbPath : this.resolvePath(dbPath);

        const code = `
            (require '[datalevin.core :as d])
            (let [db (d/open-kv "${this.escapeString(resolvedPath)}")]
              (d/open-dbi db "${this.escapeString(dbiName)}")
              (let [pairs (d/get-range db "${this.escapeString(dbiName)}" [:all])
                    result (into {} pairs)]
                (d/close-kv db)
                result))
        `.trim();

        return this.execDtlv(code);
    }

    /**
     * Import key-value pairs from an EDN map into a DBI
     * The EDN should be a map like: {:key1 "value1" :key2 {:nested "value"}}
     */
    async importKvDbi(dbPath: string, dbiName: string, ednMap: string): Promise<QueryResult> {
        const resolvedPath = this.isRemoteUri(dbPath) ? dbPath : this.resolvePath(dbPath);

        const code = `
            (require '[datalevin.core :as d])
            (require '[clojure.edn :as edn])
            (let [db (d/open-kv "${this.escapeString(resolvedPath)}")
                  data (edn/read-string "${this.escapeString(ednMap)}")]
              (d/open-dbi db "${this.escapeString(dbiName)}")
              (let [txs (mapv (fn [[k v]] [:put "${this.escapeString(dbiName)}" k v]) data)]
                (d/transact-kv db txs)
                (d/close-kv db)
                {:success true :count (count txs)}))
        `.trim();

        return this.execDtlv(code);
    }
}
