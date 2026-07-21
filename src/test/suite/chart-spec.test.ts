import * as assert from 'assert';
import { buildChartSpec, rowsToRecords } from '../../notebook/chart-spec';

const PRODUCTS = {
    total: 3,
    truncated: false,
    results: [
        ['Chai', 18.0, 'Beverages'],
        ['Tofu', 23.25, 'Produce'],
        ['Aniseed Syrup', 10.0, 'Condiments']
    ]
};
const PRODUCT_QUERY = '[:find ?name ?price ?category :where [?p :product/name ?name] [?p :product/unit-price ?price] [?p :product/category ?category]]';

suite('Chart Spec Test Suite', () => {

    suite('shorthand', () => {
        test('bar chart with inferred types', () => {
            const spec = buildChartSpec('{:mark :bar :x ?name :y ?price}', PRODUCT_QUERY, PRODUCTS)!;
            assert.ok(spec);
            assert.strictEqual(spec.mark, 'bar');
            const encoding = spec.encoding as Record<string, Record<string, unknown>>;
            assert.deepStrictEqual(encoding.x, { field: 'name', type: 'nominal' });
            assert.deepStrictEqual(encoding.y, { field: 'price', type: 'quantitative' });
            assert.strictEqual((spec.data as { values: unknown[] }).values.length, 3);
        });

        test('arc mark maps x to color and y to theta (pie)', () => {
            const spec = buildChartSpec('{:mark :arc :x ?category :y ?price}', PRODUCT_QUERY, PRODUCTS)!;
            const encoding = spec.encoding as Record<string, Record<string, unknown>>;
            assert.deepStrictEqual(encoding.theta, { field: 'price', type: 'quantitative' });
            assert.deepStrictEqual(encoding.color, { field: 'category', type: 'nominal' });
            assert.strictEqual(encoding.x, undefined);
        });

        test('color and aggregate options', () => {
            const spec = buildChartSpec(
                '{:mark :bar :x ?category :y ?price :color ?name :aggregate :sum}',
                PRODUCT_QUERY, PRODUCTS
            )!;
            const encoding = spec.encoding as Record<string, Record<string, unknown>>;
            assert.deepStrictEqual(encoding.color, { field: 'name', type: 'nominal' });
            assert.strictEqual(encoding.y.aggregate, 'sum');
        });

        test('temporal inference for ISO date strings', () => {
            const data = { results: [['2024-01-15T00:00:00.000Z', 3]] };
            const query = '[:find ?date ?qty :where [?o :order/order-date ?date] [?o :order/qty ?qty]]';
            const spec = buildChartSpec('{:mark :line :x ?date :y ?qty}', query, data)!;
            const encoding = spec.encoding as Record<string, Record<string, unknown>>;
            assert.strictEqual(encoding.x.type, 'temporal');
        });

        test('returns null when a field is not in the results', () => {
            assert.strictEqual(buildChartSpec('{:mark :bar :x ?nope :y ?price}', PRODUCT_QUERY, PRODUCTS), null);
        });

        test('returns null for empty results and invalid maps', () => {
            assert.strictEqual(buildChartSpec('{:mark :bar :x ?name :y ?price}', PRODUCT_QUERY, { results: [] }), null);
            assert.strictEqual(buildChartSpec('{:x ?name}', PRODUCT_QUERY, PRODUCTS), null);
            assert.strictEqual(buildChartSpec('42', PRODUCT_QUERY, PRODUCTS), null);
        });
    });

    suite('pass-through', () => {
        test('raw spec gets data attached and a default $schema', () => {
            const spec = buildChartSpec(
                '{:spec {:mark "circle" :encoding {:x {:field "price" :type "quantitative"}}}}',
                PRODUCT_QUERY, PRODUCTS
            )!;
            assert.strictEqual(spec.mark, 'circle');
            assert.strictEqual((spec.data as { values: unknown[] }).values.length, 3);
            assert.ok(String(spec.$schema).includes('vega-lite'));
        });
    });

    suite('rowsToRecords', () => {
        test('tuples map to column names without the ?', () => {
            const records = rowsToRecords(PRODUCTS, PRODUCT_QUERY);
            assert.deepStrictEqual(records[0], { name: 'Chai', price: 18.0, category: 'Beverages' });
        });

        test('pull map rows pass through as objects', () => {
            const data = { results: [{ 'product/name': 'Chai', 'product/price': 18.0 }] };
            const records = rowsToRecords(data, '[:find (pull ?p [*]) :where [?p :product/name _]]');
            assert.deepStrictEqual(records[0], { 'product/name': 'Chai', 'product/price': 18.0 });
        });

        test('empty results yield empty records', () => {
            assert.deepStrictEqual(rowsToRecords({}, '[:find ?e :where [?e :a _]]'), []);
        });
    });
});
