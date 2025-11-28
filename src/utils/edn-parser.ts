/**
 * Simple EDN parser for Datalevin results
 * Handles basic EDN data types returned from REPL
 */

export function parseEdn(ednString: string): unknown {
    const trimmed = ednString.trim();

    if (!trimmed) {
        return null;
    }

    try {
        // Try JSON first for simple cases
        return JSON.parse(trimmed);
    } catch {
        // Fall through to EDN parsing
    }

    return parseEdnValue(trimmed, { pos: 0 });
}

interface ParseContext {
    pos: number;
}

function parseEdnValue(input: string, ctx: ParseContext): unknown {
    skipWhitespace(input, ctx);

    if (ctx.pos >= input.length) {
        return null;
    }

    const char = input[ctx.pos];

    // nil
    if (input.slice(ctx.pos, ctx.pos + 3) === 'nil') {
        ctx.pos += 3;
        return null;
    }

    // true
    if (input.slice(ctx.pos, ctx.pos + 4) === 'true') {
        ctx.pos += 4;
        return true;
    }

    // false
    if (input.slice(ctx.pos, ctx.pos + 5) === 'false') {
        ctx.pos += 5;
        return false;
    }

    // String
    if (char === '"') {
        return parseString(input, ctx);
    }

    // Keyword
    if (char === ':') {
        return parseKeyword(input, ctx);
    }

    // Vector
    if (char === '[') {
        return parseVector(input, ctx);
    }

    // List
    if (char === '(') {
        return parseList(input, ctx);
    }

    // Map
    if (char === '{') {
        return parseMap(input, ctx);
    }

    // Set
    if (char === '#' && input[ctx.pos + 1] === '{') {
        return parseSet(input, ctx);
    }

    // Tagged literal (like #inst)
    if (char === '#') {
        return parseTaggedLiteral(input, ctx);
    }

    // Number
    if (char === '-' || char === '+' || isDigit(char)) {
        return parseNumber(input, ctx);
    }

    // Symbol
    if (isSymbolStart(char)) {
        return parseSymbol(input, ctx);
    }

    // Unknown, skip character
    ctx.pos++;
    return parseEdnValue(input, ctx);
}

function skipWhitespace(input: string, ctx: ParseContext): void {
    while (ctx.pos < input.length) {
        const char = input[ctx.pos];
        if (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === ',') {
            ctx.pos++;
        } else if (char === ';') {
            // Skip comment to end of line
            while (ctx.pos < input.length && input[ctx.pos] !== '\n') {
                ctx.pos++;
            }
        } else {
            break;
        }
    }
}

function parseString(input: string, ctx: ParseContext): string {
    ctx.pos++; // Skip opening quote
    let result = '';

    while (ctx.pos < input.length) {
        const char = input[ctx.pos];

        if (char === '"') {
            ctx.pos++; // Skip closing quote
            return result;
        }

        if (char === '\\') {
            ctx.pos++;
            if (ctx.pos < input.length) {
                const escaped = input[ctx.pos];
                switch (escaped) {
                    case 'n': result += '\n'; break;
                    case 't': result += '\t'; break;
                    case 'r': result += '\r'; break;
                    case '"': result += '"'; break;
                    case '\\': result += '\\'; break;
                    default: result += escaped;
                }
                ctx.pos++;
            }
        } else {
            result += char;
            ctx.pos++;
        }
    }

    return result;
}

function parseKeyword(input: string, ctx: ParseContext): string {
    const start = ctx.pos;
    ctx.pos++; // Skip :

    while (ctx.pos < input.length && isSymbolChar(input[ctx.pos])) {
        ctx.pos++;
    }

    return input.slice(start, ctx.pos);
}

function parseSymbol(input: string, ctx: ParseContext): string {
    const start = ctx.pos;

    while (ctx.pos < input.length && isSymbolChar(input[ctx.pos])) {
        ctx.pos++;
    }

    return input.slice(start, ctx.pos);
}

