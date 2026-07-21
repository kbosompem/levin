import * as assert from 'assert';
import * as vscode from 'vscode';
import { ipynbToNotebook, notebookToIpynb, LevinNotebookSerializer, IpynbFile } from '../../notebook/serializer';

const SAMPLE_IPYNB: IpynbFile = {
    cells: [
        {
            cell_type: 'markdown',
            source: ['# Chapter 1\n', '\n', 'Run these queries in order.\n'],
            metadata: {}
        },
        {
            cell_type: 'code',
            source: ['{:db "/tmp/shop"\n', ' :query [:find ?e :where [?e :user/name ?n]]\n', ' :limit 10}'],
            metadata: {},
            execution_count: 1,
            outputs: [
                {
                    output_type: 'execute_result',
                    data: {
                        'text/plain': ['2 results\n', '[[1 "Ada"] [2 "Grace"]]'],
                        'application/json': { total: 2, truncated: false, results: [[1, 'Ada'], [2, 'Grace']] }
                    },
                    metadata: {},
                    execution_count: 1
                }
            ]
        },
        {
            cell_type: 'code',
            source: ['[:find (count ?e) :where [?e :user/name _]]'],
            metadata: {},
            execution_count: null,
            outputs: []
        }
    ],
    metadata: { levin: {}, kernelspec: { name: 'levin' } },
    nbformat: 4,
    nbformat_minor: 5
};

suite('Notebook Serializer Test Suite', () => {

    suite('ipynbToNotebook', () => {
        test('Markdown and code cells keep kind, language and source', () => {
            const nb = ipynbToNotebook(SAMPLE_IPYNB);
            assert.strictEqual(nb.cells.length, 3);

            assert.strictEqual(nb.cells[0].kind, vscode.NotebookCellKind.Markup);
            assert.strictEqual(nb.cells[0].languageId, 'markdown');
            assert.strictEqual(nb.cells[0].value, '# Chapter 1\n\nRun these queries in order.\n');

            assert.strictEqual(nb.cells[1].kind, vscode.NotebookCellKind.Code);
            assert.strictEqual(nb.cells[1].languageId, 'datalevin-query');
            assert.ok(nb.cells[1].value.includes('{:db "/tmp/shop"'));
            assert.ok(nb.cells[1].value.endsWith(' :limit 10}'));
        });

        test('Persisted outputs and execution count survive', () => {
            const nb = ipynbToNotebook(SAMPLE_IPYNB);
            const cell = nb.cells[1];

            assert.strictEqual(cell.outputs?.length, 1);
            const mimes = cell.outputs![0].items.map(i => i.mime);
            assert.ok(mimes.includes('text/plain'));
            assert.ok(mimes.includes('application/json'));
            assert.strictEqual(cell.executionSummary?.executionOrder, 1);
        });

        test('Missing cells array yields an empty notebook', () => {
            const nb = ipynbToNotebook({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 });
            assert.strictEqual(nb.cells.length, 0);
        });
    });

    suite('notebookToIpynb', () => {
        test('Cells serialize with ipynb line arrays and kernelspec', () => {
            const nb = ipynbToNotebook(SAMPLE_IPYNB);
            const json = notebookToIpynb(nb);

            assert.strictEqual(json.nbformat, 4);
            assert.strictEqual((json.metadata as Record<string, Record<string, unknown>>).kernelspec.name, 'levin');
            assert.strictEqual(json.cells.length, 3);
            assert.strictEqual(json.cells[0].cell_type, 'markdown');
            assert.deepStrictEqual(json.cells[0].source, ['# Chapter 1\n', '\n', 'Run these queries in order.\n']);
            assert.strictEqual(json.cells[1].cell_type, 'code');
            assert.deepStrictEqual(json.cells[2].source, ['[:find (count ?e) :where [?e :user/name _]]']);
        });

        test('Success outputs serialize as execute_result with both mimes', () => {
            const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '[:find ?e :where [?e :a _]]', 'datalevin-query');
            cell.outputs = [new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.text('1 results\n[[1]]', 'text/plain'),
                new vscode.NotebookCellOutputItem(Buffer.from(JSON.stringify({ total: 1 })), 'application/json')
            ])];
            const json = notebookToIpynb(new vscode.NotebookData([cell]));

            const output = json.cells[0].outputs![0];
            assert.strictEqual(output.output_type, 'execute_result');
            assert.deepStrictEqual(output.data!['text/plain'], ['1 results\n', '[[1]]']);
            assert.deepStrictEqual(output.data!['application/json'], { total: 1 });
        });

        test('The rich-results mimetype survives serialization both ways', async () => {
            const { RESULTS_MIME } = await import('../../notebook/results-payload');
            const payload = { total: 1, truncated: false, rows: [[1]], columnNames: ['?e'], entityColumns: [true], dbPath: '/tmp/db' };
            const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '[:find ?e :where [?e :a _]]', 'datalevin-query');
            cell.outputs = [new vscode.NotebookCellOutput([
                new vscode.NotebookCellOutputItem(Buffer.from(JSON.stringify(payload)), RESULTS_MIME)
            ])];

            const json = notebookToIpynb(new vscode.NotebookData([cell]));
            assert.deepStrictEqual(json.cells[0].outputs![0].data![RESULTS_MIME], payload);

            const back = ipynbToNotebook(json);
            const mimeItem = back.cells[0].outputs![0].items.find(i => i.mime === RESULTS_MIME);
            assert.ok(mimeItem, 'custom mime item should survive deserialization');
            assert.deepStrictEqual(JSON.parse(Buffer.from(mimeItem!.data).toString('utf-8')), payload);
        });

        test('Error outputs serialize as ipynb error objects', () => {
            const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '[:find ?x]', 'datalevin-query');
            const err = new Error('Query failed: unbound var');
            err.stack = 'Error: Query failed: unbound var\n    at somewhere';
            cell.outputs = [new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(err)])];

            const json = notebookToIpynb(new vscode.NotebookData([cell]));
            const output = json.cells[0].outputs![0];
            assert.strictEqual(output.output_type, 'error');
            assert.strictEqual(output.evalue, 'Query failed: unbound var');
            assert.ok(Array.isArray(output.traceback));
        });
    });

    suite('round-trip', () => {
        test('ipynb -> notebook -> ipynb preserves cells and outputs', () => {
            const once = notebookToIpynb(ipynbToNotebook(SAMPLE_IPYNB));
            const twice = notebookToIpynb(ipynbToNotebook(once));

            assert.strictEqual(twice.cells.length, once.cells.length);
            assert.strictEqual(twice.cells[0].cell_type, 'markdown');
            assert.deepStrictEqual(twice.cells[0].source, once.cells[0].source);
            assert.deepStrictEqual(twice.cells[1].source, once.cells[1].source);
            assert.strictEqual(twice.cells[1].outputs!.length, once.cells[1].outputs!.length);
            assert.strictEqual(
                (twice.cells[1].outputs![0].data as Record<string, unknown>)['application/json'] !== undefined,
                true
            );
        });

        test('Serializer handles empty buffer', () => {
            const serializer = new LevinNotebookSerializer();
            const nb = serializer.deserializeNotebook(new Uint8Array(0));
            assert.strictEqual(nb.cells.length, 0);
        });
    });
});
