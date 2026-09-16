/**
 * Agent-tool executor for Levin (issue #21).
 *
 * `AgentToolRunner` binds the shared tool catalog (`tool-definitions.ts`) to
 * a `DtlvCore` instance and enforces the safety policy from the issue:
 *
 *  - **Read-only default.** Write tools (`transact`, `add_schema`,
 *    `create_database`) throw unless `allowWrites` is explicitly enabled.
 *  - **Path allowlist.** The `database` argument must match a configured
 *    database by name or path; arbitrary filesystem paths and `dtlv://`
 *    URIs are rejected. `create_database` additionally requires the target
 *    path to sit inside a configured writable directory.
 *  - **Structured parameters.** Every agent-supplied string that reaches
 *    generated Clojure goes through `edn-guard.ts` first — queries must be
 *    exactly one `[:find ...]` form, tx-data exactly one vector, attribute
 *    names must match the live schema, entity ids must be safe integers.
 *    Agent text is never interpolated raw into an eval string.
 *  - **Result caps and timeouts.** Row caps (`maxRows`), per-value
 *    truncation (`maxValueChars`), and a query timeout keep one bad call
 *    from dumping a database into an agent's context or hanging the server.
 *  - **Remote vs local is surfaced.** Every result names the database that
 *    answered and whether it is a remote `dtlv://` connection.
 */

import { DtlvCore } from '../dtlv-core';
import { AGENT_TOOLS, getToolDefinition } from './tool-definitions';
import * as path from 'path';
import {
    assertSafeQuery,
    assertSafeQueryArg,
    assertSafeTxData,
    assertSafeAttributeName,
    assertSafeEntityId,
    UnsafeEdnError
} from './edn-guard';

export interface DatabaseRef {
    /** Short name agents pass as `database`. */
    name: string;
    /** Local path or dtlv:// URI. */
    path: string;
}

export interface AgentToolsConfig {
    /** Databases agents may open. Empty = no database tools usable. */
    databases: DatabaseRef[];
    /** Enable the write tools. Default false. */
    allowWrites?: boolean;
    /** Default row cap for tools that return rows. Default 100. */
    maxRows?: number;
    /** Per-call timeout in ms. Default 30000. */
    queryTimeoutMs?: number;
    /** Truncate string values longer than this. Default 2000 chars. */
    maxValueChars?: number;
    /** Directories `create_database` may write into. Default [] (disabled). */
    writableDirs?: string[];
}

export interface ResolvedDatabase extends DatabaseRef {
    remote: boolean;
}

export class ToolExecutionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ToolExecutionError';
    }
}

const DEFAULTS = { maxRows: 100, queryTimeoutMs: 30_000, maxValueChars: 2000 };

/** AgentToolsConfig with all defaults resolved. */
interface ResolvedAgentToolsConfig {
    databases: DatabaseRef[];
    allowWrites: boolean;
    maxRows: number;
    queryTimeoutMs: number;
    maxValueChars: number;
    writableDirs: string[];
}

export class AgentToolRunner {
    private readonly core: DtlvCore;
    private readonly config: ResolvedAgentToolsConfig;
    private schemaAttrCache = new Map<string, string[]>();

    constructor(core: DtlvCore, config: AgentToolsConfig) {
        this.core = core;
        this.config = {
            databases: config.databases,
            allowWrites: config.allowWrites ?? false,
            maxRows: config.maxRows ?? DEFAULTS.maxRows,
            queryTimeoutMs: config.queryTimeoutMs ?? DEFAULTS.queryTimeoutMs,
            maxValueChars: config.maxValueChars ?? DEFAULTS.maxValueChars,
            writableDirs: config.writableDirs ?? []
        };
    }

    /** Tools this runner will serve (write tools only when enabled). */
    servedTools(): string[] {
        return AGENT_TOOLS.filter(t => t.readOnly || this.config.allowWrites).map(t => t.name);
    }

    // ------------------------------------------------------------------
    // Entry point
    // ------------------------------------------------------------------

