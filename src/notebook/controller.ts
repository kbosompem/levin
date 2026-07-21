/**
 * Notebook execution controller: runs code cells against Datalevin through
 * the same bridge path as query files. A cell's :db comes from itself, or
 * the nearest preceding code cell (same inheritance as .dtlv.edn files),
 * or the only open database.
 */
import * as vscode from 'vscode';
import { DtlvBridge } from '../dtlv-bridge';
import { parseStatements, isRunnable, parseRulesSpec, splitEdnVector, QueryStatement } from '../utils/query-statements';
import { formatQueryError } from '../utils/error-formatter';
import { toEdn } from '../utils/formatters';
import { NOTEBOOK_TYPE } from './serializer';
import { buildResultsPayload, RESULTS_MIME } from './results-payload';
import { buildChartSpec, CHART_MIME } from './chart-spec';

interface RunResults {
    total?: number;
    truncated?: boolean;
    results?: unknown[];
}

export class LevinNotebookController implements vscode.Disposable {
    private readonly controller: vscode.NotebookController;
    private readonly messaging: vscode.NotebookRendererMessaging;

    constructor(private readonly bridge: DtlvBridge, private readonly outputChannel: vscode.OutputChannel) {
        this.controller = vscode.notebooks.createNotebookController(
            'levin-notebook-controller',
            NOTEBOOK_TYPE,
            'Levin (Datalevin)'
        );
        this.controller.supportedLanguages = ['datalevin-query'];
        this.controller.supportsExecutionOrder = true;
        this.controller.description = 'Run cells against Datalevin via dtlv';
        this.controller.executeHandler = this.executeAll.bind(this);

        // Entity links in the rich renderer open the inspector
        this.messaging = vscode.notebooks.createRendererMessaging('levin.results-renderer');
        this.messaging.onDidReceiveMessage(event => {
            const message = event?.message ?? event;
            if (message?.type === 'inspectEntity' && message.dbPath && typeof message.entityId === 'number') {
                vscode.commands.executeCommand('levin.showEntity', message.dbPath, message.entityId);
            }
        });
    }

    dispose(): void {
        this.controller.dispose();
    }

    private async executeAll(
        cells: vscode.NotebookCell[],
        notebook: vscode.NotebookDocument,
        _controller: vscode.NotebookController
    ): Promise<void> {
        for (const cell of cells) {
            await this.executeCell(cell, notebook);
        }
    }

    private async executeCell(cell: vscode.NotebookCell, notebook: vscode.NotebookDocument): Promise<void> {
        const execution = this.controller.createNotebookCellExecution(cell);
        execution.start(Date.now());
        execution.clearOutput();

        try {
            const statements = parseStatements(cell.document.getText());
            const runnable = statements.filter(isRunnable);

            if (runnable.length === 0) {
                await execution.replaceOutput([errorOutput('This cell has no :query, :transact, or :solve statement.')]);
                execution.end(false, Date.now());
                return;
            }

            const dbPath = this.resolveDbForCell(notebook, cell, statements);
            if (!dbPath) {
                await execution.replaceOutput([errorOutput(
                    'No database for this cell. Add :db to it or an earlier cell, or open a database in the Levin sidebar.'
                )]);
                execution.end(false, Date.now());
                return;
            }

            for (const stmt of runnable) {
                const ok = stmt.transactText
                    ? await this.runTransaction(execution, dbPath, stmt)
                    : stmt.solveText
                        ? await this.runSolve(execution, dbPath, stmt)
                        : await this.runQuery(execution, dbPath, stmt);
                if (!ok) {
                    execution.end(false, Date.now());
                    return;
                }
            }

            execution.end(true, Date.now());
        } catch (error) {
            await execution.replaceOutput([errorOutput(String(error))]);
            execution.end(false, Date.now());
        }
    }

    private async runQuery(
        execution: vscode.NotebookCellExecution,
        dbPath: string,
        stmt: QueryStatement
    ): Promise<boolean> {
        const result = await this.bridge.runQuery(dbPath, stmt.queryText!, stmt.limit ?? 50, {
            rules: stmt.rulesText ? parseRulesSpec(stmt.rulesText) : undefined,
            args: stmt.argsText ? splitEdnVector(stmt.argsText) : undefined
        });

        if (!result.success) {
            await execution.appendOutput([errorOutput(result.error ?? 'Unknown error')]);
            return false;
        }

        const data = (result.data ?? {}) as RunResults;
        const rows = data.results ?? [];
        const header = data.truncated
            ? `${data.total ?? rows.length} total, first ${rows.length} shown`
            : `${data.total ?? rows.length} results`;

        const items: vscode.NotebookCellOutputItem[] = [];

        // Chart statements lead with the Vega-Lite spec so the chart is
        // the default presentation; the table stays one mime-picker away
        if (stmt.chartText) {
            const spec = buildChartSpec(stmt.chartText, stmt.queryText!, result.data);
            if (spec) {
                items.push(new vscode.NotebookCellOutputItem(
                    Buffer.from(JSON.stringify(spec)),
                    CHART_MIME
                ));
            }
        }

        items.push(
            new vscode.NotebookCellOutputItem(
                Buffer.from(JSON.stringify(buildResultsPayload(result.data, stmt.queryText!, dbPath))),
                RESULTS_MIME
            ),
            new vscode.NotebookCellOutputItem(
                Buffer.from(JSON.stringify(result.data)),
                'application/json'
            ),
            vscode.NotebookCellOutputItem.text(`${header}\n${toEdn(rows)}`, 'text/plain')
        );

        await execution.appendOutput([new vscode.NotebookCellOutput(items)]);
        return true;
    }

