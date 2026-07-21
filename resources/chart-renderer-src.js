/* Levin notebook chart renderer (application/vnd.levin.chart+json).
 * Runs in the notebook output iframe as an ES module. The
 * Vega/Vega-Lite/vega-embed UMD bundles are concatenated ahead of this
 * file at build time (npm run bundle-chart-renderer), so the vegaEmbed
 * global is available at runtime.
 */

export function activate() {
    return {
        renderOutputItem(outputItem, element) {
            let spec;
            try {
                spec = outputItem.json();
            } catch (e) {
                element.textContent = 'Failed to parse chart spec: ' + e;
                return;
            }

            const isDark = document.body.classList.contains('vscode-dark') ||
                document.body.classList.contains('vscode-high-contrast');

            globalThis.vegaEmbed(element, spec, {
                renderer: 'svg',
                actions: false,
                theme: isDark ? 'dark' : undefined
            }).catch(err => {
                const pre = document.createElement('pre');
                pre.style.color = 'var(--vscode-errorForeground)';
                pre.textContent = 'Chart failed to render:\n' + (err && err.message ? err.message : err);
                element.appendChild(pre);
            });
        }
    };
}
