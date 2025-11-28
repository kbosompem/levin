import * as assert from 'assert';
import { EnvParser } from '../../config/env-parser';

suite('EnvParser Test Suite', () => {
    test('Should parse single database path', () => {
        const content = 'DATALEVIN_DBS=/path/to/db';
        const parser = new EnvParser(content);
        const paths = parser.getDatabasePaths();

        assert.strictEqual(paths.length, 1);
        assert.strictEqual(paths[0], '/path/to/db');
    });

    test('Should parse multiple database paths', () => {
        const content = 'DATALEVIN_DBS=/path/to/db1;/path/to/db2;/path/to/db3';
        const parser = new EnvParser(content);
        const paths = parser.getDatabasePaths();

        assert.strictEqual(paths.length, 3);
        assert.strictEqual(paths[0], '/path/to/db1');
        assert.strictEqual(paths[1], '/path/to/db2');
        assert.strictEqual(paths[2], '/path/to/db3');
    });

    test('Should expand tilde in paths', () => {
        const content = 'DATALEVIN_DBS=~/mydb';
        const parser = new EnvParser(content);
        const paths = parser.getDatabasePaths();

        assert.strictEqual(paths.length, 1);
        assert.ok(!paths[0].startsWith('~'), 'Path should not start with ~');
        assert.ok(paths[0].includes('mydb'), 'Path should contain database name');
    });

    test('Should handle comments', () => {
        const content = `# This is a comment
DATALEVIN_DBS=/path/to/db
# Another comment`;
        const parser = new EnvParser(content);
        const paths = parser.getDatabasePaths();

        assert.strictEqual(paths.length, 1);
    });

    test('Should handle quoted values', () => {
        const content = 'DATALEVIN_DBS="/path/to/db with spaces"';
        const parser = new EnvParser(content);
        const paths = parser.getDatabasePaths();

        assert.strictEqual(paths.length, 1);
        assert.strictEqual(paths[0], '/path/to/db with spaces');
    });

    test('Should parse default database', () => {
        const content = `DATALEVIN_DBS=/path/to/db1;/path/to/db2
DATALEVIN_DEFAULT_DB=/path/to/db1`;
        const parser = new EnvParser(content);

        assert.strictEqual(parser.getDefaultDb(), '/path/to/db1');
    });

    test('Should parse auto-create option', () => {
        const content = `DATALEVIN_DBS=/path/to/db
DATALEVIN_AUTO_CREATE=true`;
        const parser = new EnvParser(content);

        assert.strictEqual(parser.shouldAutoCreate(), true);
    });

    test('Should handle empty content', () => {
        const content = '';
        const parser = new EnvParser(content);
        const paths = parser.getDatabasePaths();

        assert.strictEqual(paths.length, 0);
    });

    test('Should handle missing DATALEVIN_DBS', () => {
        const content = 'OTHER_VAR=value';
        const parser = new EnvParser(content);
        const paths = parser.getDatabasePaths();

        assert.strictEqual(paths.length, 0);
    });
});
