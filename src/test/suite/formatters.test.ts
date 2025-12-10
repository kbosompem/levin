import * as assert from 'assert';
import { formatValue, truncate, toEdn, parseAttributeParts, extractFindColumns } from '../../utils/formatters';

suite('Formatters Test Suite', () => {
    suite('formatValue', () => {
        test('Should format null as nil', () => {
            assert.strictEqual(formatValue(null), 'nil');
            assert.strictEqual(formatValue(undefined), 'nil');
        });

        test('Should format strings with quotes', () => {
            assert.strictEqual(formatValue('hello'), '"hello"');
        });

        test('Should format numbers', () => {
            assert.strictEqual(formatValue(42), '42');
            assert.strictEqual(formatValue(3.14), '3.14');
        });

        test('Should format booleans', () => {
            assert.strictEqual(formatValue(true), 'true');
            assert.strictEqual(formatValue(false), 'false');
        });

        test('Should format small arrays', () => {
            assert.strictEqual(formatValue([1, 2, 3]), '[1 2 3]');
        });

        test('Should format large arrays with summary', () => {
            const result = formatValue([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
            assert.strictEqual(result, '[10 items]');
        });

        test('Should format dates', () => {
            const date = new Date('2024-01-15T10:30:00Z');
            const result = formatValue(date);
            assert.ok(result.startsWith('#inst'));
        });
    });

    suite('truncate', () => {
        test('Should not truncate short strings', () => {
            assert.strictEqual(truncate('hello', 10), 'hello');
        });

        test('Should truncate long strings', () => {
            assert.strictEqual(truncate('hello world', 8), 'hello...');
        });

        test('Should handle exact length', () => {
            assert.strictEqual(truncate('hello', 5), 'hello');
        });
    });

    suite('toEdn', () => {
        test('Should convert null to nil', () => {
            assert.strictEqual(toEdn(null), 'nil');
        });

        test('Should convert strings', () => {
            assert.strictEqual(toEdn('hello'), '"hello"');
        });

        test('Should escape special characters in strings', () => {
            assert.strictEqual(toEdn('hello\nworld'), '"hello\\nworld"');
        });

        test('Should convert numbers', () => {
            assert.strictEqual(toEdn(42), '42');
        });

        test('Should convert booleans', () => {
            assert.strictEqual(toEdn(true), 'true');
            assert.strictEqual(toEdn(false), 'false');
        });

        test('Should convert arrays to vectors', () => {
            assert.strictEqual(toEdn([1, 2, 3]), '[1 2 3]');
        });

        test('Should convert objects to maps', () => {
            const result = toEdn({ name: 'Alice', age: 30 });
            assert.ok(result.includes(':name'));
            assert.ok(result.includes('"Alice"'));
        });
    });

    suite('parseAttributeParts', () => {
        test('Should parse namespaced attribute', () => {
            const result = parseAttributeParts(':user/name');
            assert.strictEqual(result.namespace, 'user');
            assert.strictEqual(result.name, 'name');
        });

        test('Should handle attribute without colon', () => {
            const result = parseAttributeParts('user/name');
            assert.strictEqual(result.namespace, 'user');
            assert.strictEqual(result.name, 'name');
        });

        test('Should handle attribute without namespace', () => {
            const result = parseAttributeParts(':name');
            assert.strictEqual(result.namespace, '');
            assert.strictEqual(result.name, 'name');
        });
    });

    suite('extractFindColumns', () => {
        test('Should extract simple variables', () => {
            const query = '[:find ?e ?name ?age :where [?e :user/name ?name]]';
            const columns = extractFindColumns(query);
            assert.deepStrictEqual(columns, ['?e', '?name', '?age']);
        });

        test('Should handle multiline query', () => {
            const query = `[:find ?e ?name
                           :where [?e :user/name ?name]]`;
            const columns = extractFindColumns(query);
            assert.deepStrictEqual(columns, ['?e', '?name']);
        });

        test('Should extract aggregate functions', () => {
            const query = '[:find (count ?e) :where [?e :user/name _]]';
            const columns = extractFindColumns(query);
            assert.deepStrictEqual(columns, ['count(?e)']);
        });

        test('Should extract multiple aggregates', () => {
            const query = '[:find (count ?e) (sum ?amount) :where [?e :order/amount ?amount]]';
            const columns = extractFindColumns(query);
            assert.deepStrictEqual(columns, ['count(?e)', 'sum(?amount)']);
        });

        test('Should handle pull expressions', () => {
            const query = '[:find (pull ?e [:name :age]) :where [?e :user/name _]]';
            const columns = extractFindColumns(query);
            assert.deepStrictEqual(columns, ['pull(?e)']);
        });

        test('Should handle scalar result (single value with .)', () => {
            const query = '[:find ?name . :where [?e :user/name ?name]]';
            const columns = extractFindColumns(query);
            assert.deepStrictEqual(columns, ['?name']);
        });

        test('Should handle collection result [?e ...]', () => {
            const query = '[:find [?name ...] :where [?e :user/name ?name]]';
            const columns = extractFindColumns(query);
            assert.deepStrictEqual(columns, ['?name']);
        });

        test('Should handle mixed variables and aggregates', () => {
            const query = '[:find ?category (count ?e) (avg ?price) :where [?e :product/category ?category] [?e :product/price ?price]]';
            const columns = extractFindColumns(query);
            assert.deepStrictEqual(columns, ['?category', 'count(?e)', 'avg(?price)']);
        });

        test('Should return empty array for invalid query', () => {
            const query = '{:db "/path/to/db"}';
            const columns = extractFindColumns(query);
            assert.deepStrictEqual(columns, []);
        });

        test('Should handle query with :in clause', () => {
            const query = '[:find ?e ?name :in $ ?search :where [?e :user/name ?name]]';
            const columns = extractFindColumns(query);
            assert.deepStrictEqual(columns, ['?e', '?name']);
        });

        test('Should handle query with :keys', () => {
            const query = '[:find ?e ?name :keys id name :where [?e :user/name ?name]]';
            const columns = extractFindColumns(query);
            assert.deepStrictEqual(columns, ['?e', '?name']);
        });
    });
});
