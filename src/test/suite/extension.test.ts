import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('KwabenaBosompem.levin'));
    });

    test('Extension should activate', async () => {
        const ext = vscode.extensions.getExtension('KwabenaBosompem.levin');
        if (ext) {
            await ext.activate();
            assert.strictEqual(ext.isActive, true);
        }
    });

    test('Commands should be registered', async () => {
        const commands = await vscode.commands.getCommands(true);

        const expectedCommands = [
            'levin.openDatabase',
            'levin.newQuery',
            'levin.runQuery',
            'levin.showEntity',
            'levin.refreshExplorer',
            'levin.exportResults',
            'levin.closeDatabase',
            'levin.createDatabase',
            'levin.editSchema',
            'levin.showTransactionPanel',
            'levin.importData',
            'levin.browseEntities',
            'levin.showKvStore'
        ];

        for (const cmd of expectedCommands) {
            assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`);
        }
    });
});