function parseNumber(input: string, ctx: ParseContext): number {
    const start = ctx.pos;

    // Sign
    if (input[ctx.pos] === '-' || input[ctx.pos] === '+') {
        ctx.pos++;
    }

    // Integer part
    while (ctx.pos < input.length && isDigit(input[ctx.pos])) {
        ctx.pos++;
    }

    // Decimal part
    if (input[ctx.pos] === '.') {
        ctx.pos++;
        while (ctx.pos < input.length && isDigit(input[ctx.pos])) {
            ctx.pos++;
        }
    }

    // Exponent
    if (input[ctx.pos] === 'e' || input[ctx.pos] === 'E') {
        ctx.pos++;
        if (input[ctx.pos] === '-' || input[ctx.pos] === '+') {
            ctx.pos++;
        }
        while (ctx.pos < input.length && isDigit(input[ctx.pos])) {
            ctx.pos++;
        }
    }

    // Handle M (BigDecimal) or N (BigInt) suffix
    if (input[ctx.pos] === 'M' || input[ctx.pos] === 'N') {
        ctx.pos++;
    }

    const numStr = input.slice(start, ctx.pos);
    return parseFloat(numStr);
}

function parseVector(input: string, ctx: ParseContext): unknown[] {
    ctx.pos++; // Skip [
    const result: unknown[] = [];

    while (ctx.pos < input.length) {
        skipWhitespace(input, ctx);

        if (input[ctx.pos] === ']') {
            ctx.pos++;
            return result;
        }

        result.push(parseEdnValue(input, ctx));
    }

    return result;
}

function parseList(input: string, ctx: ParseContext): unknown[] {
    ctx.pos++; // Skip (
    const result: unknown[] = [];

    while (ctx.pos < input.length) {
        skipWhitespace(input, ctx);

        if (input[ctx.pos] === ')') {
            ctx.pos++;
            return result;
        }

        result.push(parseEdnValue(input, ctx));
    }

    return result;
}

function parseMap(input: string, ctx: ParseContext): Record<string, unknown> {
    ctx.pos++; // Skip {
    const result: Record<string, unknown> = {};

    while (ctx.pos < input.length) {
        skipWhitespace(input, ctx);

        if (input[ctx.pos] === '}') {
            ctx.pos++;
            return result;
        }

        const key = parseEdnValue(input, ctx);
        skipWhitespace(input, ctx);
        const value = parseEdnValue(input, ctx);

        // Convert key to string
        const keyStr = typeof key === 'string' ? key : String(key);
        result[keyStr] = value;
    }

    return result;
}

function parseSet(input: string, ctx: ParseContext): unknown[] {
    ctx.pos += 2; // Skip #{
    const result: unknown[] = [];

    while (ctx.pos < input.length) {
        skipWhitespace(input, ctx);

        if (input[ctx.pos] === '}') {
            ctx.pos++;
            return result;
        }

        result.push(parseEdnValue(input, ctx));
    }

    return result;
}

function parseTaggedLiteral(input: string, ctx: ParseContext): unknown {
    ctx.pos++; // Skip #

    // Read tag name
    const tagStart = ctx.pos;
    while (ctx.pos < input.length && isSymbolChar(input[ctx.pos])) {
        ctx.pos++;
    }
    const tag = input.slice(tagStart, ctx.pos);

    skipWhitespace(input, ctx);
    const value = parseEdnValue(input, ctx);

    // Handle common tags
    if (tag === 'inst' && typeof value === 'string') {
        return new Date(value);
    }

    if (tag === 'uuid' && typeof value === 'string') {
        return value; // Return UUID as string
    }

    // Return as object with tag info
    return { _tag: tag, value };
}

function isDigit(char: string): boolean {
    return char >= '0' && char <= '9';
}

function isSymbolStart(char: string): boolean {
    return (char >= 'a' && char <= 'z') ||
           (char >= 'A' && char <= 'Z') ||
           char === '_' || char === '-' || char === '+' ||
           char === '*' || char === '/' || char === '!' ||
           char === '?' || char === '<' || char === '>' ||
           char === '=' || char === '.' || char === '$';
}

function isSymbolChar(char: string): boolean {
    return isSymbolStart(char) || isDigit(char) || char === ':' || char === '#';
}
