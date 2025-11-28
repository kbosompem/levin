import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import { parseEdn } from './utils/edn-parser';

export interface QueryResult {
    success: boolean;
    data?: unknown;
    error?: string;
    stdout?: string;
    stderr?: string;
}

export interface SchemaAttribute {
    attribute: string;
    valueType?: string;
    cardinality?: string;
    unique?: string;
    index?: boolean;
    fulltext?: boolean;
    isComponent?: boolean;
}

export interface DatabaseInfo {
    path: string;
    name: string;
    exists: boolean;
}

export class DtlvBridge {
    private dtlvPath: string = 'dtlv';
    private openDatabases: Map<string, DatabaseInfo> = new Map();

    constructor() {
        this.loadSettings();
    }

    private loadSettings(): void {
        const config = vscode.workspace.getConfiguration('levin');
        this.dtlvPath = config.get<string>('dtlvPath', 'dtlv');
    }

    /**
     * Check if dtlv CLI is available
     */
    async checkDtlvInstalled(): Promise<boolean> {
        return new Promise((resolve) => {
            const proc = spawn(this.dtlvPath, ['help'], { shell: true });
            proc.on('close', (code) => resolve(code === 0));
            proc.on('error', () => resolve(false));
        });
    }

    /**
     * Show installation instructions if dtlv is not found
     */
    async promptInstallDtlv(): Promise<void> {
        const action = await vscode.window.showErrorMessage(
            'Datalevin CLI (dtlv) not found. Please install it first.',
            'Show Instructions',
            'Set Custom Path'
        );

        if (action === 'Show Instructions') {
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
     * Open/register a database
     */
    openDatabase(dbPath: string): DatabaseInfo {
        const resolvedPath = this.resolvePath(dbPath);
        const name = path.basename(resolvedPath);

        const info: DatabaseInfo = {
            path: resolvedPath,
            name: name,
            exists: true // We'll assume it exists when opened
        };

        this.openDatabases.set(resolvedPath, info);
        return info;
    }

    /**
     * Close/unregister a database
     */
    closeDatabase(dbPath: string): void {
        const resolvedPath = this.resolvePath(dbPath);
        this.openDatabases.delete(resolvedPath);
    }

    /**
     * Get all open databases
     */
    getOpenDatabases(): DatabaseInfo[] {
        return Array.from(this.openDatabases.values());
    }

    /**
     * Check if a database exists by trying to get its stats
     */
    async databaseExists(dbPath: string): Promise<boolean> {
        const resolvedPath = this.resolvePath(dbPath);
        const result = await this.runCode(resolvedPath, '(datalevin.core/schema conn)');
        return result.success;
    }

    /**
     * Create a new database
     */
    async createDatabase(dbPath: string): Promise<QueryResult> {
        const resolvedPath = this.resolvePath(dbPath);

        // Create by opening connection and closing it
        const code = `
            (let [conn (datalevin.core/get-conn "${this.escapeString(resolvedPath)}")]
              (datalevin.core/close conn)
              {:created true :path "${this.escapeString(resolvedPath)}"})
        `.trim();

        const result = await this.execDtlv(code);

        if (result.success) {
            this.openDatabase(resolvedPath);
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
     * Execute a query and return parsed results
     */
    async runQuery(dbPath: string, query: string, limit: number = 100): Promise<QueryResult> {
        const code = `
            (let [results (datalevin.core/q '${query} @conn)]
              {:total (count results)
               :truncated (> (count results) ${limit})
               :results (vec (take ${limit} results))})
        `.trim();

        return this.runCode(dbPath, code);
    }

    /**
     * Get database schema
     */
    async getSchema(dbPath: string): Promise<SchemaAttribute[]> {
        const code = `
            (->> (datalevin.core/schema conn)
                 (map (fn [[attr props]]
                        {:attribute (str attr)
                         :valueType (some-> (:db/valueType props) name)
                         :cardinality (some-> (:db/cardinality props) name)
                         :unique (some-> (:db/unique props) name)
                         :index (:db/index props)
                         :fulltext (:db/fulltext props)
                         :isComponent (:db/isComponent props)}))
                 (sort-by :attribute)
                 vec)
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
            (->> (datalevin.core/datoms @conn :eavt)
                 (map #(namespace (:a %)))
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
     * Get entity by ID
     */
    async getEntity(dbPath: string, entityId: number): Promise<QueryResult> {
        const code = `
            (let [ent (datalevin.core/entity @conn ${entityId})
                  attrs (->> (keys ent)
                             (map (fn [k] [(str k) (let [v (get ent k)]
                                                     (if (instance? datalevin.entity.Entity v)
                                                       (:db/id v)
                                                       v))]))
                             (into {}))]
              {:eid ${entityId} :attributes attrs})
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
    }): Promise<QueryResult> {
        let schemaMap = `{:db/ident :${attr.attribute}
                          :db/valueType :db.type/${attr.valueType}
                          :db/cardinality :db.cardinality/${attr.cardinality}`;

        if (attr.index) { schemaMap += ' :db/index true'; }
        if (attr.unique) { schemaMap += ` :db/unique :db.unique/${attr.unique}`; }
        if (attr.fulltext) { schemaMap += ' :db/fulltext true'; }
        if (attr.isComponent) { schemaMap += ' :db/isComponent true'; }

        schemaMap += '}';

        return this.transact(dbPath, `[${schemaMap}]`);
    }

    /**
     * Get sample values for an attribute
     */
    async getSampleValues(dbPath: string, attribute: string, limit: number = 10): Promise<unknown[]> {
        const code = `
            (->> (datalevin.core/datoms @conn :aevt :${attribute})
                 (take ${limit})
                 (map :v)
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
            {:datom-count (count (datalevin.core/datoms @conn :eavt))
             :schema-count (count (datalevin.core/schema conn))}
        `.trim();

        return this.runCode(dbPath, code);
    }

    /**
     * Run code with a database connection
     * This wraps the code with connection setup/teardown
     */
    private async runCode(dbPath: string, code: string): Promise<QueryResult> {
        const resolvedPath = this.resolvePath(dbPath);

        // Use fully qualified names to avoid shadowing issues in dtlv's sci environment
        const wrappedCode = `
            (let [conn (datalevin.core/get-conn "${this.escapeString(resolvedPath)}")]
              (try
                ${code}
                (finally (datalevin.core/close conn))))
        `.trim();

        return this.execDtlv(wrappedCode);
    }

    /**
     * Execute dtlv command with code
     */
    private execDtlv(code: string): Promise<QueryResult> {
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
                        const parsed = parseEdn(stdout.trim());
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
}
