#!/usr/bin/env node
/**
 * Levin MCP server (issue #21, step 2).
 *
 * Standalone stdio server exposing Levin's Datalevin tools to MCP clients
 * (Claude Code, Claude Desktop, Cursor, ...). Built on the VS Code-free
 * `DtlvCore` and the shared tool catalog — no VS Code required.
 *
 * Configuration (CLI flags or environment):
 *
 *   --db name=path          Database to serve (repeatable). `path` may be a
 *                           local directory or a dtlv:// URI.
 *   LEVIN_DATABASES         JSON array [{"name":..,"path":..}] or
 *                           "name=path;name=path" — alternative to --db.
 *   --allow-writes          Enable transact/add_schema/create_database.
 *   LEVIN_ALLOW_WRITES=1    Same, via environment.
 *   --writable-dir DIR      Directory create_database may write into (repeatable).
 *   LEVIN_WRITABLE_DIRS     Colon-separated alternative.
 *   --max-rows N            Row cap per call (default 100).
 *   --timeout-ms N          Per-call timeout in ms (default 30000).
 *   --max-value-chars N     Truncate values longer than N chars (default 2000).
 *   LEVIN_DTLV_PATH         Path to the dtlv binary (default "dtlv").
 *   LEVIN_BB_PATH           Path to the levin-bb binary (preferred backend).
 *
 * Safety: read-only by default; the `database` argument must name a
 * configured database (path allowlist); agent-supplied EDN is strictly
 * validated before it reaches the query engine (see edn-guard.ts).
 *
 * Logging goes to stderr — stdout is the MCP transport.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    ListToolsRequestSchema,
    CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { DtlvCore } from '../dtlv-core';
import { AGENT_TOOLS } from './tool-definitions';
import { AgentToolRunner, DatabaseRef } from './tool-executor';

const VERSION = '0.8.6';

interface CliOptions {
    databases: DatabaseRef[];
    allowWrites: boolean;
    writableDirs: string[];
    maxRows?: number;
    timeoutMs?: number;
    maxValueChars?: number;
    dtlvPath?: string;
    bbPath?: string;
}

function parseDatabasesEnv(raw: string | undefined): DatabaseRef[] {
    if (!raw) { return []; }
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
        const arr = JSON.parse(trimmed) as Array<{ name?: string; path?: string }>;
        return arr
            .filter(e => e && typeof e.path === 'string')
            .map((e, i) => ({ name: e.name ?? `db${i + 1}`, path: e.path as string }));
    }
    return trimmed.split(';').map(s => s.trim()).filter(Boolean).map((pair, i) => {
        const eq = pair.indexOf('=');
        return eq > 0
            ? { name: pair.slice(0, eq).trim(), path: pair.slice(eq + 1).trim() }
            : { name: `db${i + 1}`, path: pair };
    });
}

function parseArgs(argv: string[]): CliOptions {
    const opts: CliOptions = {
        databases: [],
        allowWrites: process.env['LEVIN_ALLOW_WRITES'] === '1',
        writableDirs: (process.env['LEVIN_WRITABLE_DIRS'] ?? '').split(':').filter(Boolean)
    };
    opts.databases.push(...parseDatabasesEnv(process.env['LEVIN_DATABASES']));

    const num = (v: string | undefined): number | undefined => {
        if (v === undefined) { return undefined; }
        const n = parseInt(v, 10);
        return isNaN(n) ? undefined : n;
    };

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = (): string => {
            const v = argv[++i];
            if (v === undefined) { throw new Error(`flag ${a} needs a value`); }
            return v;
        };
        if (a === '--db') {
            const pair = next();
            const eq = pair.indexOf('=');
            opts.databases.push(eq > 0
                ? { name: pair.slice(0, eq), path: pair.slice(eq + 1) }
                : { name: `db${opts.databases.length + 1}`, path: pair });
        } else if (a === '--allow-writes') {
            opts.allowWrites = true;
        } else if (a === '--writable-dir') {
            opts.writableDirs.push(next());
        } else if (a === '--max-rows') {
            opts.maxRows = num(next());
        } else if (a === '--timeout-ms') {
            opts.timeoutMs = num(next());
        } else if (a === '--max-value-chars') {
            opts.maxValueChars = num(next());
        } else if (a === '--dtlv-path') {
            opts.dtlvPath = next();
        } else if (a === '--bb-path') {
            opts.bbPath = next();
        } else if (a === '--help' || a === '-h') {
            printHelp();
            process.exit(0);
        } else {
            throw new Error(`unknown flag: ${a}`);
        }
    }
    return opts;
}

function printHelp(): void {
    process.stderr.write(
        `levin-mcp-server — Levin Datalevin tools as an MCP server\n\n` +
        `  --db name=path        database to serve (repeatable)\n` +
        `  --allow-writes        enable transact/add_schema/create_database\n` +
        `  --writable-dir DIR    allow create_database under DIR (repeatable)\n` +
        `  --max-rows N          row cap per call (default 100)\n` +
        `  --timeout-ms N        per-call timeout ms (default 30000)\n` +
        `  --max-value-chars N   truncate long values (default 2000)\n` +
        `  --dtlv-path PATH      dtlv binary\n` +
        `  --bb-path PATH        levin-bb binary (preferred backend)\n\n` +
        `Env: LEVIN_DATABASES (JSON or name=path;...), LEVIN_ALLOW_WRITES=1,\n` +
        `     LEVIN_WRITABLE_DIRS (colon-separated), LEVIN_DTLV_PATH, LEVIN_BB_PATH\n`
    );
}

async function main(): Promise<void> {
    const opts = parseArgs(process.argv.slice(2));

    const core = new DtlvCore({
        dtlvPath: opts.dtlvPath ?? process.env['LEVIN_DTLV_PATH'] ?? 'dtlv',
        bbPath: opts.bbPath ?? process.env['LEVIN_BB_PATH'] ?? '',
        logger: { appendLine: (m: string) => process.stderr.write(m + '\n') }
    });

    const backendOk = await core.checkDtlvInstalled();
    if (!backendOk) {
        process.stderr.write('levin-mcp-server: no query backend found (need dtlv or levin-bb on PATH)\n');
        process.exit(1);
    }

    const runner = new AgentToolRunner(core, {
        databases: opts.databases,
        allowWrites: opts.allowWrites,
        writableDirs: opts.writableDirs,
        maxRows: opts.maxRows,
        queryTimeoutMs: opts.timeoutMs,
        maxValueChars: opts.maxValueChars
    });

    const served = new Set(runner.servedTools());

    const server = new Server(
        { name: 'levin', version: VERSION },
        { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: AGENT_TOOLS.filter(t => served.has(t.name)).map(t => ({
            name: t.name,
            description: t.description + (t.readOnly ? '' : ' [WRITE TOOL]'),
            inputSchema: t.inputSchema
        }))
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const name = request.params.name;
        const args = (request.params.arguments ?? {}) as Record<string, unknown>;
        try {
            const result = await runner.execute(name, args);
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[levin-mcp] tool ${name} failed: ${message}\n`);
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true
            };
        }
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    const mode = opts.allowWrites ? 'read-write' : 'read-only';
    process.stderr.write(
        `levin-mcp-server ${VERSION} (${mode}) serving ${served.size} tools, ` +
        `${opts.databases.length} database(s)\n`
    );
}

// Allow import without side effects in tests.
if (require.main === module) {
    main().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`levin-mcp-server: fatal: ${message}\n`);
        process.exit(1);
    });
}

export { parseArgs, parseDatabasesEnv };
