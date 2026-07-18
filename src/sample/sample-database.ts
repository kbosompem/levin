/**
 * Builds the Mini-Northwind sample database: schema + vector opts, seed
 * data (tempid-resolved), and stored rules. Sequences existing DtlvBridge
 * methods - no new bridge machinery.
 */
import { DtlvBridge } from '../dtlv-bridge';
import {
    MINI_NORTHWIND_SCHEMA,
    MINI_NORTHWIND_DATA,
    MINI_NORTHWIND_RULES,
    SAMPLE_VECTOR_DIMENSIONS
} from './northwind-mini';

/**
 * Create and seed the sample database at dbPath. Throws on any failure;
 * the caller decides how to surface it (and whether to clean up).
 */
export async function buildSampleDatabase(bridge: DtlvBridge, dbPath: string): Promise<void> {
    const created = await bridge.createDatabase(dbPath, {
        schema: MINI_NORTHWIND_SCHEMA,
        vectorOpts: { dimensions: SAMPLE_VECTOR_DIMENSIONS, metricType: 'cosine' },
        autoEntityTime: true
    });
    if (!created.success) {
        throw new Error(`Failed to create sample database: ${created.error}`);
    }

    const seeded = await bridge.importWithTempIds(dbPath, MINI_NORTHWIND_DATA);
    if (!seeded.success) {
        throw new Error(`Failed to seed sample database: ${seeded.error}`);
    }

    for (const rule of MINI_NORTHWIND_RULES) {
        const saved = await bridge.saveRule(dbPath, rule.name, rule.body, rule.description);
        if (!saved.success) {
            throw new Error(`Failed to store rule "${rule.name}": ${saved.error}`);
        }
    }
}
