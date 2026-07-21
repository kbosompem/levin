/**
 * JSON to EDN conversion, for importing JSON data into Datalevin and for
 * clipboard/selection conversion.
 *
 * Key handling: object keys become keywords. By default camelCase is
 * converted to kebab-case ("companyName" -> :company-name); namespaced
 * keys pass through ("order/customer" -> :order/customer); characters
 * that are invalid in EDN keywords are replaced with '-'.
 *
 * Pure - no vscode imports, so it is unit-testable.
 */

import { escapeEdn, formatValue } from './formatters';
import { formatEdn } from './edn-format';

export interface JsonToEdnOptions {
    /** camelCase -> kebab-case for keys (default true) */
    kebab?: boolean;
    /** Run the result through the structural formatter (default true) */
    format?: boolean;
}

/** Convert parsed JSON data to an EDN string. */
export function jsonToEdn(data: unknown, options: JsonToEdnOptions = {}): string {
    const kebab = options.kebab ?? true;
    const compact = toEdnValue(data, kebab);
    const shouldFormat = options.format ?? true;
    return shouldFormat ? formatEdn(compact) : compact;
}

/** True when the text parses as JSON (used to detect .json imports). */
export function looksLikeJson(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return false;
    }
    try {
        JSON.parse(trimmed);
        return true;
    } catch {
        return false;
    }
}

function toEdnValue(value: unknown, kebab: boolean): string {
    if (value === null || value === undefined) {
        return 'nil';
    }

    if (typeof value === 'string') {
        return `"${escapeEdn(value)}"`;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return formatValue(value);
    }

    if (Array.isArray(value)) {
        return '[' + value.map(v => toEdnValue(v, kebab)).join(' ') + ']';
    }

    if (typeof value === 'object') {
        const pairs = Object.entries(value as Record<string, unknown>).map(
            ([k, v]) => `${keywordizeKey(k, kebab)} ${toEdnValue(v, kebab)}`
        );
        return '{' + pairs.join(' ') + '}';
    }

    return formatValue(value);
}

/**
 * Turn a JSON object key into an EDN keyword string (including the colon).
 * Preserves namespaces ("order/customer"), applies kebab-case to the name
 * part when enabled, and sanitizes characters EDN keywords cannot hold.
 */
export function keywordizeKey(key: string, kebab: boolean): string {
    const slash = key.lastIndexOf('/');
    const namespace = slash > 0 ? key.substring(0, slash) : null;
    const name = slash > 0 ? key.substring(slash + 1) : key;

    let converted = kebab ? camelToKebab(name) : name;
    converted = sanitizeKeyword(converted);

    if (namespace) {
        return `:${sanitizeKeyword(kebab ? camelToKebab(namespace) : namespace)}/${converted}`;
    }
    return `:${converted}`;
}

function camelToKebab(s: string): string {
    return s
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
        .replace(/[\s_]+/g, '-')
        .toLowerCase();
}

/** Keep only characters valid in EDN keywords; ensure a non-digit start. */
function sanitizeKeyword(s: string): string {
    let out = s.replace(/[^a-zA-Z0-9\-_*+!?<>=.]/g, '-');
    out = out.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
    if (out.length === 0) {
        return 'x';
    }
    if (/^\d/.test(out)) {
        return 'k' + out;
    }
    return out;
}
