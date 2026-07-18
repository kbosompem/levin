import * as assert from 'assert';
import {
    enclosingForm, formAfter, forwardSexp, backwardSexp,
    wrapWith, slurpForward, barfForward, raiseForm, spliceForm
} from '../../utils/paredit-core';

/** Decode a test case: '|' marks the cursor offset and is stripped. */
function tc(input: string): { text: string; offset: number } {
    const offset = input.indexOf('|');
    assert.ok(offset >= 0, 'test case needs a | cursor marker');
    return { text: input.replace('|', ''), offset };
}

suite('Paredit Core Test Suite', () => {

    suite('enclosingForm', () => {
        test('Finds the innermost bracketed form', () => {
            const { text, offset } = tc('{:a {:b [1 2| 3]}}');
            const span = enclosingForm(text, offset)!;
            assert.strictEqual(text.substring(span.start, span.end), '[1 2 3]');
        });

        test('Walks out to the enclosing map when not inside brackets deeper', () => {
            const { text, offset } = tc('{:a {:b 1|}}');
            const span = enclosingForm(text, offset)!;
            assert.strictEqual(text.substring(span.start, span.end), '{:b 1}');
        });

        test('Returns null outside any form', () => {
            const { text, offset } = tc('42 | 43');
            assert.strictEqual(enclosingForm(text, offset), null);
        });
    });

    suite('movement', () => {
        test('forwardSexp jumps past the next form, whatever its shape', () => {
            const { text, offset } = tc('[:find ?e |:where [?e :a _]]');
            assert.strictEqual(forwardSexp(text, offset), text.indexOf('[?e') - 1);
        });

        test('forwardSexp over strings with brackets inside', () => {
            const { text, offset } = tc('|"a [ bracket" 42');
            assert.strictEqual(forwardSexp(text, offset), '"a [ bracket"'.length);
        });

        test('backwardSexp goes to the start of the current form', () => {
            const { text, offset } = tc('[:find ?e :where [?e :a _|]]');
            assert.strictEqual(backwardSexp(text, offset), text.indexOf('[?e'));
        });

        test('backwardSexp from a form start goes to the previous form start', () => {
            const { text, offset } = tc('{:a 1} |{:b 2}');
            assert.strictEqual(backwardSexp(text, offset), 0);
        });
    });

    suite('wrapWith', () => {
        test('Wraps the next form in parens and places the cursor inside', () => {
            const { text, offset } = tc('|[:find ?e]');
            const result = wrapWith(text, offset, '(', ')')!;
            assert.strictEqual(result.text, '([:find ?e])');
            assert.strictEqual(result.offset, 1);
        });

        test('Wraps with brackets, skipping whitespace and comments', () => {
            const { text, offset } = tc('| ;; note\n {:a 1}');
            const result = wrapWith(text, offset, '[', ']')!;
            assert.strictEqual(result.text, ' ;; note\n [{:a 1}]');
        });

        test('Returns null when no form follows', () => {
            const { text, offset } = tc('{:a 1} |');
            assert.strictEqual(wrapWith(text, offset, '(', ')'), null);
        });
    });

    suite('slurpForward', () => {
        test('Pulls the next form into the enclosing form', () => {
            const { text, offset } = tc('[:find ?e |:where [?e :a _]] {:next 1}');
            const result = slurpForward(text, offset)!;
            assert.strictEqual(result.text, '[:find ?e :where [?e :a _] {:next 1}]');
        });

        test('Returns null when there is no following sibling', () => {
            const { text, offset } = tc('[:find ?e |]');
            assert.strictEqual(slurpForward(text, offset), null);
        });
    });

    suite('barfForward', () => {
        test('Pushes the last child out, keeping a space before it', () => {
            const { text, offset } = tc('(a b |c)');
            const result = barfForward(text, offset)!;
            assert.strictEqual(result.text, '(a b) c');
        });

        test('Ejects exactly one form, even a trailing keyword pair', () => {
            const { text, offset } = tc('[:find ?e :where [?e :a _] |:order-by [?e :desc]]');
            const result = barfForward(text, offset)!;
            assert.strictEqual(result.text, '[:find ?e :where [?e :a _] :order-by] [?e :desc]');
        });

        test('Single-child form barfs to empty parens', () => {
            const { text, offset } = tc('(|a)');
            const result = barfForward(text, offset)!;
            assert.strictEqual(result.text, '() a');
        });

        test('Returns null for an empty form', () => {
            const { text, offset } = tc('[|]');
            assert.strictEqual(barfForward(text, offset), null);
        });
    });

    suite('raiseForm', () => {
        test('Raises the form at the cursor start within its parent', () => {
            const { text, offset } = tc('(a |(b c) d)');
            const result = raiseForm(text, offset)!;
            assert.strictEqual(result.text, '(b c)');
            assert.strictEqual(result.offset, 0);
        });

        test('Raises the next sexp after point (Emacs semantics)', () => {
            const { text, offset } = tc('(a (b |c) d)');
            const result = raiseForm(text, offset)!;
            assert.strictEqual(result.text, '(a c d)');
        });

        test('Raises an atom under the cursor', () => {
            const { text, offset } = tc('(a be|e d)');
            const result = raiseForm(text, offset)!;
            assert.strictEqual(result.text, 'bee');
        });

        test('Returns null at the top level', () => {
            const { text, offset } = tc('|{:a 1}');
            assert.strictEqual(raiseForm(text, offset), null);
        });
    });

    suite('spliceForm', () => {
        test('Removes the enclosing brackets, keeping children', () => {
            const { text, offset } = tc('(a (b |c) d)');
            const result = spliceForm(text, offset)!;
            assert.strictEqual(result.text, '(a b c d)');
        });

        test('Respects strings containing brackets', () => {
            const { text, offset } = tc('[:find ?e :where [?e :bio "has ] bra|cket"]]');
            const span = enclosingForm(text, offset)!;
            // The innermost form is the triple - a naive scanner would end
            // it inside the string at the "]"
            assert.strictEqual(text.substring(span.start, span.end), '[?e :bio "has ] bracket"]');
        });
    });

    suite('formAfter', () => {
        test('Skips comments and whitespace', () => {
            const { text, offset } = tc('|;; c\n  {:a 1}');
            const span = formAfter(text, offset)!;
            assert.strictEqual(text.substring(span.start, span.end), '{:a 1}');
        });
    });
});
