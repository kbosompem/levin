import * as assert from 'assert';
import { formatValue, truncate, toEdn, parseAttributeParts, extractFindColumns, extractFindVars, computeEntityColumns, flattenTree, compareCellValues } from '../../utils/formatters';

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

        test('Should convert dates to #inst literals (not empty maps)', () => {
            const result = toEdn(new Date('2024-01-15T10:30:00.000Z'));
            assert.strictEqual(result, '#inst "2024-01-15T10:30:00.000Z"');
        });

        test('Should preserve dates inside result tuples', () => {
            const result = toEdn([[new Date('2024-01-15T10:30:00.000Z')]]);
            assert.strictEqual(result, '[[#inst "2024-01-15T10:30:00.000Z"]]');
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

        test('Should handle query with :keys - use keys as column names', () => {
            const query = '[:find ?e ?name :keys id name :where [?e :user/name ?name]]';
            const columns = extractFindColumns(query);
            assert.deepStrictEqual(columns, ['id', 'name']);
        });

        test('Should handle query with :keys multiline', () => {
            const query = `[:find ?contact ?e ?fullname
                :keys contact-name id fullname
                :where [?e :customer/name ?contact]]`;
            const columns = extractFindColumns(query);
            assert.deepStrictEqual(columns, ['contact-name', 'id', 'fullname']);
        });

        test('Should handle query with :strs', () => {
            const query = '[:find ?e ?name :strs id name :where [?e :user/name ?name]]';
            const columns = extractFindColumns(query);
            assert.deepStrictEqual(columns, ['id', 'name']);
        });
    });

    suite('extractFindVars', () => {
        test('Bare variables are kept, aggregates and pulls become null', () => {
            const vars = extractFindVars(
                '[:find ?e (count ?x) (pull ?p [:name]) ?name :where [?e :a ?name]]'
            );
            assert.deepStrictEqual(vars, ['?e', null, null, '?name']);
        });

        test('Collection and scalar forms unwrap to their variable', () => {
            assert.deepStrictEqual(extractFindVars('[:find [?e ...] :where [?e :a _]]'), ['?e']);
            assert.deepStrictEqual(extractFindVars('[:find ?e . :where [?e :a _]]'), ['?e']);
        });

        test('Aligns with extractFindColumns when :keys overrides names', () => {
            const query = '[:find ?e ?name :keys id name :where [?e :user/name ?name]]';
            const vars = extractFindVars(query);
            assert.deepStrictEqual(vars, ['?e', '?name']);
            assert.strictEqual(vars.length, extractFindColumns(query).length);
        });

        test('Invalid query returns empty', () => {
            assert.deepStrictEqual(extractFindVars('{:db "/x"}'), []);
        });
    });

    suite('computeEntityColumns', () => {
        test('Only variables in entity position are entity columns', () => {
            const flags = computeEntityColumns(
                '[:find ?e ?name ?price :where [?e :user/name ?name] [?e :user/price ?price]]'
            );
            assert.deepStrictEqual(flags, [true, false, false]);
        });

        test('Value-position variables are not entity columns (the price bug)', () => {
            const flags = computeEntityColumns(
                '[:find ?name ?price :where [?p :product/name ?name] [?p :product/unit-price ?price]]'
            );
            assert.deepStrictEqual(flags, [false, false]);
        });

        test('Aggregates are never entity columns', () => {
            const flags = computeEntityColumns(
                '[:find ?cat (count ?e) :where [?e :product/category ?cat]]'
            );
            assert.deepStrictEqual(flags, [false, false]);
        });

        test('Works with :keys overrides', () => {
            const flags = computeEntityColumns(
                '[:find ?e ?name :keys id name :where [?e :user/name ?name]]'
            );
            assert.deepStrictEqual(flags, [true, false]);
        });

        test('Non-query text yields no columns', () => {
            assert.deepStrictEqual(computeEntityColumns('[[:db/add 1 :a "b"]]'), []);
        });
    });

    suite('flattenTree', () => {
        test('Scalars produce a single leaf row', () => {
            assert.deepStrictEqual(flattenTree(18.0, '?price', 0), [
                { depth: 0, key: '?price', text: '18', container: false }
            ]);
            assert.deepStrictEqual(flattenTree('Chai', null, 0), [
                { depth: 0, key: null, text: '"Chai"', container: false }
            ]);
        });

        test('Pull maps expand recursively with namespaced keys re-colonized', () => {
            const pull = {
                'order/order-date': '2024-01-15',
                'order/customer': { 'customer/company-name': 'Around the Horn' }
            };
            const rows = flattenTree(pull, 'pull(?o)', 1);
            assert.deepStrictEqual(rows, [
                { depth: 1, key: 'pull(?o)', text: '{2}', container: true },
                { depth: 2, key: ':order/order-date', text: '"2024-01-15"', container: false },
                { depth: 2, key: ':order/customer', text: '{1}', container: true },
                { depth: 3, key: ':customer/company-name', text: '"Around the Horn"', container: false }
            ]);
        });

        test('Vectors expand with index keys; nested containers nest', () => {
            const rows = flattenTree([{ a: 1 }, 2], null, 0);
            assert.deepStrictEqual(rows, [
                { depth: 0, key: null, text: '[2]', container: true },
                { depth: 1, key: '0', text: '{1}', container: true },
                { depth: 2, key: 'a', text: '1', container: false },
                { depth: 1, key: '1', text: '2', container: false }
            ]);
        });

        test('Empty containers are leaves', () => {
            assert.deepStrictEqual(flattenTree([], 'k', 0), [
                { depth: 0, key: 'k', text: '[]', container: false }
            ]);
            assert.deepStrictEqual(flattenTree({}, 'k', 0), [
                { depth: 0, key: 'k', text: '{}', container: false }
            ]);
        });
    });

    suite('compareCellValues', () => {
        test('Numbers compare numerically, not lexically', () => {
            assert.ok(compareCellValues(4.5, 18) < 0);
            assert.ok(compareCellValues(18, 4.5) > 0);
            assert.strictEqual(compareCellValues(18, 18), 0);
        });

        test('Dates compare chronologically', () => {
            const earlier = new Date('2024-01-15');
            const later = new Date('2024-03-10');
            assert.ok(compareCellValues(earlier, later) < 0);
            assert.ok(compareCellValues(later, earlier) > 0);
        });

        test('Strings compare alphabetically', () => {
            assert.ok(compareCellValues('Chai', 'Tofu') < 0);
        });

        test('nil always sorts last, regardless of direction', () => {
            assert.ok(compareCellValues(null, 5) > 0);
            assert.ok(compareCellValues(5, null) < 0);
            assert.strictEqual(compareCellValues(null, undefined), 0);
        });

        test('Nested values compare by their EDN text', () => {
            assert.ok(compareCellValues({ a: 1 }, { a: 2 }) < 0);
            assert.ok(compareCellValues([1, 2], [1, 3]) < 0);
        });

        test('A column of prices sorts in price order', () => {
            const prices = [30.0, 10.0, 19.0, 18.0, 23.25];
            const sorted = [...prices].sort(compareCellValues);
            assert.deepStrictEqual(sorted, [10.0, 18.0, 19.0, 23.25, 30.0]);
        });
    });
});
