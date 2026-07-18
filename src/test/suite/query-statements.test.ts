import * as assert from 'assert';
import { parseStatements, statementAtLine, resolveDbPath, isRunnable, parseRulesSpec, splitEdnVector } from '../../utils/query-statements';

suite('Query Statements Parser Test Suite', () => {

    const MULTI = `;; comment at top
{:db "/tmp/shop"
 :query [:find ?e :where [?e :user/name ?n]]
 :limit 10}

{:db "/tmp/shop"
 :transact [{:user/name "Ada"}]}

[:find (count ?e) :where [?e :user/name _]]
`;

    test('Parses multiple statements in one file', () => {
        const stmts = parseStatements(MULTI);
        assert.strictEqual(stmts.length, 3);

        assert.strictEqual(stmts[0].kind, 'query');
        assert.strictEqual(stmts[0].db, '/tmp/shop');
        assert.strictEqual(stmts[0].queryText, '[:find ?e :where [?e :user/name ?n]]');
        assert.strictEqual(stmts[0].limit, 10);
        assert.strictEqual(stmts[0].startLine, 1);
        assert.strictEqual(stmts[0].endLine, 3);

        assert.strictEqual(stmts[1].kind, 'transact');
        assert.strictEqual(stmts[1].db, '/tmp/shop');
        assert.strictEqual(stmts[1].transactText, '[{:user/name "Ada"}]');
        assert.strictEqual(stmts[1].startLine, 5);
        assert.strictEqual(stmts[1].endLine, 6);

        assert.strictEqual(stmts[2].kind, 'bare-query');
        assert.strictEqual(stmts[2].queryText, '[:find (count ?e) :where [?e :user/name _]]');
        assert.strictEqual(stmts[2].startLine, 8);
    });

    test('Statement text matches the exact source span', () => {
        const stmts = parseStatements(MULTI);
        assert.ok(stmts[0].text.startsWith('{:db "/tmp/shop"'));
        assert.ok(stmts[0].text.endsWith(':limit 10}'));
        assert.strictEqual(MULTI.substring(stmts[1].start, stmts[1].end), stmts[1].text);
    });

    test('Query with nested maps (pull syntax) is extracted intact', () => {
        const text = `{:db "/tmp/shop"
 :query [:find (pull ?e [:user/name {:user/friends [:user/name]}])
         :where [?e :user/name _]]
 :limit 5}`;
        const stmts = parseStatements(text);
        assert.strictEqual(stmts.length, 1);
        assert.strictEqual(stmts[0].kind, 'query');
        assert.strictEqual(
            stmts[0].queryText,
            '[:find (pull ?e [:user/name {:user/friends [:user/name]}])\n         :where [?e :user/name _]]'
        );
        assert.strictEqual(stmts[0].limit, 5);
    });

    test('Strings with braces/semicolons and comments do not break scanning', () => {
        const text = `{:db "/tmp/with ; semi"
 :query [:find ?e :where [?e :user/bio "has } brace and ; semi \\"quoted\\""]]}
; a comment line with { unbalanced brace
[:find ?e :where [?e :user/name _]]
`;
        const stmts = parseStatements(text);
        assert.strictEqual(stmts.length, 2);
        assert.strictEqual(stmts[0].db, '/tmp/with ; semi');
        assert.strictEqual(stmts[0].endLine, 1);
        assert.strictEqual(stmts[1].kind, 'bare-query');
        assert.strictEqual(stmts[1].startLine, 3);
    });

    test('NLQ block is classified as nlq, runnable once it has a query', () => {
        const withQuery = parseStatements(`{:db "/tmp/shop" :nlq "all users" :query [:find ?e :where [?e :user/name _]]}`);
        assert.strictEqual(withQuery[0].kind, 'nlq');
        assert.ok(isRunnable(withQuery[0]));

        const withoutQuery = parseStatements(`{:nlq "all users"}`);
        assert.strictEqual(withoutQuery[0].kind, 'nlq');
        assert.ok(!isRunnable(withoutQuery[0]));
    });

    test('Header :db map provides the database for following bare queries', () => {
        const stmts = parseStatements(`{:db "/tmp/shop"}\n\n[:find ?e :where [?e :user/name _]]`);
        assert.strictEqual(stmts.length, 2);
        assert.strictEqual(stmts[0].kind, 'other');
        assert.strictEqual(stmts[0].db, '/tmp/shop');
        assert.ok(!isRunnable(stmts[0]));
        assert.strictEqual(resolveDbPath(stmts, stmts[1]), '/tmp/shop');
    });

    test('Bare query resolves db from nearest preceding statement', () => {
        const stmts = parseStatements(MULTI);
        assert.strictEqual(resolveDbPath(stmts, stmts[2]), '/tmp/shop');
        assert.strictEqual(resolveDbPath(stmts, stmts[0]), '/tmp/shop');
    });

    test('resolveDbPath returns null when no db exists', () => {
        const stmts = parseStatements(`[:find ?e :where [?e :user/name _]]`);
        assert.strictEqual(resolveDbPath(stmts, stmts[0]), null);
    });

    test('Reader discard #_ forms are skipped', () => {
        const stmts = parseStatements(`#_{:db "/tmp/ignored" :query [:find ?x :where [?x :a _]]}\n[:find ?e :where [?e :user/name _]]`);
        assert.strictEqual(stmts.length, 1);
        assert.strictEqual(stmts[0].kind, 'bare-query');
        assert.strictEqual(resolveDbPath(stmts, stmts[0]), null);
    });

    test('statementAtLine finds the containing statement', () => {
        const stmts = parseStatements(MULTI);
        assert.strictEqual(statementAtLine(stmts, 1), stmts[0]);
        assert.strictEqual(statementAtLine(stmts, 2), stmts[0]);
        assert.strictEqual(statementAtLine(stmts, 6), stmts[1]);
        assert.strictEqual(statementAtLine(stmts, 8), stmts[2]);
    });

    test('statementAtLine between statements picks the nearest preceding', () => {
        const stmts = parseStatements(MULTI);
        // Line 7 is the blank line between the transact map and the bare query
        assert.strictEqual(statementAtLine(stmts, 7), stmts[1]);
    });

    test('statementAtLine before the first statement picks the next one', () => {
        const stmts = parseStatements(MULTI);
        // Line 0 is the leading comment
        assert.strictEqual(statementAtLine(stmts, 0), stmts[0]);
    });

    test('statementAtLine returns null for empty input', () => {
        assert.strictEqual(statementAtLine([], 0), null);
        assert.strictEqual(statementAtLine(parseStatements(';; nothing here\n'), 0), null);
    });

    test('Unterminated form does not hang and is still returned', () => {
        const stmts = parseStatements(`{:db "/tmp/shop" :query [:find ?e`);
        assert.strictEqual(stmts.length, 1);
        assert.strictEqual(stmts[0].kind, 'query');
        assert.strictEqual(stmts[0].db, '/tmp/shop');
    });

    test('CRLF line endings are handled', () => {
        const stmts = parseStatements('{:db "/tmp/shop"}\r\n[:find ?e :where [?e :user/name _]]');
        assert.strictEqual(stmts.length, 2);
        assert.strictEqual(stmts[1].startLine, 1);
        assert.strictEqual(stmts[1].kind, 'bare-query');
    });

    test('Statement :rules and :args values are extracted', () => {
        const stmts = parseStatements(
            `{:db "/tmp/shop"
 :query [:find ?n :in $ % ?x :where [?e :user/name ?n] (affordable ?e) [(> ?x 1)]]
 :rules ["affordable"]
 :args [42 "two" [1 2]]}`
        );
        assert.strictEqual(stmts.length, 1);
        assert.strictEqual(stmts[0].rulesText, '["affordable"]');
        assert.strictEqual(stmts[0].argsText, '[42 "two" [1 2]]');
    });

    test('resolveDbPath: own :db beats the pin', () => {
        const stmts = parseStatements(`{:db "/tmp/own" :query [:find ?e :where [?e :a _]]}`);
        assert.strictEqual(resolveDbPath(stmts, stmts[0], '/tmp/pinned'), '/tmp/own');
    });

    test('resolveDbPath: pin beats an inherited :db', () => {
        const stmts = parseStatements(`{:db "/tmp/inherited"}\n\n[:find ?e :where [?e :a _]]`);
        assert.strictEqual(resolveDbPath(stmts, stmts[1], '/tmp/pinned'), '/tmp/pinned');
    });

    test('resolveDbPath: pin is used when nothing else provides a db', () => {
        const stmts = parseStatements(`[:find ?e :where [?e :a _]]`);
        assert.strictEqual(resolveDbPath(stmts, stmts[0], '/tmp/pinned'), '/tmp/pinned');
    });

    test('resolveDbPath: null pin falls back to inheritance', () => {
        const stmts = parseStatements(`{:db "/tmp/inherited"}\n\n[:find ?e :where [?e :a _]]`);
        assert.strictEqual(resolveDbPath(stmts, stmts[1], null), '/tmp/inherited');
    });
});

