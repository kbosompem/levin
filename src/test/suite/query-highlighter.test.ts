import * as assert from 'assert';
import { highlightQueryToHtml, findSuspiciousClauses, findEntityPositionVars } from '../../utils/query-highlighter';

suite('Query Highlighter Test Suite', () => {

    suite('highlightQueryToHtml', () => {
        test('Highlights keywords, variables, strings and numbers', () => {
            const html = highlightQueryToHtml('[:find ?e :where [?e :user/name "Ada" 42]]');
            assert.ok(html.includes('<span class="tok-keyword">:find</span>'));
            assert.ok(html.includes('<span class="tok-keyword">:where</span>'));
            assert.ok(html.includes('<span class="tok-keyword">:user/name</span>'));
            assert.ok(html.includes('<span class="tok-variable">?e</span>'));
            assert.ok(html.includes('<span class="tok-string">&quot;Ada&quot;</span>'));
            assert.ok(html.includes('<span class="tok-number">42</span>'));
        });

        test('Escapes HTML inside strings', () => {
            const html = highlightQueryToHtml('[:find ?e :where [?e :user/bio "<b>hi</b>"]]');
            assert.ok(!html.includes('<b>hi</b>'));
            assert.ok(html.includes('&lt;b&gt;hi&lt;/b&gt;'));
        });

        test('Highlights comments', () => {
            const html = highlightQueryToHtml('[:find ?e] ; trailing note');
            assert.ok(html.includes('<span class="tok-comment">; trailing note</span>'));
        });

        test('Wraps marked ranges in the mark span', () => {
            const query = '[:find ?x :where [_ _ _ ?x]]';
            const start = query.indexOf('[_ _ _ ?x]');
            const html = highlightQueryToHtml(query, [{
                start,
                end: start + 10,
                cssClass: 'clause-mark',
                title: 'bad clause'
            }]);
            // Mark opens at the clause start (tokens inside keep their own spans)
            assert.ok(html.includes('<span class="clause-mark" title="bad clause">[_ _ _ '));
            // ...and closes right after the clause's closing bracket
            assert.ok(html.includes(']</span>]'));
        });

        test('Returns empty string for empty input', () => {
            assert.strictEqual(highlightQueryToHtml(''), '');
        });
    });

    suite('findSuspiciousClauses', () => {
        test('Flags a 4-element data pattern', () => {
            const query = '[:find ?x :where [_ _ _ ?x]]';
            const marks = findSuspiciousClauses(query);
            assert.strictEqual(marks.length, 1);
            assert.strictEqual(query.substring(marks[0].start, marks[0].end), '[_ _ _ ?x]');
        });

        test('Flags a 2-element data pattern', () => {
            const marks = findSuspiciousClauses('[:find ?e :where [?e :user/name]]');
            assert.strictEqual(marks.length, 1);
        });

        test('Accepts well-formed triples', () => {
            const marks = findSuspiciousClauses(`[:find ?e ?n
                :where
                [?e :user/name ?n]
                [?e :user/email _]]`);
            assert.strictEqual(marks.length, 0);
        });

        test('Ignores function/predicate clauses (lists)', () => {
            const marks = findSuspiciousClauses(`[:find ?e
                :where
                [?e :user/age ?a]
                [(> ?a 18)]]`);
            assert.strictEqual(marks.length, 0);
        });

        test('Ignores brackets inside strings and comments', () => {
            const marks = findSuspiciousClauses(`[:find ?e
                :where ; comment with [ bracket
                [?e :user/bio "text with [ ] and ; chars"]]`);
            assert.strictEqual(marks.length, 0);
        });

        test('Counts nested vectors as single elements', () => {
            const marks = findSuspiciousClauses('[:find ?e :where [?e :attr [:nested :value]]]');
            assert.strictEqual(marks.length, 0);
        });

        test('Finds clauses after multiline :find', () => {
            const marks = findSuspiciousClauses(`[:find ?x
                :where
                [_ _ _ ?x]]`);
            assert.strictEqual(marks.length, 1);
        });

        test('Returns [] for transaction data', () => {
            assert.strictEqual(findSuspiciousClauses('[[:db/add 1 :user/name "Ada"]]').length, 0);
        });

        test('Returns [] for query maps (statement maps pass only the vector)', () => {
            assert.strictEqual(findSuspiciousClauses('{:db "/tmp/x" :query [:find ?e :where [?e :a _]]}').length, 0);
        });

        test('Ignores :order-by keys after the :where section', () => {
            const marks = findSuspiciousClauses(
                '[:find ?name ?price :where [?p :product/name ?name] [?p :product/unit-price ?price] :order-by [?price :desc ?name :asc]]'
            );
            assert.strictEqual(marks.length, 0);
        });
    });

    suite('findEntityPositionVars', () => {
        test('Collects vars in first position of data patterns', () => {
            const vars = findEntityPositionVars(
                '[:find ?e ?name :where [?e :user/name ?name] [?e :user/age ?age] [?other :user/knows ?e]]'
            );
            assert.deepStrictEqual([...vars].sort(), ['?e', '?other']);
        });

        test('Ignores value-position vars, wildcards and literals', () => {
            const vars = findEntityPositionVars(
                '[:find ?name :where [?p :product/name ?name] [_ :product/price 10.0] [1 :product/name "Chai"]]'
            );
            assert.deepStrictEqual([...vars], ['?p']);
        });

        test('Function clauses are not data patterns', () => {
            const vars = findEntityPositionVars(
                '[:find ?e :where [?e :user/age ?a] [(> ?a 30)] [(get-else $ ?e :user/title "x") ?t]]'
            );
            assert.deepStrictEqual([...vars], ['?e']);
        });

        test('Returns empty set for non-query text', () => {
            assert.strictEqual(findEntityPositionVars('[[:db/add 1 :a "b"]]').size, 0);
            assert.strictEqual(findEntityPositionVars('{:db "/tmp/x"}').size, 0);
        });

        test('Ignores :order-by keys after the :where section', () => {
            const vars = findEntityPositionVars(
                '[:find ?name ?price :where [?p :product/name ?name] [?p :product/unit-price ?price] :order-by [?price :desc ?name :asc]]'
            );
            assert.deepStrictEqual([...vars], ['?p']);
        });
    });
});
