import * as assert from 'assert';
import {
    MINI_NORTHWIND_SCHEMA,
    MINI_NORTHWIND_DATA,
    MINI_NORTHWIND_RULES,
    SAMPLE_DB_DIRNAME,
    SAMPLE_VECTOR_DIMENSIONS
} from '../../sample/northwind-mini';
import { playgroundFiles } from '../../sample/playground-files';
import { parseStatements, isRunnable, splitEdnVector } from '../../utils/query-statements';
import { findSuspiciousClauses } from '../../utils/query-highlighter';

suite('Sample Data Test Suite', () => {

    const REF_ATTRS = [
        ':product/category',
        ':product/supplier',
        ':employee/reportsto',
        ':order/customer',
        ':order/employee',
        ':orderdetail/order',
        ':orderdetail/product'
    ];

    function entities(): string[] {
        return splitEdnVector(MINI_NORTHWIND_DATA);
    }

    test('Schema declares every attribute the data and playground rely on', () => {
        const attrs = [
            ':product/name', ':product/unit-price', ':product/units-in-stock',
            ':product/category', ':product/supplier', ':product/embedding',
            ':category/name', ':category/description',
            ':supplier/company-name', ':supplier/country',
            ':customer/company-name', ':customer/country',
            ':employee/first-name', ':employee/last-name', ':employee/title',
            ':employee/reportsto',
            ':order/customer', ':order/employee', ':order/order-date',
            ':orderdetail/order', ':orderdetail/product',
            ':orderdetail/unit-price', ':orderdetail/quantity'
        ];
        for (const attr of attrs) {
            assert.ok(MINI_NORTHWIND_SCHEMA.includes(attr), `schema missing ${attr}`);
        }
        // Feature-critical properties
        assert.ok(/:product\/name\s*\{[^}]*:db\/fulltext true/.test(MINI_NORTHWIND_SCHEMA),
            ':product/name must be fulltext');
        assert.ok(/:product\/name\s*\{[^}]*:db\.fulltext\/autoDomain true/.test(MINI_NORTHWIND_SCHEMA),
            ':product/name needs :db.fulltext/autoDomain true (required by the fulltext predicate)');
        assert.ok(/:product\/embedding\s*\{[^}]*:db\.type\/vec/.test(MINI_NORTHWIND_SCHEMA),
            ':product/embedding must be :db.type/vec');
    });

    test('Seed data has 32 entities, all with negative tempids', () => {
        const ents = entities();
        assert.strictEqual(ents.length, 32);

        for (const entity of ents) {
            const match = entity.match(/:db\/id\s+(-?\d+)/);
            assert.ok(match, `entity missing :db/id: ${entity.slice(0, 60)}`);
            assert.ok(parseInt(match![1], 10) < 0, `tempid must be negative: ${match![1]}`);
        }
    });

    test('Every reference points at a tempid that exists in the data', () => {
        const ents = entities();
        const tempids = new Set<number>();
        for (const entity of ents) {
            const match = entity.match(/:db\/id\s+(-?\d+)/);
            tempids.add(parseInt(match![1], 10));
        }

        for (const entity of ents) {
            for (const attr of REF_ATTRS) {
                const re = new RegExp(`${attr.replace('/', '\\/')}\\s+(-?\\d+)`, 'g');
                let m: RegExpExecArray | null;
                while ((m = re.exec(entity)) !== null) {
                    const target = parseInt(m[1], 10);
                    assert.ok(tempids.has(target),
                        `${attr} references unknown tempid ${target} in: ${entity.slice(0, 80)}`);
                }
            }
        }
    });

    test('Every embedding has the declared dimension', () => {
        const ents = entities();
        const withEmbedding = ents.filter(e => e.includes(':product/embedding'));
        assert.ok(withEmbedding.length >= 5, 'expected several products with embeddings');

        for (const entity of withEmbedding) {
            const match = entity.match(/:product\/embedding\s+(\[[^\]]*\])/);
            assert.ok(match, `embedding not a flat vector: ${entity.slice(0, 60)}`);
            const dims = splitEdnVector(match![1]);
            assert.strictEqual(dims.length, SAMPLE_VECTOR_DIMENSIONS,
                `embedding must have ${SAMPLE_VECTOR_DIMENSIONS} dims`);
            for (const d of dims) {
                assert.ok(!isNaN(parseFloat(d)), `embedding element not a number: ${d}`);
            }
        }
    });

    test('Rules are well-formed and named consistently', () => {
        assert.strictEqual(MINI_NORTHWIND_RULES.length, 2);
        for (const rule of MINI_NORTHWIND_RULES) {
            assert.ok(rule.body.includes(`(${rule.name} `),
                `rule body should define (${rule.name} ...)`);
            assert.ok(rule.description.length > 0);
            // One clause-set per arity branch: affordable 1, reports-to 2 (base + recursive)
            const branches = splitEdnVector(rule.body);
            assert.strictEqual(branches.length, rule.name === 'reports-to' ? 2 : 1);
        }
        // The recursive branch must reference itself
        const recursive = MINI_NORTHWIND_RULES.find(r => r.name === 'reports-to')!;
        const branches = splitEdnVector(recursive.body);
        assert.ok(branches[1].includes('(reports-to ?b ?m)'), 'second branch should recurse');
    });

    test('Sample DB directory name is stable', () => {
        assert.strictEqual(SAMPLE_DB_DIRNAME, 'northwind-sample');
    });
});