suite('parseRulesSpec Test Suite', () => {
    test(':all means every stored rule', () => {
        assert.strictEqual(parseRulesSpec(':all'), 'all');
    });

    test('A vector of strings becomes a name list', () => {
        assert.deepStrictEqual(parseRulesSpec('["affordable" "reports-to"]'), ['affordable', 'reports-to']);
    });

    test('Escapes inside rule names are unescaped', () => {
        assert.deepStrictEqual(parseRulesSpec('["say \\"hi\\""]'), ['say "hi"']);
    });

    test('Anything else is undefined', () => {
        assert.strictEqual(parseRulesSpec(':all-but-one'), undefined);
        assert.strictEqual(parseRulesSpec('[]'), undefined);
        assert.strictEqual(parseRulesSpec('42'), undefined);
    });
});

suite('splitEdnVector Test Suite', () => {
    test('Top-level elements, including nested forms', () => {
        assert.deepStrictEqual(
            splitEdnVector('[["Chai" 10.0] ["Tofu" 20.0]]'),
            ['["Chai" 10.0]', '["Tofu" 20.0]']
        );
    });

    test('Mixed atoms and strings with brackets inside', () => {
        assert.deepStrictEqual(
            splitEdnVector('[42 "a [ bracket" {:k [1 2]}]'),
            ['42', '"a [ bracket"', '{:k [1 2]}']
        );
    });

    test('Commas and comments are separators', () => {
        assert.deepStrictEqual(splitEdnVector('[1, 2 ;; note\n 3]'), ['1', '2', '3']);
    });

    test('Empty and non-vectors', () => {
        assert.deepStrictEqual(splitEdnVector('[]'), []);
        assert.deepStrictEqual(splitEdnVector('42'), []);
    });
});
