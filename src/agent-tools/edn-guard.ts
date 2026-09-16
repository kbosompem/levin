/**
 * Strict validation for agent-supplied EDN strings.
 *
 * Threat model: several `DtlvCore` methods build Clojure code by interpolating
 * caller-supplied strings (`runQuery` quotes the query, `transact` splices
 * tx-data unquoted, `getSampleValues` splices an attribute name). An agent
 * that can smuggle Clojure reader syntax through those strings gets arbitrary
 * code execution inside dtlv's SCI environment.
 *
 * The repo already depends on `edn-data`, but its parser is lenient: it
 * silently drops a leading `'` and ignores trailing forms, so "it parses as
 * EDN" is NOT a sufficient safety check. This module therefore does its own
 * strict, string-aware scan and guarantees the following for any accepted
 * value:
 *
 *  1. No Clojure reader-macro / comment characters outside string literals:
 *     `'`, `` ` ``, `~`, `;`, `#`. (This kills quote-breakout, `#=` read-eval,
 *     and `;` line comments. `'`/`;` inside a "..." literal are harmless and
 *     allowed, e.g. `[?e :name "O'Brien"]`.)
 *  2. Delimiters `()[]{}` are balanced and correctly nested — an unbalanced
 *     `)` is the other classic breakout (`'[:find ?e]) (evil)`).
 *  3. The value is exactly ONE top-level form — no trailing `(evil)` after
 *     the query vector.
 *
 * With (1)-(3) the accepted string is inert data wherever it is spliced:
 * inside a quoted form it can only ever be data, and in unquoted positions
 * callers additionally require a leading `[` (vectors and maps are
 * self-evaluating; only a top-level list would execute).
 */

export class UnsafeEdnError extends Error {
    constructor(message: string) {
        super(`Rejected unsafe EDN: ${message}`);
        this.name = 'UnsafeEdnError';
    }
}

export interface EdnGuardOptions {
    /**
     * Require the single top-level form to be a vector whose first element
     * is this keyword, e.g. `requireFirstKeyword: 'find'` for Datalog
     * queries (`[:find ...]`).
     */
    requireFirstKeyword?: string;
    /** Require the top-level form to be a vector (`[...]`). */
    requireVector?: boolean;
    /**
     * Reject a top-level list (`(...)`). Needed for values spliced into
     * function-call position, where a list would be evaluated.
     */
    rejectTopLevelList?: boolean;
}

interface ScanResult {
    /** The single top-level form's opening character, or 'atom'. */
    formKind: '(' | '[' | '{' | 'atom';
    /** Raw text of the single top-level form (trimmed). */
    formText: string;
}

const OPENERS = new Set(['(', '[', '{']);
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
// Checked outside string literals only (see module docstring).
const FORBIDDEN = new Set(["'", '`', '~', ';', '#']);

function isWhitespace(ch: string): boolean {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === ',';
}