    async execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
        const def = getToolDefinition(toolName);
        if (!def) {
            throw new ToolExecutionError(`unknown tool: ${toolName}`);
        }
        if (!def.readOnly && !this.config.allowWrites) {
            throw new ToolExecutionError(
                `tool "${toolName}" writes to the database and is disabled. ` +
                `Restart with writes explicitly enabled to use it.`
            );
        }
        if (!this.servedTools().includes(toolName)) {
            throw new ToolExecutionError(`tool "${toolName}" is not served by this instance`);
        }
        const a = args ?? {};
        switch (toolName) {
            case 'list_databases': return this.listDatabases();
            case 'get_schema': return this.withDb(a, (db) => this.getSchema(db));
            case 'describe_database': return this.withDb(a, (db) => this.describeDatabase(db));
            case 'query': return this.withDb(a, (db) => this.runQuery(db, a));
            case 'get_entity': return this.withDb(a, (db) => this.getEntity(db, a));
            case 'sample_values': return this.withDb(a, (db) => this.sampleValues(db, a));
            case 'list_rules': return this.withDb(a, (db) => this.listRules(db));
            case 'find_relationships': return this.withDb(a, (db) => this.findRelationships(db));
            case 'fulltext_search': return this.withDb(a, (db) => this.fulltextSearch(db, a));
            case 'transact': return this.withDb(a, (db) => this.transact(db, a));
            case 'add_schema': return this.withDb(a, (db) => this.addSchema(db, a));
            case 'create_database': return this.createDatabase(a);
            default: throw new ToolExecutionError(`no handler for tool: ${toolName}`);
        }
    }

    // ------------------------------------------------------------------
    // Database resolution (the path allowlist)
    // ------------------------------------------------------------------

    private resolveDatabase(ref: unknown): ResolvedDatabase {
        if (typeof ref !== 'string' || ref.length === 0) {
            throw new ToolExecutionError('`database` must be a configured database name or path');
        }
        const hit = this.config.databases.find(d => d.name === ref || d.path === ref);
        if (!hit) {
            const names = this.config.databases.map(d => d.name).join(', ') || '(none configured)';
            throw new ToolExecutionError(
                `database ${JSON.stringify(ref)} is not in the allowlist. Available: ${names}`
            );
        }
        return { ...hit, remote: hit.path.startsWith('dtlv://') };
    }

    private dbTag(db: ResolvedDatabase): { name: string; path: string; remote: boolean } {
        return { name: db.name, path: db.path, remote: db.remote };
    }

    private async withDb<T>(args: Record<string, unknown>, fn: (db: ResolvedDatabase) => Promise<T>): Promise<T> {
        return fn(this.resolveDatabase(args['database']));
    }

    // ------------------------------------------------------------------
    // Helpers: timeout, truncation, schema attributes
    // ------------------------------------------------------------------

    private async withTimeout<T>(label: string, task: Promise<T>): Promise<T> {
        const ms = this.config.queryTimeoutMs;
        let timer: NodeJS.Timeout | undefined;
        try {
            return await Promise.race([
                task,
                new Promise<T>((_, reject) => {
                    timer = setTimeout(() => reject(new ToolExecutionError(`${label} timed out after ${ms}ms`)), ms);
                })
            ]);
        } finally {
            if (timer) { clearTimeout(timer); }
        }
    }

    /** Recursively truncate long strings so one huge value can't flood the agent. */
    private truncate(value: unknown): unknown {
        const max = this.config.maxValueChars;
        if (typeof value === 'string') {
            return value.length > max ? value.slice(0, max) + `…[truncated ${value.length - max} chars]` : value;
        }
        if (Array.isArray(value)) { return value.map(v => this.truncate(v)); }
        if (value && typeof value === 'object') {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(value)) { out[k] = this.truncate(v); }
            return out;
        }
        return value;
    }

    private capRows<T>(rows: T[], requested?: unknown): { rows: T[]; truncated: boolean; total: number } {
        const max = Math.min(this.config.maxRows, this.intArg(requested, this.config.maxRows));
        return { rows: rows.slice(0, max), truncated: rows.length > max, total: rows.length };
    }

    private intArg(v: unknown, fallback: number): number {
        return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : fallback;
    }

    private strArg(v: unknown, name: string): string {
        if (typeof v !== 'string' || v.length === 0) {
            throw new ToolExecutionError(`\`${name}\` must be a non-empty string`);
        }
        return v;
    }

    private async schemaAttributes(db: ResolvedDatabase): Promise<string[]> {
        const hit = this.schemaAttrCache.get(db.path);
        if (hit) { return hit; }
        const attrs = await this.core.getAttributes(db.path);
        this.schemaAttrCache.set(db.path, attrs);
        return attrs;
    }

    /** Attribute names spliced into generated code must exist in the schema. */
    private async checkedAttribute(db: ResolvedDatabase, attribute: unknown): Promise<string> {
        const name = this.strArg(attribute, 'attribute');
        assertSafeAttributeName(name);
        const attrs = await this.schemaAttributes(db);
        const bare = name.startsWith(':') ? name.slice(1) : name;
        const match = attrs.find(a => a === bare || a === `:${bare}` || a === name);
        if (!match) {
            throw new ToolExecutionError(
                `attribute ${JSON.stringify(name)} is not in the schema of database ${JSON.stringify(db.name)}`
            );
        }
        return bare;
    }

    private escapeClojureString(s: string): string {
        return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    // ------------------------------------------------------------------
    // Read tools
    // ------------------------------------------------------------------

    private async listDatabases(): Promise<unknown> {
        const dbs = await Promise.all(this.config.databases.map(async (d) => ({
            name: d.name,
            path: d.path,
            remote: d.path.startsWith('dtlv://'),
            exists: d.path.startsWith('dtlv://') ? undefined : await this.core.databaseExists(d.path)
        })));
        return { databases: dbs };
    }

    private async getSchema(db: ResolvedDatabase): Promise<unknown> {
        const attributes = await this.withTimeout('get_schema', this.core.getSchema(db.path));
        return { database: this.dbTag(db), attributes: this.truncate(attributes) };
    }

    private async describeDatabase(db: ResolvedDatabase): Promise<unknown> {
        const [stats, counts] = await Promise.all([
            this.withTimeout('describe_database', this.core.getStats(db.path)),
            this.withTimeout('describe_database', this.core.getEntityCounts(db.path))
        ]);
        if (!stats.success) { throw new ToolExecutionError(stats.error ?? 'getStats failed'); }
        return {
            database: this.dbTag(db),
            datom_count: (stats.data as { 'datom-count': number })?.['datom-count'],
            schema_attributes: (stats.data as { 'schema-count': number })?.['schema-count'],
            entity_counts: counts
        };
    }

    private async runQuery(db: ResolvedDatabase, args: Record<string, unknown>): Promise<unknown> {
        const query = this.strArg(args['query'], 'query');
        assertSafeQuery(query); // exactly one [:find ...], no reader macros — see edn-guard.ts

        const rawArgs = args['args'];
        const ednArgs: string[] | undefined = Array.isArray(rawArgs)
            ? rawArgs.map(a => { const s = this.strArg(a, 'args[]'); assertSafeQueryArg(s); return s; })
            : undefined;

        let rules: string[] | 'all' | undefined;
        if (args['use_all_rules'] === true) {
            rules = 'all';
        } else if (Array.isArray(args['rules'])) {
            rules = args['rules'].map(r => this.strArg(r, 'rules[]'));
        }

        const maxRows = Math.min(this.config.maxRows, this.intArg(args['max_rows'], this.config.maxRows));
        const result = await this.withTimeout(
            'query',
            this.core.runQuery(db.path, query, maxRows, { rules, args: ednArgs })
        );
        if (!result.success) { throw new ToolExecutionError(result.error ?? 'query failed'); }
        const data = result.data as { total?: number; truncated?: boolean; results?: unknown[] } | undefined;
        return {
            database: this.dbTag(db),
            total: data?.total,
            truncated: !!data?.truncated,
            results: this.truncate(data?.results ?? [])
        };
    }

    private async getEntity(db: ResolvedDatabase, args: Record<string, unknown>): Promise<unknown> {
        assertSafeEntityId(args['entity_id']);
        const result = await this.withTimeout('get_entity', this.core.getEntity(db.path, args['entity_id']));
        if (!result.success) { throw new ToolExecutionError(result.error ?? 'get_entity failed'); }
        return { database: this.dbTag(db), entity: this.truncate(result.data) };
    }

    private async sampleValues(db: ResolvedDatabase, args: Record<string, unknown>): Promise<unknown> {
        const attribute = await this.checkedAttribute(db, args['attribute']);
        const limit = Math.min(this.config.maxRows, this.intArg(args['limit'], 10));
        const values = await this.withTimeout('sample_values', this.core.getSampleValues(db.path, attribute, limit));
        return { database: this.dbTag(db), attribute, values: this.truncate(values) };
    }

    private async listRules(db: ResolvedDatabase): Promise<unknown> {
        const result = await this.withTimeout('list_rules', this.core.getRules(db.path));
        if (!result.success) { throw new ToolExecutionError(result.error ?? 'list_rules failed'); }
        return { database: this.dbTag(db), rules: this.truncate(result.data) };
    }

    private async findRelationships(db: ResolvedDatabase): Promise<unknown> {
        const [refs, targets] = await Promise.all([
            this.withTimeout('find_relationships', this.core.getRefAttributes(db.path)),
            this.withTimeout('find_relationships', this.core.discoverRefTargets(db.path))
        ]);
        if (!refs.success) { throw new ToolExecutionError(refs.error ?? 'getRefAttributes failed'); }
        if (!targets.success) { throw new ToolExecutionError(targets.error ?? 'discoverRefTargets failed'); }
        return {
            database: this.dbTag(db),
            ref_attributes: this.truncate(refs.data),
            ref_targets: this.truncate(targets.data)
        };
    }

    private async fulltextSearch(db: ResolvedDatabase, args: Record<string, unknown>): Promise<unknown> {
        const attribute = await this.checkedAttribute(db, args['attribute']);
        const q = this.strArg(args['query'], 'query');
        const limit = Math.min(this.config.maxRows, this.intArg(args['limit'], 10));
        // The search text is the only free text here; it travels inside a
        // Clojure string literal, escaped. The attribute is schema-validated.
        const code = `
            (let [db @conn
                  hits (datalevin.core/fulltext db :${attribute} "${this.escapeClojureString(q)}")
                  takeN (take ${limit} hits)]
              (mapv (fn [[eid score]]
                      (assoc (datalevin.core/pull db '[*] eid) :_score score))
                    takeN))
        `.trim();
        const result = await this.withTimeout('fulltext_search', this.core.runCode_public(db.path, code));
        if (!result.success) { throw new ToolExecutionError(result.error ?? 'fulltext_search failed'); }
        const rows = Array.isArray(result.data) ? result.data : [];
        return {
            database: this.dbTag(db),
            attribute,
            results: this.truncate(rows),
            truncated: rows.length >= limit
        };
    }

    // ------------------------------------------------------------------
    // Write tools (gated by allowWrites, checked in execute())
    // ------------------------------------------------------------------

    private async transact(db: ResolvedDatabase, args: Record<string, unknown>): Promise<unknown> {
        const txData = this.strArg(args['tx_data'], 'tx_data');
        assertSafeTxData(txData); // exactly one vector form, spliced safely
        const result = await this.withTimeout('transact', this.core.transact(db.path, txData));
        if (!result.success) { throw new ToolExecutionError(result.error ?? 'transact failed'); }
        this.schemaAttrCache.delete(db.path);
        return { database: this.dbTag(db), ...(result.data as object ?? {}) };
    }

    private async addSchema(db: ResolvedDatabase, args: Record<string, unknown>): Promise<unknown> {
        const attribute = this.strArg(args['attribute'], 'attribute');
        assertSafeAttributeName(attribute);
        const valueType = this.strArg(args['value_type'], 'value_type');
        const cardinality = args['cardinality'] === 'many' ? 'many' : 'one';
        const result = await this.withTimeout(
            'add_schema',
            this.core.addSchema(db.path, {
                attribute,
                valueType,
                cardinality,
                unique: typeof args['unique'] === 'string' ? args['unique'] : undefined,
                fulltext: args['fulltext'] === true
            })
        );
        if (!result.success) { throw new ToolExecutionError(result.error ?? 'add_schema failed'); }
        this.schemaAttrCache.delete(db.path);
        return { database: this.dbTag(db), attribute, ...(result.data as object ?? {}) };
    }

    private async createDatabase(args: Record<string, unknown>): Promise<unknown> {
        const rawPath = this.strArg(args['path'], 'path');
        if (rawPath.startsWith('dtlv://')) {
            throw new ToolExecutionError('create_database does not support remote URIs');
        }
        const resolved = path.resolve(rawPath);
        const allowed = (this.config.writableDirs ?? []).some(dir => {
            const d = path.resolve(dir);
            return resolved === d || resolved.startsWith(d + path.sep);
        });
        if (!allowed) {
            throw new ToolExecutionError(
                `path ${JSON.stringify(rawPath)} is not inside a writable directory ` +
                `(configure writableDirs to allow database creation)`
            );
        }
        const schema = typeof args['schema'] === 'string' ? args['schema'] : undefined;
        if (schema !== undefined) {
            assertSafeTxData(schema); // schema map must also be a single safe form
        }
        const result = await this.withTimeout(
            'create_database',
            this.core.createDatabase(resolved, schema ? { schema } : undefined)
        );
        if (!result.success) { throw new ToolExecutionError(result.error ?? 'create_database failed'); }
        return { path: resolved, ...(result.data as object ?? {}) };
    }
}

export { UnsafeEdnError };
