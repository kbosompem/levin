import * as os from 'os';
import * as path from 'path';

export interface EnvConfig {
    databasePaths: string[];
    defaultDb?: string;
    autoCreate: boolean;
}

export class EnvParser {
    private config: EnvConfig;

    constructor(envContent: string) {
        this.config = this.parse(envContent);
    }

    private parse(content: string): EnvConfig {
        const lines = content.split('\n');
        const env: Record<string, string> = {};

        for (const line of lines) {
            const trimmed = line.trim();

            // Skip comments and empty lines
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            // Parse key=value
            const match = trimmed.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                let value = match[2].trim();

                // Remove surrounding quotes if present
                if ((value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }

                env[key] = value;
            }
        }

        return {
            databasePaths: this.parseDatabasePaths(env['DATALEVIN_DBS'] || ''),
            defaultDb: env['DATALEVIN_DEFAULT_DB'] ? this.expandPath(env['DATALEVIN_DEFAULT_DB']) : undefined,
            autoCreate: env['DATALEVIN_AUTO_CREATE']?.toLowerCase() === 'true'
        };
    }

    private parseDatabasePaths(pathsStr: string): string[] {
        if (!pathsStr) {
            return [];
        }

        return pathsStr
            .split(';')
            .map(p => p.trim())
            .filter(p => p.length > 0)
            .map(p => this.expandPath(p));
    }

    private expandPath(p: string): string {
        // Expand ~ to home directory
        if (p.startsWith('~')) {
            return path.join(os.homedir(), p.slice(1));
        }

        // Expand environment variables like $HOME or ${HOME}
        return p.replace(/\$\{?(\w+)\}?/g, (_, name) => {
            return process.env[name] || '';
        });
    }

    getDatabasePaths(): string[] {
        return this.config.databasePaths;
    }

    getDefaultDb(): string | undefined {
        return this.config.defaultDb;
    }

    shouldAutoCreate(): boolean {
        return this.config.autoCreate;
    }

    getConfig(): EnvConfig {
        return { ...this.config };
    }
}