function scan(input: string): ScanResult {
    let i = 0;
    const n = input.length;
    let formCount = 0;
    let result: ScanResult | null = null;

    const skipWhitespace = () => {
        while (i < n && isWhitespace(input[i])) { i++; }
    };

    /** Scan a "..." literal starting at i (input[i] === '"'). */
    const scanString = () => {
        i++; // opening quote
        while (i < n) {
            const ch = input[i];
            if (ch === '\\') { i += 2; continue; }
            if (ch === '"') { i++; return; }
            i++;
        }
        throw new UnsafeEdnError('unterminated string literal');
    };

    /**
     * Scan one balanced delimited form starting at i.
     * Returns the index just past its closing delimiter.
     */
    const scanDelimited = (start: number): number => {
        const stack: string[] = [];
        let j = start;
        while (j < n) {
            const ch = input[j];
            if (ch === '"') {
                // Reuse string scanning inline: advance a temp cursor.
                let k = j + 1;
                while (k < n) {
                    if (input[k] === '\\') { k += 2; continue; }
                    if (input[k] === '"') { break; }
                    k++;
                }
                if (k >= n) { throw new UnsafeEdnError('unterminated string literal'); }
                j = k + 1;
                continue;
            }
            if (FORBIDDEN.has(ch)) {
                throw new UnsafeEdnError(`forbidden character ${JSON.stringify(ch)}`);
            }
            if (OPENERS.has(ch)) {
                stack.push(ch);
            } else if (ch in CLOSERS) {
                const expected = stack.pop();
                if (expected !== CLOSERS[ch]) {
                    throw new UnsafeEdnError(`mismatched delimiter ${JSON.stringify(ch)}`);
                }
                if (stack.length === 0) { return j + 1; }
            }
            j++;
        }
        throw new UnsafeEdnError('unbalanced delimiters');
    };

    /** Scan one bare atom (keyword, symbol, number, nil, true/false). */
    const scanAtom = (): number => {
        let j = i;
        while (j < n && !isWhitespace(input[j]) && !OPENERS.has(input[j]) && !(input[j] in CLOSERS) && input[j] !== '"') {
            if (FORBIDDEN.has(input[j])) {
                throw new UnsafeEdnError(`forbidden character ${JSON.stringify(input[j])}`);
            }
            j++;
        }
        if (j === i) {
            throw new UnsafeEdnError(`unexpected character ${JSON.stringify(input[i])}`);
        }
        return j;
    };

    skipWhitespace();
    while (i < n) {
        const ch = input[i];
        formCount++;
        if (formCount > 1) {
            throw new UnsafeEdnError('more than one top-level form');
        }
        if (ch === '"') {
            const start = i;
            scanString();
            result = { formKind: 'atom', formText: input.slice(start, i).trim() };
        } else if (OPENERS.has(ch)) {
            const start = i;
            const end = scanDelimited(i);
            result = { formKind: ch as '(' | '[' | '{', formText: input.slice(start, end).trim() };
            i = end;
        } else if (ch in CLOSERS) {
            throw new UnsafeEdnError(`unexpected closing delimiter ${JSON.stringify(ch)}`);
        } else {
            const start = i;
            i = scanAtom();
            result = { formKind: 'atom', formText: input.slice(start, i).trim() };
        }
        skipWhitespace();
    }

    if (!result) {
        throw new UnsafeEdnError('empty value');
    }
    return result;
}

/**
 * Assert that `value` is safe to splice into Clojure code built by the
 * agent-tool layer. Throws {@link UnsafeEdnError} otherwise.
 */
export function assertSafeEdn(value: string, options: EdnGuardOptions = {}): void {
    if (typeof value !== 'string') {
        throw new UnsafeEdnError('value must be a string');
    }
    if (value.length > 100_000) {
        throw new UnsafeEdnError('value exceeds 100KB');
    }
    const { formKind, formText } = scan(value);

    if (options.requireVector && formKind !== '[') {
        throw new UnsafeEdnError('value must be a vector');
    }
    if (options.rejectTopLevelList && formKind === '(') {
        throw new UnsafeEdnError('list forms are not allowed here');
    }
    if (options.requireFirstKeyword) {
        // formText is a single balanced [...] with no reader macros, so a
        // simple token check for the leading keyword is sound.
        const m = /^\[\s*:([A-Za-z0-9_.\-?!*+/]+)/.exec(formText);
        if (!m || m[1] !== options.requireFirstKeyword) {
            throw new UnsafeEdnError(
                `value must be a vector starting with :${options.requireFirstKeyword}`
            );
        }
    }
}

/**
 * Validate a Datalog query string for the `query` tool:
 * exactly one `[:find ...]` form, no reader macros or comments.
 */
export function assertSafeQuery(query: string): void {
    assertSafeEdn(query, { requireFirstKeyword: 'find' });
}

/**
 * Validate one `:in` input value for the `query` tool: exactly one form,
 * and not a top-level list (function-call position would evaluate it).
 */
export function assertSafeQueryArg(arg: string): void {
    assertSafeEdn(arg, { rejectTopLevelList: true });
}

/**
 * Validate transaction data for the `transact` tool: exactly one vector
 * form (a vector of entity maps / tx ops), spliced unquoted.
 */
export function assertSafeTxData(txData: string): void {
    assertSafeEdn(txData, { requireVector: true, rejectTopLevelList: true });
}

/**
 * Validate an attribute name spliced as `:<name>` into generated code.
 * The executor additionally checks membership in the live schema.
 */
export function assertSafeAttributeName(attribute: string): void {
    if (typeof attribute !== 'string' || !/^:?[A-Za-z0-9_.\-/]+$/.test(attribute)) {
        throw new UnsafeEdnError(`invalid attribute name ${JSON.stringify(attribute)}`);
    }
}

/**
 * Validate an entity id spliced unquoted into generated code.
 */
export function assertSafeEntityId(entityId: unknown): asserts entityId is number {
    if (typeof entityId !== 'number' || !Number.isSafeInteger(entityId) || entityId < 0) {
        throw new UnsafeEdnError(`invalid entity id ${JSON.stringify(entityId)}`);
    }
}
