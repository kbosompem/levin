import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { getModelPath, ensureModel, getInferenceBackend, InferenceBackend } from './model-downloader';

let extensionPath: string = '';

/**
 * Set extension path for locating inference scripts
 */
export function setExtensionPath(extPath: string): void {
    extensionPath = extPath;
}

/**
 * Check if model is available
 */
export async function isModelAvailable(context: vscode.ExtensionContext): Promise<boolean> {
    const modelPath = getModelPath(context);
    return fs.existsSync(modelPath);
}

/**
 * Generate a Datalevin query from natural language
 * Uses MLX on Apple Silicon, llama.cpp on Windows/Linux
 */
export async function generateQuery(
    context: vscode.ExtensionContext,
    prompt: string,
    maxTokens: number = 100
): Promise<string> {
    console.log('[NLQ] generateQuery called');
    console.log('[NLQ] Prompt length:', prompt.length);

    // Ensure model is downloaded (prompts user if not)
    await ensureModel(context);

    const backend = getInferenceBackend();
    console.log('[NLQ] Using backend:', backend);

    try {
        const raw = await runInference(context, prompt, maxTokens, backend);
        console.log('[NLQ] Raw result:', raw);
        const cleaned = extractQueryVector(raw);
        console.log('[NLQ] Cleaned vector:', cleaned);
        return cleaned;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[NLQ] Error:', message);
        throw error;
    }
}

/**
 * Run inference using the appropriate backend
 */
async function runInference(
    context: vscode.ExtensionContext,
    prompt: string,
    maxTokens: number,
    backend: InferenceBackend
): Promise<string> {
    const modelPath = getModelPath(context);

    // Determine which Python script to use
    const scriptName = backend === 'mlx' ? 'mlx-inference.py' : 'llama-inference.py';
    const scriptPath = path.join(extensionPath, 'src', 'nlq', scriptName);

    // For packaged extension, scripts are in out/nlq
    const packagedScriptPath = path.join(extensionPath, 'out', 'nlq', scriptName);
    const finalScriptPath = fs.existsSync(scriptPath) ? scriptPath : packagedScriptPath;

    if (!fs.existsSync(finalScriptPath)) {
        throw new Error(`Inference script not found: ${scriptName}`);
    }

    const input = JSON.stringify({
        modelPath,
        prompt,
        maxTokens
    });

    return new Promise((resolve, reject) => {
        // Use python3 on macOS/Linux, python on Windows
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

        const proc = spawn(pythonCmd, [finalScriptPath], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data: Buffer) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (code !== 0) {
                console.error('[NLQ] Python stderr:', stderr);
                reject(new Error(`Inference failed: ${stderr || 'Unknown error'}`));
                return;
            }

            try {
                const result = JSON.parse(stdout);
                if (result.success) {
                    resolve(result.result);
                } else {
                    reject(new Error(result.error || 'Inference failed'));
                }
            } catch (e) {
                reject(new Error(`Failed to parse inference output: ${stdout}`));
            }
        });

        proc.on('error', (err) => {
            reject(new Error(`Failed to start Python: ${err.message}`));
        });

        // Send input
        proc.stdin.write(input);
        proc.stdin.end();
    });
}

/**
 * Dispose of model resources (no-op for subprocess-based inference)
 */
export function disposeModel(): void {
    // Nothing to dispose - we use subprocess
}

/**
 * Legacy exports for compatibility
 */
export function initializeInference(_context: vscode.ExtensionContext): void {
    // No-op - subprocess-based inference doesn't need initialization
}

export function showInferencePanel(): void {
    // No-op - no webview panel
}

export function isInferenceReady(): boolean {
    return true; // Always ready - subprocess-based
}

export async function loadModel(_context: vscode.ExtensionContext): Promise<null> {
    return null;
}

/**
 * Extract the first balanced EDN vector from model output.
 * Throws if no plausible vector is found.
 */
function extractQueryVector(output: string): string {
    if (!output) {
        throw new Error('Empty model output');
    }

    let text = output.trim();

    // Strip common prefixes the model might add
    text = text.replace(/^(```+)([a-zA-Z]*)?/g, '').replace(/```+$/g, '').trim();
    text = text.replace(/^Answer\s*:\s*/i, '').replace(/^A\s*:\s*/i, '').trim();
    text = text.replace(/^Query\s*:\s*/i, '').trim();

    // If the model returned just the vector, fast path
    if (text.startsWith('[')) {
        const vec = sliceBalancedVector(text);
        if (vec) return vec;
    }

    // Look for the first vector anywhere in the text
    const idx = text.indexOf('[');
    if (idx !== -1) {
        const vec = sliceBalancedVector(text.slice(idx));
        if (vec) return vec;
    }

    // Try to salvage from a :find without opening bracket
    const findIdx = text.indexOf(':find');
    if (findIdx !== -1) {
        // Heuristic: wrap the rest until a blank line or end
        const tail = text.slice(findIdx);
        const stop = tail.search(/\n\s*\n/);
        const candidate = stop !== -1 ? tail.slice(0, stop).trim() : tail.trim();
        const wrapped = `[${candidate.replace(/^:+query\s*/i, '').trim()}]`;
        const vec = sliceBalancedVector(wrapped);
        if (vec) return vec;
    }

    throw new Error('Model did not return a valid EDN query vector');
}

function sliceBalancedVector(s: string): string | null {
    let depth = 0;
    let end = -1;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '[') {
            depth++;
        } else if (ch === ']') {
            depth--;
            if (depth === 0) { end = i; break; }
        }
    }
    if (depth === 0 && end >= 0) {
        return s.slice(0, end + 1).trim();
    }
    return null;
}
