/**
 * Serializer for .dtlvnb notebooks, stored as ipynb-compatible JSON so
 * GitHub renders them natively and the format is familiar. Code cells hold
 * the same statement maps as .dtlv.edn files; outputs persist in the file
 * so re-opening a notebook shows previous results.
 */
import * as vscode from 'vscode';
import { RESULTS_MIME } from './results-payload';
import { CHART_MIME } from './chart-spec';

/** Levin-specific mimetypes that persist in the ipynb file */
const CUSTOM_MIMES = [RESULTS_MIME, CHART_MIME];

export const NOTEBOOK_TYPE = 'levin-notebook';
export const CODE_LANGUAGE = 'datalevin-query';

interface IpynbOutput {
    output_type: string;
    name?: string;
    text?: string[];
    data?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    execution_count?: number | null;
    ename?: string;
    evalue?: string;
    traceback?: string[];
}

interface IpynbCell {
    cell_type: 'markdown' | 'code';
    source: string[];
    metadata: Record<string, unknown>;
    execution_count?: number | null;
    outputs?: IpynbOutput[];
}

interface IpynbFile {
    cells: IpynbCell[];
    metadata: Record<string, unknown>;
    nbformat: number;
    nbformat_minor: number;
}

export type { IpynbFile };

/** ipynb stores source as lines that keep their trailing newlines. */
function textToLines(text: string): string[] {
    if (text.length === 0) {
        return [];
    }
    const parts = text.split('\n');
    const lines = parts.map((part, i) => (i < parts.length - 1 ? part + '\n' : part));
    // A trailing newline does not create an empty final line in ipynb
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}

function linesToText(lines: string[] | string): string {
    return Array.isArray(lines) ? lines.join('') : lines;
}

export function ipynbToNotebook(json: IpynbFile): vscode.NotebookData {
    const cells = (json.cells ?? []).map(cell => {
        const kind = cell.cell_type === 'markdown'
            ? vscode.NotebookCellKind.Markup
            : vscode.NotebookCellKind.Code;
        const language = cell.cell_type === 'markdown' ? 'markdown' : CODE_LANGUAGE;
        const data = new vscode.NotebookCellData(kind, linesToText(cell.source), language);
        data.metadata = cell.metadata ?? {};

        if (cell.cell_type === 'code' && Array.isArray(cell.outputs)) {
            data.outputs = cell.outputs.flatMap(outputToCellOutput);
            if (typeof cell.execution_count === 'number') {
                data.executionSummary = { executionOrder: cell.execution_count };
            }
        }
        return data;
    });

    const notebook = new vscode.NotebookData(cells);
    notebook.metadata = {
        levin: json.metadata?.levin ?? {}
    };
    return notebook;
}

function outputToCellOutput(output: IpynbOutput): vscode.NotebookCellOutput[] {
    if (output.output_type === 'error') {
        const err = new Error(output.evalue ?? 'Error');
        err.name = output.ename ?? 'Error';
        if (output.traceback) {
            err.stack = output.traceback.join('\n');
        }
        return [new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(err)])];
    }

    const data = output.data ?? {};
    const items: vscode.NotebookCellOutputItem[] = [];

    for (const mime of CUSTOM_MIMES) {
        if (data[mime] !== undefined) {
            items.push(new vscode.NotebookCellOutputItem(
                Buffer.from(JSON.stringify(data[mime])),
                mime
            ));
        }
    }
    if (data['application/json'] !== undefined) {
        items.push(new vscode.NotebookCellOutputItem(
            Buffer.from(JSON.stringify(data['application/json'])),
            'application/json'
        ));
    }
    if (data['text/plain'] !== undefined) {
        items.push(vscode.NotebookCellOutputItem.text(linesToText(data['text/plain'] as string[] | string)));
    }

    return items.length > 0 ? [new vscode.NotebookCellOutput(items)] : [];
}

export function notebookToIpynb(data: vscode.NotebookData): IpynbFile {
    const cells: IpynbCell[] = data.cells.map(cell => {
        const isMarkdown = cell.kind === vscode.NotebookCellKind.Markup;
        const ipynbCell: IpynbCell = {
            cell_type: isMarkdown ? 'markdown' : 'code',
            source: textToLines(cell.value),
            metadata: cell.metadata ?? {}
        };

        if (!isMarkdown) {
            ipynbCell.execution_count = cell.executionSummary?.executionOrder ?? null;
            ipynbCell.outputs = (cell.outputs ?? []).map(cellOutputToIpynb);
        }
        return ipynbCell;
    });

    return {
        cells,
        metadata: {
            levin: data.metadata?.levin ?? {},
            kernelspec: {
                name: 'levin',
                display_name: 'Levin (Datalevin)',
                language: 'clojure'
            },
            language_info: { name: 'clojure' }
        },
        nbformat: 4,
        nbformat_minor: 5
    };
}

function cellOutputToIpynb(output: vscode.NotebookCellOutput): IpynbOutput {
    for (const item of output.items) {
        if (item.mime === 'application/vnd.code.notebook.error') {
            const parsed = JSON.parse(Buffer.from(item.data).toString('utf-8'));
            return {
                output_type: 'error',
                ename: parsed.name ?? 'Error',
                evalue: parsed.message ?? '',
                traceback: parsed.stack ? String(parsed.stack).split('\n') : []
            };
        }
    }

    const data: Record<string, unknown> = {};
    for (const item of output.items) {
        if (CUSTOM_MIMES.includes(item.mime)) {
            try {
                data[item.mime] = JSON.parse(Buffer.from(item.data).toString('utf-8'));
            } catch {
                data[item.mime] = null;
            }
        } else if (item.mime === 'application/json') {
            try {
                data['application/json'] = JSON.parse(Buffer.from(item.data).toString('utf-8'));
            } catch {
                data['application/json'] = null;
            }
        } else if (item.mime === 'text/plain') {
            data['text/plain'] = textToLines(Buffer.from(item.data).toString('utf-8'));
        }
    }

    return {
        output_type: 'execute_result',
        data,
        metadata: {},
        execution_count: null
    };
}

export class LevinNotebookSerializer implements vscode.NotebookSerializer {
    deserializeNotebook(content: Uint8Array): vscode.NotebookData {
        const text = Buffer.from(content).toString('utf-8');
        if (text.trim().length === 0) {
            return new vscode.NotebookData([]);
        }
        return ipynbToNotebook(JSON.parse(text) as IpynbFile);
    }

    serializeNotebook(data: vscode.NotebookData): Uint8Array {
        const json = notebookToIpynb(data);
        return Buffer.from(JSON.stringify(json, null, 1), 'utf-8');
    }
}
