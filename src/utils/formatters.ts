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
