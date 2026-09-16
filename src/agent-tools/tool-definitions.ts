/**
 * Shared agent-tool catalog for Levin (issue #21, step 4).
 *
 * This module is the single source of truth for the tools Levin exposes to
 * AI agents. Both surfaces — the standalone MCP server (`mcp-server.ts`)
 * and the in-editor VS Code Language Model tools (`lm-tools.ts`) — consume
 * these definitions, so tool names, descriptions, and input schemas cannot
 * drift between them.
 *
 * Tool handlers live in `tool-executor.ts` (`AgentToolRunner.execute`).
 * Safety policy (read-only default, path allowlist, result caps, timeouts)
 * is enforced there, not here.
 */

export interface ToolInputSchema {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
}

export interface AgentToolDefinition {
    /** Stable tool name, e.g. `query`. Prefixed per-surface if needed. */
    name: string;
    /** One-paragraph description shown to the agent. */
    description: string;
    /** JSON Schema for the tool's input. */
    inputSchema: ToolInputSchema;
    /** False for tools that mutate a database (gated behind opt-in). */
    readOnly: boolean;
}

const DATABASE_PROP = {
    database: {
        type: 'string',
        description:
            'Which database to use: a configured database name, or a path/URI from the allowlist. ' +
            'Use list_databases to see what is available.'
    }
};

const LIMIT_PROP = {
    type: 'integer',
    minimum: 1,
    maximum: 1000,
    description: 'Maximum rows to return. The server may return fewer.'
};

