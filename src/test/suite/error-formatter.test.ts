import * as assert from 'assert';
import { formatQueryError, isStackTraceLine } from '../../utils/error-formatter';

suite('Error Formatter Test Suite', () => {

    // The real dtlv output for [:find ?x :where [_ _ _ ?x]]
    const BOUNDS_ERROR = `java.lang.IndexOutOfBoundsException: null
 at clojure.lang.RT.subvec (RT.java:1634)
    clojure.core$subvec.invokeStatic (core.clj:3855)
    datalevin.query$resolve_pattern_lookup_refs.invokeStatic (query.clj:578)
    datalevin.query$_resolve_clause.invokeStatic (query.clj:1029)
    datalevin.query$_q.invokeStatic (query.clj:3501)
    datalevin.query$q.doInvoke (query.clj:4108)
    sci.lang.Var.invoke (lang.cljc:211)
    sci.impl.interpreter$eval_form.invokeStatic (interpreter.cljc:62)
    datalevin.main$_main.doInvoke (main.clj:529)
    java.lang.invoke.LambdaForm$DMH/sa346b79c.invokeStaticInit (LambdaForm$DMH:-1)
Execution error: `;

    test('Extracts exception type without package', () => {
        const error = formatQueryError(BOUNDS_ERROR);
        assert.strictEqual(error.type, 'IndexOutOfBoundsException');
    });

    test('A bare "null" message falls back to the type only', () => {
        const error = formatQueryError(BOUNDS_ERROR);
        assert.strictEqual(error.summary, 'IndexOutOfBoundsException');
    });

    test('Suggests the malformed-clause hint for query engine bounds errors', () => {
        const error = formatQueryError(BOUNDS_ERROR);
        assert.ok(error.hint);
        assert.ok(error.hint!.includes(':where'));
    });

    test('Keeps the full raw text for the details section', () => {
        const error = formatQueryError(BOUNDS_ERROR);
        assert.strictEqual(error.raw, BOUNDS_ERROR);
    });

    test('Parses "Execution error (Type) at ..." format', () => {
        const raw = `Execution error (ArityException) at datalevin.query/eval (query.clj:10).\nWrong number of args (1) passed to: clojure.core/count`;
        const error = formatQueryError(raw);
        assert.strictEqual(error.type, 'ArityException');
        assert.ok(error.hint);
    });

    test('Parses ExceptionInfo with a real message', () => {
        const raw = `clojure.lang.ExceptionInfo: Could not find :usr/nme in schema {:error :query/where}\n at datalevin.query$resolve (query.clj:1)`;
        const error = formatQueryError(raw);
        assert.strictEqual(error.type, 'ExceptionInfo');
        assert.ok(error.summary.includes('Could not find :usr/nme in schema'));
        assert.ok(!error.summary.includes('{:error'));
        assert.ok(error.hint);
        assert.ok(error.hint!.includes('attribute'));
    });

    test('EDN syntax errors get a bracket hint', () => {
        const error = formatQueryError('java.lang.RuntimeException: EOF while reading, starting at line 1');
        assert.ok(error.hint);
        assert.ok(error.hint!.includes('brackets'));
    });

    test('Missing database gets a path hint', () => {
        const error = formatQueryError('java.io.FileNotFoundException: /tmp/nope (No such file or directory)');
        assert.ok(error.hint);
        assert.ok(error.hint!.includes(':db'));
    });

    test('Remote failure gets a connection hint', () => {
        const error = formatQueryError('java.net.ConnectException: Connection refused');
        assert.ok(error.hint);
        assert.ok(error.hint!.includes('server'));
    });

    test('Unknown errors degrade gracefully', () => {
        const error = formatQueryError('something weird happened');
        assert.strictEqual(error.type, 'Error');
        assert.strictEqual(error.summary, 'Error: something weird happened');
        assert.strictEqual(error.hint, undefined);
    });

    test('isStackTraceLine recognizes Java and Clojure frames', () => {
        assert.ok(isStackTraceLine(' at clojure.lang.RT.subvec (RT.java:1634)'));
        assert.ok(isStackTraceLine('    clojure.core$subvec.invokeStatic (core.clj:3855)'));
        assert.ok(isStackTraceLine('java.lang.invoke.LambdaForm$DMH/sa346b79c.invokeStaticInit (LambdaForm$DMH:-1)'));
        assert.ok(!isStackTraceLine('java.lang.IndexOutOfBoundsException: null'));
        assert.ok(!isStackTraceLine('Execution error: '));
        assert.ok(!isStackTraceLine(''));
    });
});
