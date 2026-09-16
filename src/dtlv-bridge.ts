/**
 * Levin VS Code bridge — thin VS Code wrapper over the vscode-free engine.
 *
 * All database logic lives in {@link DtlvCore} (`./dtlv-core`). This module
 * exists so the rest of the extension keeps working unchanged: it re-exports
 * every type the engine defines and provides `DtlvBridge`, a `DtlvCore`
 * subclass that reads the `levin.*` settings, adapts the VS Code output
 * channel to {@link CoreLogger}, and implements the {@link CoreUiCallbacks}
 * hooks with real VS Code dialogs.
 *
 * New hosts (MCP server, tests, scripts) should import from `./dtlv-core`
 * directly instead of this file.
 */
import * as vscode from 'vscode';
import {
    DtlvCore,
    CoreLogger,
    CoreUiCallbacks,
    VectorOpts
} from './dtlv-core';

export * from './dtlv-core';

/**
 * VS Code host for the Datalevin engine. Constructor and public API are
 * identical to the pre-split `DtlvBridge`, so callers need no changes.
 */
export class DtlvBridge extends DtlvCore {
    constructor(outputChannel?: vscode.OutputChannel) {
        const config = vscode.workspace.getConfiguration('levin');
        const logger: CoreLogger | undefined = outputChannel
            ? {
                appendLine: (message: string) => outputChannel.appendLine(message),
                show: (preserveFocus?: boolean) => outputChannel.show(preserveFocus)
            }
            : undefined;
        super({
            dtlvPath: config.get<string>('dtlvPath', 'dtlv'),
            bbPath: config.get<string>('bbPath', ''),
            queryHistorySize: config.get<number>('queryHistorySize', 100),
            resultPageSize: config.get<number>('resultPageSize', 50),
            recentDatabases: config.get<string[]>('recentDatabases', []),
            logger,
            ui: DtlvBridge.createUiCallbacks()
        });
    }

    /**
     * Implement the engine's UI hooks with VS Code dialogs. Kept static so
     * the callbacks don't capture the bridge instance.
     */
    private static createUiCallbacks(): CoreUiCallbacks {
        return {
            notifyInfo: (message: string) => {
                void vscode.window.showInformationMessage(message);
            },
            notifyWarning: (message: string) => {
                void vscode.window.showWarningMessage(message);
            },
            notifyError: (message: string) => {
                void vscode.window.showErrorMessage(message);
            },
            askChoice: async (message: string, options: string[], style?: 'info' | 'warning' | 'error') => {
                if (style === 'error') {
                    return vscode.window.showErrorMessage(message, ...options);
                }
                if (style === 'warning') {
                    return vscode.window.showWarningMessage(message, ...options);
                }
                return vscode.window.showInformationMessage(message, ...options);
            },
            askInput: async (prompt: string, placeHolder?: string) => {
                return vscode.window.showInputBox({ prompt, placeHolder });
            },
            askVectorOpts: async (dbName: string): Promise<VectorOpts | undefined> => {
                const dimsInput = await vscode.window.showInputBox({
                    prompt: `"${dbName}" has vector attributes. Enter its vector dimensions to enable queries.`,
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
            },
            withProgress: async <T>(title: string, task: () => Promise<T>): Promise<T> => {
                return vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title,
                        cancellable: false
                    },
                    task
                );
            },
            openUrl: (url: string) => {
                void vscode.env.openExternal(vscode.Uri.parse(url));
            },
            persistSetting: async (key: string, value: string): Promise<void> => {
                const config = vscode.workspace.getConfiguration('levin');
                await config.update(key, value, vscode.ConfigurationTarget.Global);
            }
        };
    }
}
