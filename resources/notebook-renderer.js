/* Levin notebook results renderer (application/vnd.levin.results+json).
 * Runs in the notebook output iframe as an ES module - plain DOM, no deps.
 * Renders the query payload as a sortable table or an expandable tree,
 * with entity links posted back to the extension host.
 */

const STYLES = `
    .levin-results { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
    .levin-header { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; opacity: 0.9; }
    .levin-header .count { font-weight: 600; }
    .levin-header .truncated { opacity: 0.7; }
    .levin-toggle { display: flex; gap: 4px; margin-left: auto; }
    .levin-toggle button {
        background: transparent; color: inherit; border: 1px solid var(--vscode-panel-border);
        border-radius: 3px; padding: 1px 8px; cursor: pointer; font: inherit;
    }
    .levin-toggle button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
    table { border-collapse: collapse; min-width: 50%; }
    th, td { text-align: left; padding: 4px 12px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
    th { background: var(--vscode-editorGroupHeader-tabsBackground); cursor: pointer; user-select: none; white-space: nowrap; }
    th:hover { background: var(--vscode-list-hoverBackground); }
    td { white-space: pre-wrap; }
    .entity-link { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: underline; }
    .tree-node { white-space: pre-wrap; }
    .tree-key { color: var(--vscode-symbolIcon-propertyForeground, #9cdcfe); }
    .tree-summary { opacity: 0.6; }
`;

