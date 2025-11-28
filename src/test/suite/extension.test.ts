import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('KayBosompem.levin'));
    });

    test('Extension should activate', async () => {
        const ext = vscode.extensions.getExtension('KayBosompem.levin');
        if (ext) {
            await ext.activate();
            assert.strictEqual(ext.isActive, true);
        }
    });

    test('Commands should be registered', async () => {
        const commands = await vscode.commands.getCommands(true);

        const expectedCommands = [
            'levin.jackIn',
            'levin.newQuery',
            'levin.runQuery',
            'levin.showEntity',
            'levin.refreshExplorer',
            'levin.exportResults',
            'levin.disconnect',
            'levin.addDatabase',
            'levin.createDatabase'
        ];

        for (const cmd of expectedCommands) {
            assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`);
        }
    });
});
