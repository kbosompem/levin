/**
 * Builds Vega-Lite specs from a statement's :chart map and query results.
 *
 * Shorthand:
 *   :chart {:mark :bar :x ?name :y ?price}
 *   :chart {:mark :arc :x ?category :y ?qty}        (pie/donut)
 *   :chart {:mark :line :x ?date :y ?total :color ?country}
 *
 * Pass-through (full Vega-Lite catalog):
 *   :chart {:spec {...vega-lite-spec...}}
 *
 * Types are inferred from values: number -> quantitative, inst-like
 * string/Date -> temporal, everything else -> nominal.
 *
 * Pure - no vscode imports, so it is unit-testable.
 */

import { parseEdn } from '../utils/edn-parser';
import { extractFindColumns } from '../utils/formatters';

export const CHART_MIME = 'application/vnd.levin.chart+json';

const VEGA_LITE_SCHEMA = 'https://vega.github.io/schema/vega-lite/v5.json';

interface RunResultData {
    results?: unknown[];
}

/**
 * The Vega-Lite spec (with data.values inlined), or null when the chart
 * map can't drive a chart - the controller then just shows the table.
 */
export function buildChartSpec(chartText: string, query: string, data: unknown): Record<string, unknown> | null {
    let config: Record<string, unknown>;
    try {
        config = parseEdn(chartText) as Record<string, unknown>;
    } catch {
        return null;
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return null;
    }

    const records = rowsToRecords(data, query);
    if (records.length === 0) {
        return null;
    }

    // Raw spec pass-through: just attach the data
    if (config.spec && typeof config.spec === 'object') {
        const spec = config.spec as Record<string, unknown>;
        spec.data = { values: records };
        if (!spec.$schema) {
            spec.$schema = VEGA_LITE_SCHEMA;
        }
        return spec;
    }

    const mark = typeof config.mark === 'string' ? config.mark : null;
    if (!mark) {
        return null;
    }

    const encoding = buildEncoding(mark, config, records);
    if (!encoding) {
        return null;
    }

    return {
        $schema: VEGA_LITE_SCHEMA,
        width: 'container',
        height: 300,
        mark,
        encoding,
        data: { values: records }
    };
}

/** x/y/color encodings for the shorthand form. */
function buildEncoding(
    mark: string,
    config: Record<string, unknown>,
    records: Record<string, unknown>[]
): Record<string, unknown> | null {
    const xField = fieldName(config.x, records);
    const yField = fieldName(config.y, records);

    if (mark === 'arc') {
        // Pie/donut: x is the category (color), y the measure (theta)
        if (!xField || !yField) {
            return null;
        }
        return {
            theta: { field: yField, type: 'quantitative' },
            color: { field: xField, type: 'nominal' }
        };
    }

    if (!xField || !yField) {
        return null;
    }

    const encoding: Record<string, unknown> = {
        x: { field: xField, type: inferType(xField, records) },
        y: { field: yField, type: inferType(yField, records) }
    };

    const colorField = fieldName(config.color, records);
    if (colorField) {
        encoding.color = { field: colorField, type: 'nominal' };
    }

    if (typeof config.aggregate === 'string') {
        (encoding.y as Record<string, unknown>).aggregate = config.aggregate;
    }

    return encoding;
}

/** Map result rows to record objects keyed by column name (sans '?'). */
export function rowsToRecords(data: unknown, query: string): Record<string, unknown>[] {
    const rows = ((data ?? {}) as RunResultData).results ?? [];
    if (rows.length === 0) {
        return [];
    }

    const columns = extractFindColumns(query).map(c => c.replace(/^\?/, ''));

    return rows.map(row => {
        if (Array.isArray(row)) {
            const record: Record<string, unknown> = {};
            row.forEach((value, i) => {
                record[columns[i] ?? `col${i + 1}`] = value;
            });
            return record;
        }
        if (row !== null && typeof row === 'object') {
            return { ...(row as Record<string, unknown>) };
        }
        return { value: row };
    });
}

/** Resolve a shorthand field reference (?var or plain name) to a record key. */
function fieldName(ref: unknown, records: Record<string, unknown>[]): string | null {
    if (typeof ref !== 'string' || ref.length === 0) {
        return null;
    }
    const name = ref.replace(/^\?/, '');
    return name in records[0] ? name : null;
}

/** Infer a Vega-Lite type from the first non-null values seen. */
function inferType(field: string, records: Record<string, unknown>[]): 'quantitative' | 'temporal' | 'nominal' {
    for (const record of records.slice(0, 10)) {
        const value = record[field];
        if (value === null || value === undefined) {
            continue;
        }
        if (typeof value === 'number') {
            return 'quantitative';
        }
        if (value instanceof Date) {
            return 'temporal';
        }
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T|\s|$)/.test(value)) {
            return 'temporal';
        }
        return 'nominal';
    }
    return 'nominal';
}
