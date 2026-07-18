import * as assert from 'assert';
import { offsetToPosition, marksToRanges } from '../../providers/diagnostics-provider';
import { parseStatements } from '../../utils/query-statements';
import { MarkedRange } from '../../utils/query-highlighter';

suite('Diagnostics Mapping Test Suite', () => {

    test('offsetToPosition maps offsets to zero-based line/character', () => {
        const text = 'ab\ncde\nf';
        assert.deepStrictEqual(offsetToPosition(text, 0), { line: 0, character: 0 });
        assert.deepStrictEqual(offsetToPosition(text, 2), { line: 0, character: 2 });
        assert.deepStrictEqual(offsetToPosition(text, 3), { line: 1, character: 0 });
        assert.deepStrictEqual(offsetToPosition(text, 6), { line: 1, character: 3 });
        assert.deepStrictEqual(offsetToPosition(text, 8), { line: 2, character: 1 });
    });

    test('offsetToPosition clamps past-the-end offsets', () => {
        assert.deepStrictEqual(offsetToPosition('ab', 99), { line: 0, character: 2 });
    });

    test('marksToRanges maps query-relative marks into document space', () => {
        const doc = `;; header comment
{:db "/tmp/shop"
 :query [:find ?e
         :where
         [?e :user/name]]
 :limit 50}
`;
        const stmts = parseStatements(doc);
        assert.strictEqual(stmts.length, 1);
        const stmt = stmts[0];
        assert.ok(stmt.queryText);

        // Mark the malformed 2-element clause [?e :user/name] inside the query
        const clauseStartInQuery = stmt.queryText!.indexOf('[?e :user/name]');
        const marks: MarkedRange[] = [{
            start: clauseStartInQuery,
            end: clauseStartInQuery + '[?e :user/name]'.length,
            cssClass: 'clause-mark',
            title: 'data patterns look like [?e :attr ?value]'
        }];

        const ranges = marksToRanges(doc, stmt, marks);
        assert.strictEqual(ranges.length, 1);
        // The clause sits on document line 4 (zero-based)
        assert.strictEqual(ranges[0].start.line, 4);
        assert.strictEqual(ranges[0].end.line, 4);
        assert.strictEqual(doc.split('\n')[4].indexOf('[?e :user/name]'), ranges[0].start.character);
        assert.strictEqual(ranges[0].end.character - ranges[0].start.character, '[?e :user/name]'.length);
    });

    test('marksToRanges works for bare queries (query starts the statement)', () => {
        const doc = `[:find ?e :where [?e :user/name]]`;
        const stmt = parseStatements(doc)[0];
        assert.strictEqual(stmt.kind, 'bare-query');

        const marks: MarkedRange[] = [{ start: 17, end: 32, cssClass: 'clause-mark' }];
        const ranges = marksToRanges(doc, stmt, marks);
        assert.strictEqual(ranges.length, 1);
        assert.deepStrictEqual(ranges[0].start, { line: 0, character: 17 });
        assert.deepStrictEqual(ranges[0].end, { line: 0, character: 32 });
    });
});
