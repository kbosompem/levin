import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as os from 'os';

export type InferenceBackend = 'mlx' | 'llama-cpp';

/**
 * Detect the appropriate inference backend for this platform
 */
export function getInferenceBackend(): InferenceBackend {
    // Use MLX on Apple Silicon
    if (process.platform === 'darwin' && process.arch === 'arm64') {
        return 'mlx';
    }
    // Use llama.cpp everywhere else (Windows, Linux, Intel Mac)
    return 'llama-cpp';
}

/**
 * Model configurations for each backend
 */
interface ModelConfig {
    repo: string;
    files: string[];
    modelFile: string;  // The main file to check for existence
}

/**
 * MLX uses a base model from mlx-community + our adapter from HuggingFace
 * llama.cpp uses a single GGUF file
 */
const MODEL_CONFIGS: Record<InferenceBackend, ModelConfig> = {
    'mlx': {
        repo: 'kbosompem/datalevin-nlq-7b-adapter',
        files: [
            'adapter_config.json',
            'adapters.safetensors',
        ],
        modelFile: 'adapters.safetensors'
    },
    'llama-cpp': {
        repo: 'kbosompem/datalevin-nlq-gguf',
        files: [
            'datalevin-nlq-q8.gguf',
        ],
        modelFile: 'datalevin-nlq-q8.gguf'
    }
};

// Base model for MLX (downloaded automatically by mlx_lm)
export const MLX_BASE_MODEL = 'mlx-community/Qwen2.5-7B-Instruct-4bit';

/**
 * Get the local model directory path
 */
export function getModelDir(context: vscode.ExtensionContext): string {
    const backend = getInferenceBackend();
    const modelName = backend === 'mlx' ? 'datalevin-nlq-7b-adapter' : 'datalevin-nlq-gguf';
    return path.join(context.globalStorageUri.fsPath, 'models', modelName);
}

/**
 * Get the path to the main model file
 */
export function getModelPath(context: vscode.ExtensionContext): string {
    const backend = getInferenceBackend();
    const config = MODEL_CONFIGS[backend];
    const modelDir = getModelDir(context);

    if (backend === 'mlx') {
        // MLX expects the directory path
        return modelDir;
    } else {
        // llama.cpp expects the .gguf file path
        return path.join(modelDir, config.modelFile);
    }
}

/**
 * Check if model is already downloaded
 */
export async function isModelDownloaded(context: vscode.ExtensionContext): Promise<boolean> {
    const backend = getInferenceBackend();
    const config = MODEL_CONFIGS[backend];
    const modelDir = getModelDir(context);
    const modelFile = path.join(modelDir, config.modelFile);
    return fs.existsSync(modelFile);
}

/**
 * Get HuggingFace download URL for a file
 */
function getHfUrl(repo: string, fileName: string): string {
    return `https://huggingface.co/${repo}/resolve/main/${fileName}`;
}

/**
 * Download a single file with progress, following redirects
 */
async function downloadFile(
    url: string,
    destPath: string,
    onProgress?: (downloaded: number, total: number) => void,
    maxRedirects: number = 5
): Promise<void> {
    return new Promise((resolve, reject) => {
        if (maxRedirects <= 0) {
            reject(new Error('Too many redirects'));
            return;
        }

        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === 'https:' ? https : http;

        const request = client.get(url, {
            headers: { 'User-Agent': 'Levin-VSCode-Extension' }
        }, (response) => {
            // Handle redirects (301, 302, 303, 307, 308)
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                    // Handle relative redirects
                    const absoluteUrl = redirectUrl.startsWith('http')
                        ? redirectUrl
                        : new URL(redirectUrl, url).toString();

                    downloadFile(absoluteUrl, destPath, onProgress, maxRedirects - 1)
                        .then(resolve)
                        .catch(reject);
                    return;
                }
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
                return;
            }

            const file = fs.createWriteStream(destPath);
            const totalSize = parseInt(response.headers['content-length'] || '0', 10);
            let downloadedSize = 0;

            response.on('data', (chunk: Buffer) => {
                downloadedSize += chunk.length;
                if (onProgress && totalSize > 0) {
                    onProgress(downloadedSize, totalSize);
                }
            });

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                resolve();
            });

            file.on('error', (err) => {
                file.close();
                if (fs.existsSync(destPath)) {
                    fs.unlinkSync(destPath);
                }
                reject(err);
            });
        });

        request.on('error', (err) => {
            if (fs.existsSync(destPath)) {
                fs.unlinkSync(destPath);
            }
            reject(err);
        });
    });
}

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

