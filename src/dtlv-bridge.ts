import * as vscode from 'vscode';
import { spawn, execSync } from 'child_process';
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
        try {
            execSync(`${this.dtlvPath} help`, { stdio: 'pipe' });
            return true;
        } catch {
            return false;
        }
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
            exists: this.databaseExists(resolvedPath)
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
     * Check if a database exists
     */
    databaseExists(dbPath: string): boolean {
        try {
            const resolvedPath = this.resolvePath(dbPath);
            // Try to get stats - if it works, db exists
            const result = this.execDtlvSync(['stat', resolvedPath]);
            return !result.includes('does not exist');
        } catch {
            return false;
        }
    }

    /**
     * Create a new database
     */
    async createDatabase(dbPath: string): Promise<QueryResult> {
        const resolvedPath = this.resolvePath(dbPath);

        try {
            // Create by running an empty transaction
            const result = await this.execDtlv(['exec', resolvedPath, '[]']);

            if (result.success) {
                this.openDatabase(resolvedPath);
            }

            return result;
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Execute a Datalog query
     */
    async query(dbPath: string, queryStr: string): Promise<QueryResult> {
        const resolvedPath = this.resolvePath(dbPath);

        // Wrap query for dtlv exec format
        const wrappedQuery = `(d/q '${queryStr} (d/db conn))`;

        return this.execDtlv(['exec', resolvedPath, wrappedQuery]);
    }

    /**
     * Execute a query and return parsed results
     */
    async runQuery(dbPath: string, query: string, limit: number = 100): Promise<QueryResult> {
        const resolvedPath = this.resolvePath(dbPath);

        // Build the query with limit
        const clojureCode = `
            (let [results (d/q '${query} (d/db conn))]
              {:total (count results)
               :truncated (> (count results) ${limit})
               :results (vec (take ${limit} results))})
        `.trim();

        return this.execDtlv(['exec', resolvedPath, clojureCode]);
    }

    /**
     * Get database schema
     */
    async getSchema(dbPath: string): Promise<SchemaAttribute[]> {
        const resolvedPath = this.resolvePath(dbPath);

        const code = `
            (->> (d/schema (d/db conn))
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

        const result = await this.execDtlv(['exec', resolvedPath, code]);

        if (result.success && result.data) {
            return result.data as SchemaAttribute[];
        }

        return [];
    }

    /**
     * Get entity counts by namespace
     */
    async getEntityCounts(dbPath: string): Promise<Array<{namespace: string; count: number}>> {
        const resolvedPath = this.resolvePath(dbPath);

        const code = `
            (let [db (d/db conn)]
              (->> (d/datoms db :eavt)
                   (map #(namespace (:a %)))
                   (remove nil?)
                   frequencies
                   (map (fn [[ns cnt]] {:namespace ns :count cnt}))
                   (sort-by :namespace)
                   vec))
        `.trim();

        const result = await this.execDtlv(['exec', resolvedPath, code]);

        if (result.success && result.data) {
            return result.data as Array<{namespace: string; count: number}>;
        }

        return [];
    }

    /**
     * Get entity by ID
     */
    async getEntity(dbPath: string, entityId: number): Promise<QueryResult> {
        const resolvedPath = this.resolvePath(dbPath);

        const code = `
            (let [db (d/db conn)
                  entity (d/entity db ${entityId})
                  attrs (->> (keys entity)
                             (map (fn [k] [(str k) (let [v (get entity k)]
                                                     (if (instance? datalevin.entity.Entity v)
                                                       (:db/id v)
                                                       v))]))
                             (into {}))]
              {:eid ${entityId} :attributes attrs})
        `.trim();

        return this.execDtlv(['exec', resolvedPath, code]);
    }

    /**
     * Execute a transaction
     */
    async transact(dbPath: string, txData: string): Promise<QueryResult> {
        const resolvedPath = this.resolvePath(dbPath);

        const code = `
            (let [result (d/transact! conn ${txData})]
              {:tx-id (:max-tx result)
               :tempids (:tempids result)
               :datoms-count (count (:tx-data result))})
        `.trim();

        return this.execDtlv(['exec', resolvedPath, code]);
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
        const resolvedPath = this.resolvePath(dbPath);

        let schemaMap = `{:db/ident :${attr.attribute}
                          :db/valueType :db.type/${attr.valueType}
                          :db/cardinality :db.cardinality/${attr.cardinality}`;

        if (attr.index) { schemaMap += ' :db/index true'; }
        if (attr.unique) { schemaMap += ` :db/unique :db.unique/${attr.unique}`; }
        if (attr.fulltext) { schemaMap += ' :db/fulltext true'; }
        if (attr.isComponent) { schemaMap += ' :db/isComponent true'; }

        schemaMap += '}';

        return this.transact(resolvedPath, `[${schemaMap}]`);
    }

    /**
     * Get sample values for an attribute
     */
    async getSampleValues(dbPath: string, attribute: string, limit: number = 10): Promise<unknown[]> {
        const resolvedPath = this.resolvePath(dbPath);

        const code = `
            (->> (d/datoms (d/db conn) :aevt :${attribute})
                 (take ${limit})
                 (map :v)
                 vec)
        `.trim();

        const result = await this.execDtlv(['exec', resolvedPath, code]);

        if (result.success && result.data) {
            return result.data as unknown[];
        }

        return [];
    }

    /**
     * Get all attributes for autocomplete
     */
    async getAttributes(dbPath: string): Promise<string[]> {
        const resolvedPath = this.resolvePath(dbPath);

        const code = `
            (->> (d/schema (d/db conn))
                 keys
                 (map str)
                 sort
                 vec)
        `.trim();

        const result = await this.execDtlv(['exec', resolvedPath, code]);

        if (result.success && result.data) {
            return result.data as string[];
        }

        return [];
    }

    /**
     * Get database stats
     */
    async getStats(dbPath: string): Promise<QueryResult> {
        const resolvedPath = this.resolvePath(dbPath);
        return this.execDtlv(['stat', resolvedPath]);
    }

    /**
     * Execute dtlv command asynchronously
     */
    private execDtlv(args: string[]): Promise<QueryResult> {
        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';

            const proc = spawn(this.dtlvPath, args, {
                shell: true,
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
     * Execute dtlv command synchronously
     */
    private execDtlvSync(args: string[]): string {
        return execSync(`${this.dtlvPath} ${args.join(' ')}`, {
            encoding: 'utf8',
            stdio: 'pipe'
        });
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