export function activate(context) {
    return {
        renderOutputItem(outputItem, element) {
            let payload;
            try {
                payload = outputItem.json();
            } catch (e) {
                element.textContent = 'Failed to parse results payload: ' + e;
                return;
            }

            const state = { view: 'table', sortCol: null, sortDir: 1 };
            const root = document.createElement('div');
            root.className = 'levin-results';
            const style = document.createElement('style');
            style.textContent = STYLES;
            root.appendChild(style);
            const body = document.createElement('div');
            root.appendChild(body);
            element.appendChild(root);

            const redraw = () => {
                body.textContent = '';
                body.appendChild(renderHeader(payload, state, redraw));
                body.appendChild(state.view === 'table'
                    ? renderTable(payload, state, redraw, context)
                    : renderTree(payload));
            };
            redraw();
        }
    };
}

    function renderHeader(payload, state, redraw) {
        const header = document.createElement('div');
        header.className = 'levin-header';

        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = `${payload.total} result${payload.total === 1 ? '' : 's'}`;
        header.appendChild(count);

        if (payload.truncated) {
            const trunc = document.createElement('span');
            trunc.className = 'truncated';
            trunc.textContent = `(first ${payload.rows.length} shown)`;
            header.appendChild(trunc);
        }

        const toggle = document.createElement('div');
        toggle.className = 'levin-toggle';
        for (const view of ['table', 'tree']) {
            const btn = document.createElement('button');
            btn.textContent = view[0].toUpperCase() + view.slice(1);
            if (state.view === view) { btn.className = 'active'; }
            btn.onclick = () => { state.view = view; redraw(); };
            toggle.appendChild(btn);
        }
        header.appendChild(toggle);
        return header;
    }

    function renderTable(payload, state, redraw, context) {
        const rows = payload.rows;
        if (!rows.length) {
            const p = document.createElement('p');
            p.textContent = 'No results';
            return p;
        }

        const table = document.createElement('table');
        const keys = columnKeys(payload, rows[0]);

        const sorted = state.sortCol === null ? rows : [...rows].sort((a, b) =>
            state.sortDir * compareCells(cellAt(a, keys, state.sortCol), cellAt(b, keys, state.sortCol)));

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        keys.forEach((key, j) => {
            const th = document.createElement('th');
            th.textContent = key.label + (state.sortCol === j ? (state.sortDir === 1 ? ' ▲' : ' ▼') : '');
            th.title = 'Click to sort';
            th.onclick = () => {
                if (state.sortCol === j) { state.sortDir *= -1; } else { state.sortCol = j; state.sortDir = 1; }
                redraw();
            };
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const row of sorted) {
            const tr = document.createElement('tr');
            keys.forEach((key, j) => {
                const td = document.createElement('td');
                const value = cellAt(row, keys, j);
                const isEntity = payload.entityColumns[j] === true && Number.isInteger(value);
                if (isEntity) {
                    const link = document.createElement('span');
                    link.className = 'entity-link';
                    link.textContent = fmt(value);
                    link.title = 'Inspect entity';
                    link.onclick = () => context.postMessage?.({
                        type: 'inspectEntity',
                        dbPath: payload.dbPath,
                        entityId: value
                    });
                    td.appendChild(link);
                } else {
                    td.textContent = fmt(value);
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        return table;
    }

    function renderTree(payload) {
        const container = document.createElement('div');
        payload.rows.forEach((row, i) => {
            const resultNode = div('tree-node');
            const label = document.createElement('strong');
            label.textContent = `Result ${i + 1}`;
            resultNode.appendChild(label);
            container.appendChild(resultNode);

            if (Array.isArray(row)) {
                const keys = columnKeys(payload, row);
                keys.forEach((key, j) => {
                    flattenInto(container, key.label, row[j], 1);
                });
            } else {
                flattenInto(container, null, row, 1);
            }
        });
        return container;
    }

    function flattenInto(container, key, value, depth) {
        const isObject = value !== null && typeof value === 'object';
        if (!isObject) {
            const node = div('tree-node');
            node.style.marginLeft = (depth * 16) + 'px';
            if (key !== null) { node.appendChild(keySpan(key)); }
            node.appendChild(document.createTextNode(fmt(value)));
            container.appendChild(node);
            return;
        }

        const entries = Array.isArray(value)
            ? value.map((v, i) => [String(i), v])
            : Object.keys(value).map(k => [k.includes('/') && !k.startsWith(':') ? ':' + k : k, value[k]]);

        const node = div('tree-node');
        node.style.marginLeft = (depth * 16) + 'px';
        if (key !== null) { node.appendChild(keySpan(key)); }
        const summary = document.createElement('span');
        summary.className = 'tree-summary';
        summary.textContent = Array.isArray(value) ? `[${value.length}]` : `{${entries.length}}`;
        node.appendChild(summary);
        container.appendChild(node);

        if (entries.length === 0) { return; }
        for (const [k, v] of entries) {
            flattenInto(container, k, v, depth + 1);
        }
    }

    function columnKeys(payload, firstRow) {
        if (Array.isArray(firstRow)) {
            return firstRow.map((_, j) => ({ label: payload.columnNames[j] || `Column ${j + 1}`, index: j }));
        }
        const names = payload.columnNames.length > 0 ? payload.columnNames : Object.keys(firstRow || {});
        return names.map(name => ({ label: name, key: name }));
    }

    function cellAt(row, keys, j) {
        if (Array.isArray(row)) { return row[j]; }
        if (row !== null && typeof row === 'object') {
            const key = keys[j];
            if (key && key.key !== undefined) {
                return row[key.key] !== undefined ? row[key.key] : row[':' + key.key];
            }
        }
        return row;
    }

    function compareCells(a, b) {
        if (a === null || a === undefined) { return (b === null || b === undefined) ? 0 : 1; }
        if (b === null || b === undefined) { return -1; }
        if (typeof a === 'number' && typeof b === 'number') { return a - b; }
        const sa = typeof a === 'object' ? JSON.stringify(a) : String(a);
        const sb = typeof b === 'object' ? JSON.stringify(b) : String(b);
        return sa.localeCompare(sb);
    }

    function fmt(value) {
        if (value === null || value === undefined) { return 'nil'; }
        if (typeof value === 'string') { return `"${value}"`; }
        if (typeof value === 'number' || typeof value === 'boolean') { return String(value); }
        if (Array.isArray(value)) {
            if (value.length === 0) { return '[]'; }
            if (value.length <= 4) { return '[' + value.map(fmt).join(' ') + ']'; }
            return `[${value.length} items]`;
        }
        if (typeof value === 'object') {
            const keys = Object.keys(value);
            if (keys.length === 0) { return '{}'; }
            return '{' + keys.map(k => {
                const label = k.includes('/') && !k.startsWith(':') ? ':' + k : k;
                return `${label} ${fmt(value[k])}`;
            }).join(' ') + '}';
        }
        return String(value);
    }

    function div(className) {
        const el = document.createElement('div');
        el.className = className;
        return el;
    }

    function keySpan(text) {
        const span = document.createElement('span');
        span.className = 'tree-key';
        span.textContent = text + ': ';
        return span;
    }

