import * as vscode from 'vscode';

export class Settings {
    private readonly config: vscode.WorkspaceConfiguration;

    constructor() {
        this.config = vscode.workspace.getConfiguration('levin');
    }

    get envFile(): string {
        return this.config.get<string>('envFile', '.env');
    }

    get autoJackIn(): boolean {
        return this.config.get<boolean>('autoJackIn', true);
    }

    get queryHistorySize(): number {
        return this.config.get<number>('queryHistorySize', 100);
    }

    get resultPageSize(): number {
        return this.config.get<number>('resultPageSize', 50);
    }

    get datalevinVersion(): string {
        return this.config.get<string>('datalevinVersion', '0.9.12');
    }

    async update(key: string, value: unknown): Promise<void> {
        await this.config.update(key, value, vscode.ConfigurationTarget.Workspace);
    }

    static onDidChange(callback: () => void): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('levin')) {
                callback();
            }
        });
    }
}