export const AGENT_TOOLS: AgentToolDefinition[] = [
    {
        name: 'list_databases',
        description:
            'List the Datalevin databases this server is allowed to open. ' +
            'Each entry has a name you can pass as `database` to the other tools, ' +
            'plus its path (local filesystem path or dtlv:// remote URI).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        readOnly: true
    },
    {
        name: 'get_schema',
        description:
            'Get the schema of a database: every attribute with its value type ' +
            '(string, long, boolean, ref, ...), cardinality (one/many), uniqueness, ' +
            'index/fulltext flags, and vector settings. Start here before writing queries.',
        inputSchema: {
            type: 'object',
            properties: { ...DATABASE_PROP },
            required: ['database'],
            additionalProperties: false
        },
        readOnly: true
    },
    {
        name: 'describe_database',
        description:
            'Describe a database: total datom count, schema attribute count, and ' +
            'per-namespace entity counts. A cheap overview before exploring.',
        inputSchema: {
            type: 'object',
            properties: { ...DATABASE_PROP },
            required: ['database'],
            additionalProperties: false
        },
        readOnly: true
    },
    {
        name: 'query',
        description:
            'Run a Datalog query against a database and get rows back. The query ' +
            'must be a single EDN vector starting with :find, e.g. ' +
            "'[:find ?name :where [?e :person/name ?name]]'. " +
            'Supports :in inputs via `args` (each an EDN value, e.g. \'"Kay"\' or \'[1 2 3]\') ' +
            'and stored Levin rules via `rules` (rule names, or "all"). ' +
            'Results are capped; `truncated: true` means there were more rows. ' +
            'The query runs read-only inside a safely-quoted context — it cannot ' +
            'execute arbitrary code, and anything that is not a plain :find query is rejected.',
        inputSchema: {
            type: 'object',
            properties: {
                ...DATABASE_PROP,
                query: {
                    type: 'string',
                    description: 'Datalog query as an EDN string, e.g. [:find ?e :where [?e :person/name "Kay"]]'
                },
                args: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional :in input values, each as an EDN string, in order after the database.'
                },
                rules: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional stored Levin rule names to make available as the % input.'
                },
                use_all_rules: {
                    type: 'boolean',
                    description: 'If true, make all stored rules available as the % input (instead of `rules`).'
                },
                max_rows: LIMIT_PROP
            },
            required: ['database', 'query'],
            additionalProperties: false
        },
        readOnly: true
    },
    {
        name: 'get_entity',
        description:
            'Pull one entity by id and get all its attributes, with ref attributes ' +
            'resolved to their target entity ids plus a one-line preview of each target.',
        inputSchema: {
            type: 'object',
            properties: {
                ...DATABASE_PROP,
                entity_id: { type: 'integer', minimum: 0, description: 'Numeric entity id.' }
            },
            required: ['database', 'entity_id'],
            additionalProperties: false
        },
        readOnly: true
    },
    {
        name: 'sample_values',
        description:
            'Get up to `limit` distinct sample values for one attribute. ' +
            'Useful for learning what data an attribute holds before querying on it.',
        inputSchema: {
            type: 'object',
            properties: {
                ...DATABASE_PROP,
                attribute: { type: 'string', description: 'Attribute name, e.g. person/name' },
                limit: LIMIT_PROP
            },
            required: ['database', 'attribute'],
            additionalProperties: false
        },
        readOnly: true
    },
    {
        name: 'list_rules',
        description:
            'List the named Datalog rules stored in the database (:levin.rule/* entities), ' +
            'with their bodies and descriptions. Pass names to the `query` tool via `rules`.',
        inputSchema: {
            type: 'object',
            properties: { ...DATABASE_PROP },
            required: ['database'],
            additionalProperties: false
        },
        readOnly: true
    },
    {
        name: 'find_relationships',
        description:
            'Discover how entities relate: all ref-type attributes, and for each, ' +
            'the namespaces of the entities it points to. Use this to plan joins.',
        inputSchema: {
            type: 'object',
            properties: { ...DATABASE_PROP },
            required: ['database'],
            additionalProperties: false
        },
        readOnly: true
    },
    {
        name: 'fulltext_search',
        description:
            'Full-text search over one fulltext-indexed attribute. `attribute` must ' +
            'have :db/fulltext true in the schema (see get_schema). Returns matching ' +
            'entities with their relevance score.',
        inputSchema: {
            type: 'object',
            properties: {
                ...DATABASE_PROP,
                attribute: { type: 'string', description: 'Fulltext-indexed attribute, e.g. document/summary' },
                query: { type: 'string', description: 'Search text, e.g. "watering schedule"' },
                limit: LIMIT_PROP
            },
            required: ['database', 'attribute', 'query'],
            additionalProperties: false
        },
        readOnly: true
    },
    {
        name: 'transact',
        description:
            'Write to the database: assert/retract datoms. `tx_data` must be a single ' +
            'EDN vector of entity maps and/or transaction operations, e.g. ' +
            "'[{:person/name \"Kay\"} [:db/add 1 :person/age 40]]'. " +
            'WRITE TOOL — only available when the server was started with writes enabled.',
        inputSchema: {
            type: 'object',
            properties: {
                ...DATABASE_PROP,
                tx_data: { type: 'string', description: 'Transaction data as an EDN string.' }
            },
            required: ['database', 'tx_data'],
            additionalProperties: false
        },
        readOnly: false
    },
    {
        name: 'add_schema',
        description:
            'Add one attribute to the database schema. ' +
            'WRITE TOOL — only available when the server was started with writes enabled.',
        inputSchema: {
            type: 'object',
            properties: {
                ...DATABASE_PROP,
                attribute: { type: 'string', description: 'Attribute name, e.g. person/nickname' },
                value_type: {
                    type: 'string',
                    enum: ['string', 'long', 'double', 'boolean', 'instant', 'uuid', 'bytes', 'keyword', 'symbol', 'ref'],
                    description: 'Datalevin value type.'
                },
                cardinality: { type: 'string', enum: ['one', 'many'], description: 'Defaults to one.' },
                unique: { type: 'string', enum: ['identity', 'value'], description: 'Optional uniqueness.' },
                fulltext: { type: 'boolean', description: 'Enable full-text search on this attribute.' }
            },
            required: ['database', 'attribute', 'value_type'],
            additionalProperties: false
        },
        readOnly: false
    },
    {
        name: 'create_database',
        description:
            'Create a new empty Datalevin database at `path`, which must be inside ' +
            'one of the server\'s configured writable directories. Optionally seed it ' +
            'with an EDN schema map string. ' +
            'WRITE TOOL — only available when the server was started with writes enabled.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Filesystem path for the new database.' },
                schema: { type: 'string', description: 'Optional EDN schema map string.' }
            },
            required: ['path'],
            additionalProperties: false
        },
        readOnly: false
    }
];

export const READ_ONLY_TOOLS = AGENT_TOOLS.filter(t => t.readOnly);
export const WRITE_TOOLS = AGENT_TOOLS.filter(t => !t.readOnly);

export function getToolDefinition(name: string): AgentToolDefinition | undefined {
    return AGENT_TOOLS.find(t => t.name === name);
}
