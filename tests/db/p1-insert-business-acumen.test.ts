// @vitest-environment node
// P1 Task 5 — tests for scripts/catalog/insert-business-acumen.ts. The DB
// write tests run ONLY against the main P1 scratch (isP1MainDb()), every
// write inside a transaction that is rolled back so the cloned rows are
// never changed. The spec-parsing / arg-parsing tests are pure and run
// unconditionally.
import { describe, it, expect } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { subCompetencies, subCompetencyMap, careerTargetRequirements } from '@/lib/db/schema';
import {
  parseArgs,
  parseSpec,
  validateEntry,
  insertBusinessAcumen,
  assertExpectedDb,
  type Tx,
  type BusinessAcumenEntry,
} from '@/scripts/catalog/insert-business-acumen';
import { isP1MainDb, SCRATCH_DB } from './p1/scratch-guard';

const RUN = isP1MainDb();

class Rollback extends Error {}
async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await expect(db.transaction(async (tx) => {
    await fn(tx);
    throw new Rollback('rollback');
  })).rejects.toBeInstanceOf(Rollback);
}

function entry(overrides: Partial<BusinessAcumenEntry> = {}): BusinessAcumenEntry {
  return {
    id: 'test-business-acumen-entry',
    name: 'Test business acumen entry',
    knowDescriptor: 'Knows the thing.',
    understandDescriptor: 'Understands why the thing matters.',
    doDescriptor: 'Does the thing.',
    rationale: 'Because the test needs it.',
    ...overrides,
  };
}

// ─── parseArgs (pure) ───────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('requires --expect-db', () => {
    expect(() => parseArgs(['--file', 'spec.json'])).toThrow(/--expect-db/);
  });

  it('requires --file', () => {
    expect(() => parseArgs(['--expect-db', SCRATCH_DB])).toThrow(/--file/);
  });

  it('accepts --file and --expect-db, defaulting apply to false', () => {
    const args = parseArgs(['--file', 'spec.json', '--expect-db', SCRATCH_DB]);
    expect(args).toEqual({ file: 'spec.json', expectDb: SCRATCH_DB, apply: false });
  });

  it('sets apply when --apply is present', () => {
    const args = parseArgs(['--file', 'spec.json', '--expect-db', SCRATCH_DB, '--apply']);
    expect(args.apply).toBe(true);
  });
});

// ─── validateEntry / parseSpec (pure — malformed-entry refusal) ────────────

describe('validateEntry', () => {
  it('accepts a well-formed entry', () => {
    expect(validateEntry(entry(), 0)).toEqual(entry());
  });

  it('refuses a non-object entry', () => {
    expect(() => validateEntry('nope', 0)).toThrow(/not an object/);
  });

  it.each(['id', 'name', 'knowDescriptor', 'understandDescriptor', 'doDescriptor', 'rationale'] as const)(
    'refuses a missing %s',
    (field) => {
      const bad: Record<string, unknown> = { ...entry() };
      delete bad[field];
      expect(() => validateEntry(bad, 0)).toThrow(new RegExp(field));
    },
  );

  it('refuses an empty-string field', () => {
    expect(() => validateEntry(entry({ name: '' }), 0)).toThrow(/name/);
  });

  it('refuses an id that is not lowercase-kebab-case', () => {
    expect(() => validateEntry(entry({ id: 'Not_Kebab' }), 0)).toThrow(/kebab-case/);
  });
});

describe('parseSpec', () => {
  it('parses the approved shape', () => {
    const spec = parseSpec({ _approval: 'Approved', competencies: [entry()] });
    expect(spec.approval).toBe('Approved');
    expect(spec.competencies).toEqual([entry()]);
  });

  it('refuses a missing _approval', () => {
    expect(() => parseSpec({ competencies: [entry()] })).toThrow(/_approval/);
  });

  it('refuses an empty competencies array', () => {
    expect(() => parseSpec({ _approval: 'Approved', competencies: [] })).toThrow(/non-empty array/);
  });

  it('refuses a malformed entry inside the array', () => {
    expect(() => parseSpec({ _approval: 'Approved', competencies: [entry({ name: '' })] })).toThrow(/name/);
  });

  it('refuses a duplicate id within the file', () => {
    expect(() => parseSpec({ _approval: 'Approved', competencies: [entry(), entry()] })).toThrow(/duplicate id/);
  });
});