    private async runSolve(
        execution: vscode.NotebookCellExecution,
        dbPath: string,
        stmt: QueryStatement
    ): Promise<boolean> {
        const result = await this.bridge.solve(dbPath, {
            solveText: stmt.solveText!,
            pickText: stmt.pickText,
            suchThatText: stmt.suchThatText,
            maximizeText: stmt.maximizeText,
            minimizeText: stmt.minimizeText,
            limit: stmt.limit
        }, {
            rules: stmt.rulesText ? parseRulesSpec(stmt.rulesText) : undefined,
            args: stmt.argsText ? splitEdnVector(stmt.argsText) : undefined
        });

        if (!result.success) {
            await execution.appendOutput([errorOutput(result.error ?? 'Unknown error')]);
            return false;
        }

        const data = (result.data ?? {}) as RunResults & {
            findVars?: string[];
            summary?: { objective?: number; spent?: number; budget?: number };
        };
        const rows = data.results ?? [];
        const solutions = data.total ?? 0;
        let header = data.truncated
            ? `${solutions} solutions shown (more exist)`
            : `${solutions} solution${solutions === 1 ? '' : 's'}`;
        if (data.summary?.objective !== undefined) {
            header += ` · objective ${data.summary.objective}`;
            if (data.summary.spent !== undefined) {
                header += `, spent ${data.summary.spent} of ${data.summary.budget}`;
            }
        }

        // Synthesize a :find clause (?solution + the query's vars) so the
        // rich table renderer derives the same columns the solver returns
        const syntheticQuery = `[:find ?solution ${(data.findVars ?? []).join(' ')} :where]`;

        const items: vscode.NotebookCellOutputItem[] = [];

        // :chart composes with :solve exactly as with :query - the chart
        // leads, the table stays one mime-picker away
        if (stmt.chartText) {
            const spec = buildChartSpec(stmt.chartText, syntheticQuery, result.data);
            if (spec) {
                items.push(new vscode.NotebookCellOutputItem(
                    Buffer.from(JSON.stringify(spec)),
                    CHART_MIME
                ));
            }
        }

        items.push(
            new vscode.NotebookCellOutputItem(
                Buffer.from(JSON.stringify(buildResultsPayload(result.data, syntheticQuery, dbPath))),
                RESULTS_MIME
            ),
            new vscode.NotebookCellOutputItem(
                Buffer.from(JSON.stringify(result.data)),
                'application/json'
            ),
            vscode.NotebookCellOutputItem.text(`${header}\n${toEdn(rows)}`, 'text/plain')
        );

        await execution.appendOutput([new vscode.NotebookCellOutput(items)]);
        return true;
    }

    private async runTransaction(
        execution: vscode.NotebookCellExecution,
        dbPath: string,
        stmt: QueryStatement
    ): Promise<boolean> {
        const result = await this.bridge.transact(dbPath, stmt.transactText!);

        if (!result.success) {
            await execution.appendOutput([errorOutput(result.error ?? 'Unknown error')]);
            return false;
        }

        const data = (result.data ?? {}) as { txId?: number; datomsCount?: number };
        await execution.appendOutput([new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.text(
                `Transaction successful: ${data.datomsCount ?? 0} datoms added (tx ${data.txId ?? '?'})`
            )
        ])]);
        return true;
    }

    /**
     * The statement's own :db, otherwise the nearest :db in an earlier code
     * cell, otherwise the only open database.
     */
    private resolveDbForCell(
        notebook: vscode.NotebookDocument,
        cell: vscode.NotebookCell,
        statements: QueryStatement[]
    ): string | null {
        const own = statements.find(s => s.db);
        if (own?.db) {
            return own.db;
        }

        for (let i = cell.index - 1; i >= 0; i--) {
            const candidate = notebook.cellAt(i);
            if (candidate.kind !== vscode.NotebookCellKind.Code) {
                continue;
            }
            const stmts = parseStatements(candidate.document.getText());
            for (let j = stmts.length - 1; j >= 0; j--) {
                if (stmts[j].db) {
                    return stmts[j].db!;
                }
            }
        }

        const open = this.bridge.getOpenDatabases();
        return open.length === 1 ? open[0].path : null;
    }
}

function errorOutput(message: string): vscode.NotebookCellOutput {
    const friendly = formatQueryError(message);
    const err = new Error(friendly.hint ? `${friendly.summary}\n${friendly.hint}` : friendly.summary);
    err.name = friendly.type;
    err.stack = friendly.raw;
    return new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(err)]);
}