/**
 * Download the NLQ model with progress UI
 */
export async function downloadModel(context: vscode.ExtensionContext): Promise<void> {
    const backend = getInferenceBackend();
    const config = MODEL_CONFIGS[backend];
    const modelDir = getModelDir(context);

    // Create directory if it doesn't exist
    fs.mkdirSync(modelDir, { recursive: true });

    const backendName = backend === 'mlx' ? 'MLX (Apple Silicon)' : 'GGUF (llama.cpp)';

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Levin NLQ: Downloading ${backendName} model`,
        cancellable: true
    }, async (progress, token) => {
        const totalFiles = config.files.length;
        let completedFiles = 0;

        for (const fileName of config.files) {
            if (token.isCancellationRequested) {
                throw new Error('Download cancelled');
            }

            const url = getHfUrl(config.repo, fileName);
            const destPath = path.join(modelDir, fileName);

            // Skip if file already exists
            if (fs.existsSync(destPath)) {
                completedFiles++;
                continue;
            }

            progress.report({
                message: `Downloading ${fileName}...`,
                increment: 0
            });

            try {
                await downloadFile(url, destPath, (downloaded, total) => {
                    const pct = Math.round((downloaded / total) * 100);
                    progress.report({
                        message: `${fileName} (${formatBytes(downloaded)} / ${formatBytes(total)})`,
                        increment: 0
                    });
                });
            } catch (error) {
                // Clean up partial download
                if (fs.existsSync(destPath)) {
                    fs.unlinkSync(destPath);
                }
                throw error;
            }

            completedFiles++;
            progress.report({
                increment: (1 / totalFiles) * 100
            });
        }

        progress.report({ message: 'Download complete!' });
    });

    vscode.window.showInformationMessage('Levin NLQ: Model downloaded successfully');
}

/**
 * Get the required Python packages for the current backend
 */
export function getRequiredPythonPackages(): string[] {
    const backend = getInferenceBackend();
    if (backend === 'mlx') {
        return ['mlx-lm'];
    } else {
        return ['llama-cpp-python'];
    }
}

/**
 * Check if Python dependencies are installed
 */
export async function checkPythonDependencies(): Promise<{ installed: boolean; missing: string[] }> {
    const packages = getRequiredPythonPackages();
    const missing: string[] = [];

    for (const pkg of packages) {
        try {
            const { execSync } = require('child_process');
            const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
            // Try to import the package
            const importName = pkg.replace('-', '_').replace('llama_cpp_python', 'llama_cpp');
            execSync(`${pythonCmd} -c "import ${importName}"`, { stdio: 'ignore' });
        } catch {
            missing.push(pkg);
        }
    }

    return { installed: missing.length === 0, missing };
}

/**
 * Ensure model is available, downloading if necessary
 */
export async function ensureModel(context: vscode.ExtensionContext): Promise<string> {
    const modelPath = getModelPath(context);

    // Check Python dependencies first
    const deps = await checkPythonDependencies();
    if (!deps.installed) {
        const backend = getInferenceBackend();
        const installCmd = backend === 'mlx'
            ? 'pip install mlx-lm'
            : 'pip install llama-cpp-python';

        const result = await vscode.window.showWarningMessage(
            `Missing Python packages: ${deps.missing.join(', ')}. Install with: ${installCmd}`,
            'Copy Command',
            'Continue Anyway'
        );

        if (result === 'Copy Command') {
            await vscode.env.clipboard.writeText(installCmd);
            vscode.window.showInformationMessage('Command copied to clipboard');
        }
    }

    if (await isModelDownloaded(context)) {
        return modelPath;
    }

    const backend = getInferenceBackend();
    const backendName = backend === 'mlx' ? 'MLX' : 'GGUF';
    const sizeHint = backend === 'mlx' ? '~4GB (base) + 23MB (adapter)' : '~400MB';

    const result = await vscode.window.showInformationMessage(
        `The NLQ model (${backendName}, ${sizeHint}) needs to be downloaded. Download now?`,
        'Download',
        'Cancel'
    );

    if (result !== 'Download') {
        throw new Error('Model download cancelled');
    }

    await downloadModel(context);
    return modelPath;
}
