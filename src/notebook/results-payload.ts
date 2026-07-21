/**
 * Payload for the rich notebook output renderer (application/vnd.levin.results+json).
 * Everything the renderer iframe needs to draw the table/tree without any
 * extension-host access: rows, column names, entity-column flags, and the
 * database path for entity-inspector links.
 */
import { extractFindColumns, computeEntityColumns } from '../utils/formatters';

export const RESULTS_MIME = 'application/vnd.levin.results+json';

export interface ResultsPayload {
    total: number;
    truncated: boolean;
    rows: unknown[];
    columnNames: string[];
    entityColumns: boolean[];
    dbPath: string;
}

interface RunResultData {
    total?: number;
    truncated?: boolean;
    results?: unknown[];
}

export function buildResultsPayload(data: unknown, query: string, dbPath: string): ResultsPayload {
    const d = (data ?? {}) as RunResultData;
    const rows = d.results ?? [];
    return {
        total: d.total ?? rows.length,
        truncated: d.truncated ?? false,
        rows,
        columnNames: query ? extractFindColumns(query) : [],
        entityColumns: query ? computeEntityColumns(query) : [],
        dbPath
    };
}
