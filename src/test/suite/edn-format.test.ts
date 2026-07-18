import * as assert from 'assert';
import { formatEdn } from '../../utils/edn-format';

suite('EDN Formatter Test Suite', () => {

    test('Short forms stay inline', () => {
        const input = '{:db "/tmp/shop"}\n[:find ?e :where [?e :user/name _]]\n';
        assert.strictEqual(formatEdn(input), input);
    });

    test('Long forms break with two-space indentation', () => {
        const input = '{:db "/tmp/shop" :query [:find ?name ?price :where [?p :product/name ?name] [?p :product/unit-price ?price]] :limit 50}';
        const expected = `{:db "/tmp/shop"
 :query [:find ?name ?price
         :where
         [?p :product/name ?name]
         [?p :product/unit-price ?price]]
 :limit 50}
`;
        assert.strictEqual(formatEdn(input), expected);
    });

    test('Query vectors break clauses onto their own lines', () => {
        const input = '[:find ?name ?price :where [?p :product/name ?name] [?p :product/unit-price ?price] :order-by [?price :desc]]';
        const expected = `[:find ?name ?price
 :where
 [?p :product/name ?name]
 [?p :product/unit-price ?price]
 :order-by
 [?price :desc]]
`;
        assert.strictEqual(formatEdn(input), expected);
    });

    test('Comments are preserved with their form', () => {
        const input = ';; all products\n[:find ?e :where [?e :product/name _]]\n';
        assert.strictEqual(formatEdn(input), input);
    });

    test('Blank lines collapse to one, leading/trailing noise is dropped', () => {
        const input = '\n\n{:db "/tmp/a"}\n\n\n\n[:find ?e :where [?e :a _]]\n\n';
        const expected = '{:db "/tmp/a"}\n\n[:find ?e :where [?e :a _]]\n';
        assert.strictEqual(formatEdn(input), expected);
    });

    test('Strings containing comment starters do not force a break', () => {
        const input = '[:find ?e :where [?e :user/bio "not ; a comment"]]';
        const expected = '[:find ?e :where [?e :user/bio "not ; a comment"]]\n';
        assert.strictEqual(formatEdn(input), expected);
    });

    test('Forms containing real comments always break', () => {
        const input = '[:find ?e ; why not\n :where [?e :a _]]';
        const out = formatEdn(input);
        assert.ok(out.includes('; why not'));
        assert.ok(out.trim().startsWith('[:find ?e'));
    });

    test('Formatting is idempotent', () => {
        const input = `{:db "/tmp/shop"
 :query [:find ?name ?price
         :where
         [?p :product/name ?name]
         [?p :product/unit-price ?price]
         :order-by
         [?price :desc]]
 :rules ["affordable"]
 :limit 50}

;; bare query
[:find (count ?e) :where [?e :product/name _]]
`;
        assert.strictEqual(formatEdn(formatEdn(input)), formatEdn(input));
        assert.strictEqual(formatEdn(input), input);
    });

    test('Sets, tagged literals and discards survive intact', () => {
        const input = '#{1 2 3}\n#inst "2024-01-15"\n#_[:discarded ?x]\n';
        assert.strictEqual(formatEdn(input), input);
    });
});
