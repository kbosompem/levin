declare module 'jsedn' {
    export function parse(ednString: string): any;
    export function encode(value: any): string;

    export class Keyword {
        constructor(name: string, namespace?: string);
        toString(): string;
        val: string;
    }

    export class Symbol {
        constructor(name: string, namespace?: string);
        toString(): string;
        val: string;
    }

    export class Vector {
        constructor(values: any[]);
        val: any[];
    }

    export class List {
        constructor(values: any[]);
        val: any[];
    }

    export class Map {
        constructor();
        val: globalThis.Map<any, any>;
    }

    export class Set {
        constructor(values?: any[]);
        val: globalThis.Set<any>;
    }
}
