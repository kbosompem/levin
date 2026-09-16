import * as assert from 'assert';
import {
    assertSafeEdn,
    assertSafeQuery,
    assertSafeQueryArg,
    assertSafeTxData,
    assertSafeAttributeName,
    assertSafeEntityId,
    UnsafeEdnError
} from '../../agent-tools/edn-guard';

function rejects(fn: () => void): void {
    assert.throws(fn, UnsafeEdnError);
}

suite('EDN Guard Test Suite', () => {
    test('accepts a plain :find query', () => {
        assertSafeQuery('[:find ?e :where [?e :person/name "Kay"]]');
        assertSafeQuery('[:find (count ?e) :where [?e :person/name]]');
    });

    test('rejects quote breakout', () => {
        rejects(() => assertSafeQuery(`[:find ?e]') (System/exit 0) (datalevin.core/q '[:find`));
        rejects(() => assertSafeQuery(`'[:find ?e :where [?e :a 1]]`));
    });

    test('rejects paren breakout via unbalanced delimiters', () => {
        rejects(() => assertSafeQuery('[:find ?e]) (evil-fn) (datalevin.core/q \'[:find'));
        rejects(() => assertSafeQuery('[:find ?e :where [?e :a 1]'));
    });

    test('rejects trailing forms', () => {
        rejects(() => assertSafeQuery('[:find ?e :where [?e :a 1]] (evil)'));
        rejects(() => assertSafeQuery('[:find ?e] 42'));
    });

    test('rejects reader macros and comments', () => {
        rejects(() => assertSafeQuery(`[:find ?e :where [?e :a #=(evil)]]`));
        rejects(() => assertSafeQuery('[:find ?e] ; comment\n'));
        rejects(() => assertSafeQuery('[:find `?e :where [?e :a 1]]'));
        rejects(() => assertSafeQuery('[:find ~?e :where [?e :a 1]]'));
    });

    test('allows forbidden chars inside string literals', () => {
        assertSafeQuery(`[:find ?e :where [?e :name "O'Brien"]]`);
        assertSafeQuery(`[:find ?e :where [?e :note "a;b"]]`);
        assertSafeQuery(`[:find ?e :where [?e :note "a#b"]]`);
    });

    test('requires :find as first keyword', () => {
        rejects(() => assertSafeQuery('[:where [?e :a 1]]'));
        rejects(() => assertSafeQuery('[find ?e]'));
        rejects(() => assertSafeQuery('{:find ?e}'));
    });

    test('query args: single safe forms only', () => {
        assertSafeQueryArg('"Kay"');
        assertSafeQueryArg('[1 2 3]');
        assertSafeQueryArg('{:a 1}');
        rejects(() => assertSafeQueryArg('(evil)'));          // top-level list would evaluate
        rejects(() => assertSafeQueryArg('"a" "b"'));        // two forms
        rejects(() => assertSafeQueryArg(`"a") (evil)`));
    });

    test('tx data: single vector only', () => {
        assertSafeTxData('[{:person/name "Kay"} [:db/add 1 :a 2]]');
        rejects(() => assertSafeTxData('{:person/name "Kay"}'));
        rejects(() => assertSafeTxData('[(evil)] [:db/add 1 :a 2]]'));  // unbalanced
        rejects(() => assertSafeTxData('[{:a 1}] (evil)'));
    });

    test('attribute names are strict', () => {
        assertSafeAttributeName('person/name');
        assertSafeAttributeName(':person/name');
        rejects(() => assertSafeAttributeName('person/name"; (evil) "'));
        rejects(() => assertSafeAttributeName("a'b"));
        rejects(() => assertSafeAttributeName(''));
    });

    test('entity ids must be safe integers', () => {
        assertSafeEntityId(42);
        assertSafeEntityId(0);
        rejects(() => assertSafeEntityId(-1));
        rejects(() => assertSafeEntityId(1.5));
        rejects(() => assertSafeEntityId('42'));
        rejects(() => assertSafeEntityId(Number.MAX_SAFE_INTEGER + 1));
    });

    test('empty and oversized values rejected', () => {
        rejects(() => assertSafeEdn(''));
        rejects(() => assertSafeEdn('   '));
        rejects(() => assertSafeEdn('[' + 'a'.repeat(100_001)));
    });
});