// ─── insertBusinessAcumen (DB write — scratch only) ────────────────────────

async function readInserted(executor: Tx | typeof db, ids: string[]) {
  return executor.select().from(subCompetencies).where(inArray(subCompetencies.id, ids));
}

async function readMapRows(executor: Tx | typeof db, ids: string[]) {
  return executor.select().from(subCompetencyMap).where(inArray(subCompetencyMap.oldSubCompetencyId, ids));
}

describe.skipIf(!RUN)('P1 Task 5 — insertBusinessAcumen (scratch DB only)', () => {
  it('inserts each entry unlinked, origin=gc_authored, retired=false, plus an identity map row', async () => {
    await inRolledBackTx(async (tx) => {
      const entries = [entry({ id: 'p1-task5-test-a' }), entry({ id: 'p1-task5-test-b', name: 'Second' })];
      await insertBusinessAcumen(tx, entries);

      const rows = await readInserted(tx, entries.map(e => e.id));
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.origin).toBe('gc_authored');
        expect(row.retired).toBe(false);
        expect(row.mergedInto).toBeNull();
      }

      const mapRows = await readMapRows(tx, entries.map(e => e.id));
      expect(mapRows).toHaveLength(2);
      for (const m of mapRows) {
        expect(m.competencyId).toBe(m.oldSubCompetencyId);
        expect(m.mergeNote).toBeNull();
      }

      // Unlinked: no career_target_requirements row for either id.
      const requirementRows = await tx
        .select()
        .from(careerTargetRequirements)
        .where(inArray(careerTargetRequirements.competencyId, entries.map(e => e.id)));
      expect(requirementRows).toHaveLength(0);
    });
  });

  it('refuses when an id already exists, and writes nothing (no silent overwrite)', async () => {
    await inRolledBackTx(async (tx) => {
      const existingId = 'p1-task5-test-conflict';
      await tx.insert(subCompetencies).values({
        id: existingId,
        name: 'Pre-existing',
        knowDescriptor: 'k', understandDescriptor: 'u', doDescriptor: 'd',
        retired: false, origin: 'migrated', updatedAt: new Date(),
      });
      await tx.insert(subCompetencyMap).values({ oldSubCompetencyId: existingId, competencyId: existingId, mergeNote: null });

      const entries = [entry({ id: existingId }), entry({ id: 'p1-task5-test-sibling' })];
      await expect(insertBusinessAcumen(tx, entries)).rejects.toThrow(/already exist/);

      // The sibling (not itself conflicting) must NOT have been inserted either.
      const sibling = await readInserted(tx, ['p1-task5-test-sibling']);
      expect(sibling).toHaveLength(0);

      // The pre-existing row is untouched (still origin='migrated').
      const [preExisting] = await readInserted(tx, [existingId]);
      expect(preExisting?.origin).toBe('migrated');
    });
  });

  it('writing zero entries is a no-op', async () => {
    await inRolledBackTx(async (tx) => {
      await expect(insertBusinessAcumen(tx, [])).resolves.toBeUndefined();
    });
  });
});

describe.skipIf(!RUN)('P1 Task 5 — assertExpectedDb (reused from ingest-alumni-mix)', () => {
  it('resolves when --expect-db matches current_database()', async () => {
    await expect(assertExpectedDb(SCRATCH_DB)).resolves.toBeUndefined();
  });

  it('refuses when --expect-db does not match current_database()', async () => {
    await expect(assertExpectedDb('not_the_real_database')).rejects.toThrow(/refusing: connected to database/);
  });
});