suite('Playground Files Test Suite', () => {
    const DB = '/tmp/levin-playground-check';
    const files = playgroundFiles(DB);

    test('Six playground files, five queries plus a charts notebook', () => {
        assert.deepStrictEqual(
            files.map(f => f.name),
            ['01-basics.dtlv.edn', '02-relationships.dtlv.edn', '03-rules.dtlv.edn',
             '04-vector-search.dtlv.edn', '05-beyond-sql.dtlv.edn', '06-charts.dtlvnb']
        );
    });

    test('Every .edn file parses into runnable statements and puts :db only on the first', () => {
        for (const file of files.filter(f => f.name.endsWith('.edn'))) {
            const stmts = parseStatements(file.content);
            const runnable = stmts.filter(isRunnable);
            assert.ok(runnable.length >= 3, `${file.name} should have several runnable statements`);

            assert.strictEqual(stmts[0].db, DB, `${file.name}: first statement must carry :db`);
            for (const stmt of stmts.slice(1)) {
                assert.strictEqual(stmt.db, undefined,
                    `${file.name}: later statements should inherit :db, found one at line ${stmt.startLine + 1}`);
            }
        }
    });

    test('The charts notebook is valid ipynb with a :db in its first code cell', () => {
        const nb = files.find(f => f.name === '06-charts.dtlvnb')!;
        const parsed = JSON.parse(nb.content);
        assert.strictEqual(parsed.nbformat, 4);
        assert.ok(Array.isArray(parsed.cells));
        const codeCells = parsed.cells.filter((c: { cell_type: string }) => c.cell_type === 'code');
        assert.strictEqual(codeCells.length, 3);
        assert.ok(codeCells[0].source.join('').includes(`:db "${DB}"`));
        // Every code cell is a chart statement
        for (const cell of codeCells) {
            assert.ok(cell.source.join('').includes(':chart'), 'code cell should carry :chart');
        }
    });

    test('No playground query contains a clause the highlighter would mark', () => {
        for (const file of files) {
            for (const stmt of parseStatements(file.content)) {
                if (stmt.queryText) {
                    const marks = findSuspiciousClauses(stmt.queryText);
                    assert.deepStrictEqual(marks, [],
                        `${file.name} line ${stmt.startLine + 1}: ${marks[0]?.title ?? 'unexpected mark'}`);
                }
            }
        }
    });

    test('Rules playground uses :rules and the parameterized file uses :args', () => {
        const rules = files.find(f => f.name === '03-rules.dtlv.edn')!;
        const rulesStmts = parseStatements(rules.content);
        assert.ok(rulesStmts.some(s => s.rulesText === '["affordable"]'));
        assert.ok(rulesStmts.some(s => s.rulesText === '["reports-to"]'));
        assert.ok(rulesStmts.some(s => s.rulesText === ':all'));

        const beyond = files.find(f => f.name === '05-beyond-sql.dtlv.edn')!;
        const beyondStmts = parseStatements(beyond.content);
        const withArgs = beyondStmts.filter(s => s.argsText !== undefined);
        assert.strictEqual(withArgs.length, 2, 'expected two :args statements in 05');
    });
});
