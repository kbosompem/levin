import * as assert from 'assert';
import { jsonToEdn, keywordizeKey, looksLikeJson } from '../../utils/json-to-edn';

suite('JSON to EDN Test Suite', () => {

    suite('primitives', () => {
        test('strings are quoted and escaped', () => {
            assert.strictEqual(jsonToEdn('hello', { format: false }), '"hello"');
            assert.strictEqual(jsonToEdn('say "hi"\nbye', { format: false }), '"say \\"hi\\"\\nbye"');
        });

        test('numbers, booleans, null pass through', () => {
            assert.strictEqual(jsonToEdn(42, { format: false }), '42');
            assert.strictEqual(jsonToEdn(18.5, { format: false }), '18.5');
            assert.strictEqual(jsonToEdn(true, { format: false }), 'true');
            assert.strictEqual(jsonToEdn(null, { format: false }), 'nil');
        });
    });

    suite('structures', () => {
        test('arrays become vectors', () => {
            assert.strictEqual(jsonToEdn([1, 'two', true], { format: false }), '[1 "two" true]');
            assert.strictEqual(jsonToEdn([], { format: false }), '[]');
        });

        test('objects become maps with keyword keys', () => {
            assert.strictEqual(
                jsonToEdn({ name: 'Chai', price: 18.0 }, { format: false }),
                '{:name "Chai" :price 18}'
            );
            assert.strictEqual(jsonToEdn({}, { format: false }), '{}');
        });

        test('nested structures recurse', () => {
            const json = { customer: { companyName: 'Around the Horn', tags: ['a', 'b'] } };
            assert.strictEqual(
                jsonToEdn(json, { format: false }),
                '{:customer {:company-name "Around the Horn" :tags ["a" "b"]}}'
            );
        });

        test('arrays of objects (typical API export) become a vector of maps', () => {
            const json = [
                { companyName: 'Exotic Liquids', country: 'UK' },
                { companyName: 'Tokyo Traders', country: 'Japan' }
            ];
            assert.strictEqual(
                jsonToEdn(json, { format: false }),
                '[{:company-name "Exotic Liquids" :country "UK"} {:company-name "Tokyo Traders" :country "Japan"}]'
            );
        });
    });

    suite('keywordizeKey', () => {
        test('camelCase becomes kebab-case by default', () => {
            assert.strictEqual(keywordizeKey('companyName', true), ':company-name');
            assert.strictEqual(keywordizeKey('HTTPResponseCode', true), ':http-response-code');
        });

        test('kebab can be disabled', () => {
            assert.strictEqual(keywordizeKey('companyName', false), ':companyName');
        });

        test('namespaces are preserved and kebabed per part', () => {
            assert.strictEqual(keywordizeKey('order/customer', true), ':order/customer');
            assert.strictEqual(keywordizeKey('orderDetail/unitPrice', true), ':order-detail/unit-price');
        });

        test('already-kebab and snake_case keys', () => {
            assert.strictEqual(keywordizeKey('company-name', true), ':company-name');
            assert.strictEqual(keywordizeKey('company_name', true), ':company-name');
        });

        test('invalid characters are sanitized, digit starts prefixed', () => {
            assert.strictEqual(keywordizeKey('first name!', true), ':first-name!');
            assert.strictEqual(keywordizeKey('123abc', true), ':k123abc');
        });
    });

    suite('looksLikeJson', () => {
        test('detects JSON objects and arrays', () => {
            assert.ok(looksLikeJson('{"a": 1}'));
            assert.ok(looksLikeJson('[{"a": 1}]'));
        });

        test('rejects EDN', () => {
            assert.ok(!looksLikeJson('{:a 1}'));
            assert.ok(!looksLikeJson('[1 2 3]'));
            assert.ok(!looksLikeJson('[{:db/id -1 :user/name "Ada"}]'));
        });

        test('rejects non-JSON text', () => {
            assert.ok(!looksLikeJson('hello'));
            assert.ok(!looksLikeJson(''));
        });
    });

    suite('formatted output', () => {
        test('default output is pretty-printed and re-parseable as EDN forms', () => {
            const out = jsonToEdn([{ companyName: 'Exotic Liquids', country: 'UK' }]);
            assert.ok(out.includes(':company-name "Exotic Liquids"'));
            assert.ok(out.endsWith('\n'));
        });
    });
});
