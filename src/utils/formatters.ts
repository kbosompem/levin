/**
 * Utility functions for formatting values for display
 */

export function formatValue(value: unknown): string {
    if (value === null || value === undefined) {
        return 'nil';
    }

    if (typeof value === 'string') {
        return `"${value}"`;
    }

    if (typeof value === 'number') {
        return String(value);
    }

    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }

    if (value instanceof Date) {
        return `#inst "${value.toISOString()}"`;
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return '[]';
        }
        if (value.length <= 3) {
            return '[' + value.map(formatValue).join(' ') + ']';
        }
        return `[${value.length} items]`;
    }

    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;

        // Check for tagged literal
        if ('_tag' in obj) {
            return `#${obj._tag} ${formatValue(obj.value)}`;
        }

        const keys = Object.keys(obj);
        if (keys.length === 0) {
            return '{}';
        }
        if (keys.length <= 2) {
            const pairs = keys.map(k => `${k} ${formatValue(obj[k])}`);
            return '{' + pairs.join(' ') + '}';
        }
        return `{${keys.length} entries}`;
    }

    return String(value);
}

export function formatAttribute(attr: string): string {
    // Ensure keyword format
    if (!attr.startsWith(':')) {
        return ':' + attr;
    }
    return attr;
}

export function formatEntityId(id: number): string {
    return `Entity ${id}`;
}

export function formatTimestamp(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) { // Less than 1 minute
        return 'just now';
    }

    if (diff < 3600000) { // Less than 1 hour
        const minutes = Math.floor(diff / 60000);
        return `${minutes}m ago`;
    }

    if (diff < 86400000) { // Less than 1 day
        const hours = Math.floor(diff / 3600000);
        return `${hours}h ago`;
    }

    if (diff < 604800000) { // Less than 1 week
        const days = Math.floor(diff / 86400000);
        return `${days}d ago`;
    }

    return date.toLocaleDateString();
}

export function formatBytes(bytes: number): string {
    if (bytes === 0) { return '0 B'; }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / Math.pow(1024, i);

    return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) {
        return str;
    }
    return str.slice(0, maxLength - 3) + '...';
}

export function escapeEdn(str: string): string {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}

export function toEdn(data: unknown): string {
    if (data === null || data === undefined) {
        return 'nil';
    }

    if (typeof data === 'string') {
        return `"${escapeEdn(data)}"`;
    }

    if (typeof data === 'number') {
        return String(data);
    }

    if (typeof data === 'boolean') {
        return data ? 'true' : 'false';
    }

    if (data instanceof Date) {
        return `#inst "${data.toISOString()}"`;
    }

    if (Array.isArray(data)) {
        return '[' + data.map(toEdn).join(' ') + ']';
    }

    if (typeof data === 'object') {
        const obj = data as Record<string, unknown>;

        // Check for tagged literal
        if ('_tag' in obj) {
            return `#${obj._tag} ${toEdn(obj.value)}`;
        }

        const entries = Object.entries(obj);
        const pairs = entries.map(([k, v]) => {
            // If key looks like a keyword, format as keyword
            const keyStr = k.startsWith(':') ? k : `:${k}`;
            return `${keyStr} ${toEdn(v)}`;
        });
        return '{' + pairs.join(' ') + '}';
    }

    return String(data);
}

export function parseAttributeParts(attr: string): { namespace: string; name: string } {
    const cleanAttr = attr.startsWith(':') ? attr.slice(1) : attr;
    const parts = cleanAttr.split('/');

    if (parts.length === 2) {
        return { namespace: parts[0], name: parts[1] };
    }

    return { namespace: '', name: cleanAttr };
}

/**
 * Extract column names from a Datalog :find clause.
 *
 * Examples:
 *   [:find ?e ?name :where ...] -> ['?e', '?name']
 *   [:find (count ?e) :where ...] -> ['count(?e)']
 *   [:find (pull ?e [:name :age]) :where ...] -> ['pull(?e)']
 *   [:find ?e . :where ...] -> ['?e'] (scalar)
 *   [:find [?e ...] :where ...] -> ['?e'] (collection)
 */
export function extractFindColumns(query: string): string[] {
    // Extract the :find clause content up to :where, :in, or end of query structure
    const findMatch = query.match(/:find\s+([\s\S]*?)(?=\s*:where|\s*:in|\s*:keys|\s*:strs|\s*:syms|\s*\]\s*$)/i);
    if (!findMatch) {
        return [];
    }

    const findClause = findMatch[1].trim();
    const columns: string[] = [];

    // Tokenize the find clause, handling nested expressions
    let i = 0;
    while (i < findClause.length) {
        // Skip whitespace
        while (i < findClause.length && /\s/.test(findClause[i])) {
            i++;
        }
        if (i >= findClause.length) break;

        const char = findClause[i];

        // Skip result modifiers: . (scalar) or ... (collection marker)
        if (char === '.') {
            i++;
            continue;
        }

        // Handle variable: ?name or _
        if (char === '?' || char === '_') {
            let varName = '';
            while (i < findClause.length && /[a-zA-Z0-9_?-]/.test(findClause[i])) {
                varName += findClause[i];
                i++;
            }
            if (varName) {
                columns.push(varName);
            }
            continue;
        }

        // Handle aggregate or pull expression: (count ?e), (pull ?e [...])
        if (char === '(') {
            const startIdx = i;
            let depth = 1;
            i++; // skip opening paren

            while (i < findClause.length && depth > 0) {
                if (findClause[i] === '(') depth++;
                else if (findClause[i] === ')') depth--;
                i++;
            }

            const expr = findClause.slice(startIdx, i).trim();
            const formatted = formatFindExpression(expr);
            if (formatted) {
                columns.push(formatted);
            }
            continue;
        }

        // Handle collection syntax [?e ...]
        if (char === '[') {
            let depth = 1;
            i++; // skip opening bracket
            let innerContent = '';

            while (i < findClause.length && depth > 0) {
                if (findClause[i] === '[') depth++;
                else if (findClause[i] === ']') depth--;
                if (depth > 0) innerContent += findClause[i];
                i++;
            }

            // Extract variable from [?e ...]
            const varMatch = innerContent.match(/(\?[a-zA-Z0-9_-]+)/);
            if (varMatch) {
                columns.push(varMatch[1]);
            }
            continue;
        }

        // Skip any other character
        i++;
    }

    return columns;
}

/**
 * Format a find expression like (count ?e) or (pull ?e [...]) into a column name
 */
function formatFindExpression(expr: string): string {
    // Remove outer parens
    const inner = expr.slice(1, -1).trim();

    // Match function name and first argument
    const match = inner.match(/^([a-zA-Z_-]+)\s+(\?[a-zA-Z0-9_-]+)/);
    if (match) {
        const [, fnName, varName] = match;
        return `${fnName}(${varName})`;
    }

    // Fallback: just return the expression cleaned up
    return expr.replace(/\s+/g, ' ');
}
