import * as assert from 'assert';
import { buildResultsPayload } from '../../notebook/results-payload';

suite('Results Payload Test Suite', () => {

    test('Columns and entity flags come from the query', () => {
        const payload = buildResultsPayload(
            { total: 8, truncated: false, results: [['Chai', 18.0]] },
            '[:find ?name ?price :where [?p :product/name ?name] [?p :product/unit-price ?price]]',
            '/tmp/db'
        );

        assert.deepStrictEqual(payload.columnNames, ['?name', '?price']);
        assert.deepStrictEqual(payload.entityColumns, [false, false]);
        assert.deepStrictEqual(payload.rows, [['Chai', 18.0]]);
        assert.strictEqual(payload.total, 8);
        assert.strictEqual(payload.truncated, false);
        assert.strictEqual(payload.dbPath, '/tmp/db');
    });

    test('Entity-position variables mark entity columns', () => {
        const payload = buildResultsPayload(
            { total: 1, results: [[1, 'Ada']] },
            '[:find ?e ?name :where [?e :user/name ?name]]',
            '/tmp/db'
        );
        assert.deepStrictEqual(payload.entityColumns, [true, false]);
    });

    test('Missing data degrades to an empty result set', () => {
        const payload = buildResultsPayload(undefined, '', '/tmp/db');
        assert.deepStrictEqual(payload.rows, []);
        assert.strictEqual(payload.total, 0);
        assert.strictEqual(payload.truncated, false);
        assert.deepStrictEqual(payload.columnNames, []);
        assert.deepStrictEqual(payload.entityColumns, []);
    });

    test('Truncation flag is preserved', () => {
        const payload = buildResultsPayload(
            { total: 500, truncated: true, results: [[1]] },
            '[:find ?e :where [?e :a _]]',
            '/tmp/db'
        );
        assert.strictEqual(payload.total, 500);
        assert.strictEqual(payload.truncated, true);
    });
});
