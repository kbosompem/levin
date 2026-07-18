/**
 * Formats raw dtlv/Clojure error output into something a human can act on:
 * a one-line summary, an optional hint for common failure modes, and the
 * full raw text kept aside for the collapsible details section.
 *
 * Pure text processing - no vscode imports, so it is unit-testable.
 */

export interface FriendlyError {
    /** Exception class without package, e.g. "IndexOutOfBoundsException" */
    type: string;
    /** One-line cleaned message */
    summary: string;
    /** Actionable suggestion for common failure modes, if recognized */
    hint?: string;
    /** Full raw error text (for details/copy) */
    raw: string;
}

/**
 * Parse raw dtlv stderr into a FriendlyError.
 */
export function formatQueryError(raw: string): FriendlyError {
    const type = extractType(raw);
    const message = extractMessage(raw, type);

    // A bare "null" or empty message adds nothing - the type says more
    const summary = !message || message === 'null' ? type : `${type}: ${message}`;

    return {
        type,
        summary,
        hint: hintFor(raw),
        raw
    };
}

/**
 * True if a line is part of a JVM/Clojure stack trace.
 */
export function isStackTraceLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) { return false; }
    // Java style: "at clojure.lang.RT.subvec (RT.java:1634)"
    if (/^at\s+[\w$.]+\s+\([^)]*\)$/.test(trimmed)) { return true; }
    // Clojure style: "clojure.core$reduce.invokeStatic (core.clj:6964)"
    if (/^[\w$][\w$.]*\$?[\w$.]*\s+\([\w.-]+:\d+\)$/.test(trimmed)) { return true; }
    // LambdaForm internals: "java.lang.invoke.LambdaForm$DMH/sa346b79c.invokeStaticInit (LambdaForm$DMH:-1)"
    if (/^[\w$][\w$.]*[\w$/.]+\s+\([^)]+:-?\d+\)$/.test(trimmed)) { return true; }
    return false;
}

/**
 * Extract the exception class name without its package.
 */
function extractType(raw: string): string {
    // "Execution error (IndexOutOfBoundsException) at ..."
    const executionMatch = raw.match(/Execution error \(([A-Za-z][\w.]*)\)/);
    if (executionMatch) {
        return stripPackage(executionMatch[1]);
    }

    // "java.lang.IndexOutOfBoundsException: ..." / "clojure.lang.ExceptionInfo: ..."
    const classMatch = raw.match(/(?:java|clojure)\.[\w.]*?((?:[A-Z][\w]*?)?(?:Exception|Error)[\w]*)/);
    if (classMatch) {
        return classMatch[1];
    }

    // Any capitalized word containing *Exception/*Error
    const anyMatch = raw.match(/\b((?:[A-Z][\w]*?)?(?:Exception|Error)[\w]*)\b/);
    if (anyMatch) {
        return anyMatch[1];
    }

    return 'Error';
}

/**
 * Extract the message that follows the exception class on the same line.
 */
function extractMessage(raw: string, type: string): string {
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || isStackTraceLine(trimmed)) { continue; }

        // "<fully.qualified.Type>: <message>"
        const classLine = trimmed.match(/[\w.]*(?:[A-Z][\w]*?)?(?:Exception|Error)[\w]*[:\s]+(.*)$/);
        if (classLine) {
            // ExceptionInfo appends a data map: "msg {:error ...}" - drop it
            return classLine[1].replace(/\s+\{[\s\S]*\}\s*$/, '').trim();
        }

        // "Execution error (Type) at ns/fn (file.clj:12)." - no message on this line
        if (/^Execution error \(/.test(trimmed)) {
            continue;
        }

        // Skip log prefixes / empty trailers
        if (/^(✗\s*)?Execution error:?\s*$/.test(trimmed)) {
            continue;
        }

        // First meaningful non-trace line is the best we have
        return trimmed.replace(/^✗\s*Error:\s*/, '');
    }

    return type === 'Error' ? 'Unknown error' : '';
}

/**
 * Recognize common failure modes and suggest a fix.
 */
function hintFor(raw: string): string | undefined {
    const hints: Array<[RegExp, string]> = [
        [/IndexOutOfBoundsException[\s\S]*datalevin\.query/,
            'A clause in this query has a shape Datalevin cannot handle - usually a :where pattern with the wrong number of elements. Data patterns are triples like [?e :attr ?value]; a 4-element pattern such as [_ _ _ ?x] is not supported.'],
        [/EOF while reading|Unmatched delimiter|Unreadable form/,
            'The EDN could not be read - check for unbalanced brackets, braces or quotes in your statement.'],
        [/Could not find|not found in schema|No such attribute/i,
            'An attribute used in the query does not exist in the schema. Check spelling and namespace (e.g. :user/name), and that the schema was transacted.'],
        [/FileNotFoundException|Could not open|No such file|does not exist/i,
            'The database could not be opened - check the :db path (or remote URI) is correct and the database exists.'],
        [/Connection refused|connect timed out|UnknownHostException/,
            'Could not reach the remote Datalevin server - check the host, port and credentials in the :db URI, and that the server is running.'],
        [/ClassCastException/,
            'A value of the wrong type reached the query engine - check that attribute value types match the schema (e.g. string vs long).'],
        [/ArityException|Wrong number of args/,
            'A function in the query was called with the wrong number of arguments - check built-in function usage like (count ?x) or (get-else $ ?e :attr default).'],
        [/IndexOutOfBoundsException/,
            'The query engine hit an internal bounds error - most often a malformed clause. Try simplifying the :where section to find the offending clause.']
    ];

    for (const [pattern, hint] of hints) {
        if (pattern.test(raw)) {
            return hint;
        }
    }
    return undefined;
}

function stripPackage(className: string): string {
    const dot = className.lastIndexOf('.');
    return dot === -1 ? className : className.substring(dot + 1);
}
