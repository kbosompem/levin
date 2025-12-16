import { DtlvBridge, SchemaAttribute } from '../dtlv-bridge';

export interface NlqContext {
    schema: string;
    rules?: string;
    notes?: string;
}

/**
 * Build a prompt for the NLQ model
 *
 * Format matches training data exactly:
 * <|user|>Schema: {...}\n\nnatural language query<|assistant|>
 */
export function buildPrompt(naturalQuery: string, context: NlqContext): string {
    // Use the EXACT format from training data - no extra instructions
    // The model was trained on: <|user|>Schema: {...}\n\nquery text<|assistant|>
    let prompt = `<|user|>Schema: ${context.schema}`;

    if (context.notes) {
        prompt += `\n\nNotes: ${context.notes}`;
    }

    prompt += `\n\n${naturalQuery}<|assistant|>`;

    return prompt;
}

/**
 * Get schema from the database as EDN string
 */
export async function getSchemaContext(bridge: DtlvBridge, dbPath: string): Promise<string> {
    try {
        const schema = await bridge.getSchema(dbPath);
        if (!schema || schema.length === 0) {
            return '{}';
        }
        // Format schema as compact EDN
        return formatSchemaAsEdn(schema);
    } catch {
        return '{}';
    }
}

/**
 * Get rules from the database (stored in :levin.rule/body attribute)
 */
export async function getRulesContext(bridge: DtlvBridge, dbPath: string): Promise<string | undefined> {
    try {
        // Use the getRules method which queries :levin.rule/* attributes
        const result = await bridge.getRules(dbPath);

        if (result && result.success && result.data) {
            const rules = result.data as Array<{ body: string }>;
            if (rules.length > 0) {
                // Combine all rule bodies into a single vector
                const ruleBodies = rules.map(r => r.body);
                return `[${ruleBodies.join(' ')}]`;
            }
        }
        return undefined;
    } catch {
        return undefined;
    }
}

/**
 * Format schema array as compact EDN string
 */
function formatSchemaAsEdn(schema: SchemaAttribute[]): string {
    const entries: string[] = [];

    for (const attr of schema) {
        const propStrs: string[] = [];

        if (attr.valueType) {
            propStrs.push(`:db/valueType :db.type/${attr.valueType}`);
        }
        if (attr.cardinality && attr.cardinality !== 'one') {
            propStrs.push(`:db/cardinality :db.cardinality/${attr.cardinality}`);
        }
        if (attr.unique) {
            propStrs.push(`:db/unique :db.unique/${attr.unique}`);
        }
        if (attr.index) {
            propStrs.push(`:db/index true`);
        }
        if (attr.fulltext) {
            propStrs.push(`:db/fulltext true`);
        }
        if (attr.isComponent) {
            propStrs.push(`:db/isComponent true`);
        }

        if (propStrs.length > 0) {
            entries.push(`${attr.attribute} {${propStrs.join(' ')}}`);
        }
    }

    return `{${entries.join('\n ')}}`;
}

/**
 * Parse an NLQ block from text
 * Returns the parsed object with nlq, query, notes fields
 */
export function parseNlqBlock(text: string): { nlq?: string; query?: string; notes?: string } | null {
    console.log(`[NLQ prompt-builder] parseNlqBlock called with: ${text.substring(0, 200)}`);

    // Remove leading/trailing whitespace and find the map
    text = text.trim();

    // Simple extraction - look for :nlq, :query, :notes keys
    const result: { nlq?: string; query?: string; notes?: string } = {};

    // Extract :nlq value (string)
    const nlqMatch = text.match(/:nlq\s+"([^"]+)"/);
    console.log(`[NLQ prompt-builder] nlqMatch: ${JSON.stringify(nlqMatch)}`);
    if (nlqMatch) {
        result.nlq = nlqMatch[1];
    }

    // Extract :notes value (string)
    const notesMatch = text.match(/:notes\s+"([^"]+)"/);
    if (notesMatch) {
        result.notes = notesMatch[1];
    }

    // Check if :query key exists
    if (text.includes(':query')) {
        // Extract the query vector - find balanced brackets
        const queryStart = text.indexOf(':query');
        const bracketStart = text.indexOf('[', queryStart);
        if (bracketStart !== -1) {
            let depth = 0;
            let bracketEnd = bracketStart;
            for (let i = bracketStart; i < text.length; i++) {
                if (text[i] === '[') depth++;
                else if (text[i] === ']') depth--;
                if (depth === 0) {
                    bracketEnd = i;
                    break;
                }
            }
            result.query = text.substring(bracketStart, bracketEnd + 1);
        }
    }

    console.log(`[NLQ prompt-builder] parseNlqBlock result: ${JSON.stringify(result)}`);
    return Object.keys(result).length > 0 ? result : null;
}

/**
 * Format query result as EDN block
 */
export function formatNlqBlock(nlq: string, query?: string, notes?: string): string {
    let result = `{:nlq "${nlq}"`;

    if (query) {
        result += `\n :query ${query}`;
    }

    if (notes) {
        result += `\n :notes "${notes}"`;
    }

    result += '}';
    return result;
}
