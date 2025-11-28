import * as assert from 'assert';
import { parseEdn } from '../../utils/edn-parser';

suite('EDN Parser Test Suite', () => {
    test('Should parse nil', () => {
        assert.strictEqual(parseEdn('nil'), null);
    });

    test('Should parse booleans', () => {
        assert.strictEqual(parseEdn('true'), true);
        assert.strictEqual(parseEdn('false'), false);
    });

    test('Should parse integers', () => {
        assert.strictEqual(parseEdn('42'), 42);
        assert.strictEqual(parseEdn('-42'), -42);
        assert.strictEqual(parseEdn('0'), 0);
    });

    test('Should parse floats', () => {
        assert.strictEqual(parseEdn('3.14'), 3.14);
        assert.strictEqual(parseEdn('-3.14'), -3.14);
        assert.strictEqual(parseEdn('1.5e10'), 1.5e10);
    });

    test('Should parse strings', () => {
        assert.strictEqual(parseEdn('"hello"'), 'hello');
        assert.strictEqual(parseEdn('"hello world"'), 'hello world');
        assert.strictEqual(parseEdn('""'), '');
    });

    test('Should parse strings with escapes', () => {
        assert.strictEqual(parseEdn('"hello\\nworld"'), 'hello\nworld');
        assert.strictEqual(parseEdn('"hello\\tworld"'), 'hello\tworld');
        assert.strictEqual(parseEdn('"say \\"hi\\""'), 'say "hi"');
    });

    test('Should parse keywords', () => {
        assert.strictEqual(parseEdn(':keyword'), ':keyword');
        assert.strictEqual(parseEdn(':user/name'), ':user/name');
    });

    test('Should parse vectors', () => {
        const result = parseEdn('[1 2 3]');
        assert.ok(Array.isArray(result));
        assert.deepStrictEqual(result, [1, 2, 3]);
    });

    test('Should parse nested vectors', () => {
        const result = parseEdn('[[1 2] [3 4]]');
        assert.deepStrictEqual(result, [[1, 2], [3, 4]]);
    });

    test('Should parse maps', () => {
        const result = parseEdn('{:name "Alice" :age 30}') as Record<string, unknown>;
        assert.strictEqual(result[':name'], 'Alice');
        assert.strictEqual(result[':age'], 30);
    });

    test('Should parse nested maps', () => {
        const result = parseEdn('{:user {:name "Alice"}}') as Record<string, unknown>;
        const user = result[':user'] as Record<string, unknown>;
        assert.strictEqual(user[':name'], 'Alice');
    });

    test('Should parse lists', () => {
        const result = parseEdn('(1 2 3)');
        assert.ok(Array.isArray(result));
        assert.deepStrictEqual(result, [1, 2, 3]);
    });

    test('Should parse sets', () => {
        const result = parseEdn('#{1 2 3}');
        assert.ok(Array.isArray(result));
        assert.strictEqual((result as number[]).length, 3);
    });

    test('Should parse inst tagged literal', () => {
        const result = parseEdn('#inst "2024-01-15T10:30:00.000Z"');
        assert.ok(result instanceof Date);
    });

    test('Should handle whitespace', () => {
        const result = parseEdn('  [ 1 , 2 , 3 ]  ');
        assert.deepStrictEqual(result, [1, 2, 3]);
    });

    test('Should handle comments', () => {
        const result = parseEdn(';; comment\n42');
        assert.strictEqual(result, 42);
    });

    test('Should parse complex nested structure', () => {
        const edn = `{:results [[1 "Alice" "alice@example.com"]
                               [2 "Bob" "bob@example.com"]]
                     :total 2
                     :truncated false}`;
        const result = parseEdn(edn) as Record<string, unknown>;

        assert.strictEqual(result[':total'], 2);
        assert.strictEqual(result[':truncated'], false);

        const results = result[':results'] as unknown[][];
        assert.strictEqual(results.length, 2);
        assert.strictEqual(results[0][1], 'Alice');
    });
});
