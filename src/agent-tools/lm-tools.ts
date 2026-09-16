/**
 * VS Code Language Model tools for Levin (issue #21, step 3).
 *
 * Registers the shared agent-tool catalog (`tool-definitions.ts`) with
 * `vscode.lm` so in-editor agents (agent mode, Copilot) can inspect schemas
 * and run queries against Levin databases. Same tools, same descriptions,
 * same safety policy as the MCP server — only the transport differs.
 *
 * Tool names are prefixed `levin_` in VS Code to avoid collisions with other
 * extensions; the prefix is stripped before dispatching to `AgentToolRunner`.
 *
 * Settings (contributed under `levin.agentTools.*`):
 *  - databases:   [{name, path}] databases agents may open (the path allowlist)
 *  - allowWrites:  enable transact/add_schema/create_database (default false)
 *  - maxRows:      row cap per call (default 100)
 *  - timeoutMs:    per-call timeout in ms (default 30000)
 */
import * as vscode from 'vscode';
import { DtlvCore } from '../dtlv-core';
import { AGENT_TOOLS } from './tool-definitions';
import { AgentToolRunner, DatabaseRef, ToolExecutionError } from './tool-executor';

export const LM_TOOL_PREFIX = 'levin_';

export interface LmToolsConfig {
    databases: DatabaseRef[];
    allowWrites: boolean;
    maxRows: number;
    timeoutMs: number;
}

export function readLmToolsConfig(): LmToolsConfig {
    const config = vscode.workspace.getConfiguration('levin');
    const section = config.get<{
        databases?: Array<{ name?: string; path?: string }>;
        allowWrites?: boolean;
        maxRows?: number;
        timeoutMs?: number;
    }>('agentTools', {});
    const databases = (section.databases ?? [])
        .filter(d => d && typeof d.path === 'string' && d.path.length > 0)
        .map((d, i) => ({ name: d.name ?? `db${i + 1}`, path: d.path as string }));
    return {
        databases,
        allowWrites: section.allowWrites === true,
        maxRows: typeof section.maxRows === 'number' && section.maxRows > 0 ? Math.floor(section.maxRows) : 100,
        timeoutMs: typeof section.timeoutMs === 'number' && section.timeoutMs > 0 ? Math.floor(section.timeoutMs) : 30_000
    };
}

class LevinLmTool implements vscode.LanguageModelTool<Record<string, unknown>> {
    constructor(
        private readonly toolName: string,
        private readonly runner: AgentToolRunner,
        private readonly output: vscode.OutputChannel
    ) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<Record<string, unknown>>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        if (token.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
        const args = options.input ?? {};
        this.output.appendLine(`[levin] LM tool ${this.toolName} called`);
        try {
            const result = await this.runner.execute(this.toolName, args);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2))
            ]);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.output.appendLine(`[levin] LM tool ${this.toolName} failed: ${message}`);
            if (err instanceof ToolExecutionError) {
                // Policy / validation failures are reported to the model as
                // tool errors it can learn from (bad database name, unsafe
                // input, writes disabled), not as host exceptions.
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Error: ${message}`)
                ]);
            }
            throw err;
        }
    }
}

/**
 * Register Levin's agent tools with vscode.lm. Read-only tools are always
 * registered; write tools only when `levin.agentTools.allowWrites` is true.
 * Returns disposables to add to the extension context subscriptions.
 */
export function registerLevinLmTools(
    core: DtlvCore,
    output: vscode.OutputChannel
): vscode.Disposable[] {
    const cfg = readLmToolsConfig();
    const runner = new AgentToolRunner(core, {
        databases: cfg.databases,
        allowWrites: cfg.allowWrites,
        maxRows: cfg.maxRows,
        queryTimeoutMs: cfg.timeoutMs
    });

    const disposables: vscode.Disposable[] = [];
    for (const def of AGENT_TOOLS) {
        if (!def.readOnly && !cfg.allowWrites) {
            continue;
        }
        const vsName = LM_TOOL_PREFIX + def.name;
        disposables.push(
            vscode.lm.registerTool(vsName, new LevinLmTool(def.name, runner, output))
        );
    }
    output.appendLine(
        `[levin] registered ${disposables.length} language model tools ` +
        `(writes ${cfg.allowWrites ? 'enabled' : 'disabled'}, ${cfg.databases.length} database(s))`
    );
    return disposables;
}
