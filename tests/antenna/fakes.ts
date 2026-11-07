// tests/antenna/fakes.ts
// ----------------------------------------------------------------------------
// ANTENNA-003 · an in-memory double for the one slice of the Supabase client the
// event writers use: from(table).select(cols,{head,count}).eq().eq() and
// from(table).insert(row). Enough to prove recordHumanPairedOnce is idempotent
// both WITH a unique index (the second insert raises 23505) and WITHOUT one (the
// pre-count catches the duplicate before any insert). No network, no supabase-js.
// ----------------------------------------------------------------------------

export interface InsertResult {
  error: { code?: string; message: string } | null;
}
export interface CountResult {
  count: number | null;
  error: { message: string } | null;
}

interface Row {
  agent_id: string | null;
  event: string;
  [k: string]: unknown;
}

/**
 * `mode` decides what a duplicate insert does:
 *   'index'   — a partial unique index exists; a second row for the same
 *               (event, agent_id) is rejected with 23505 and NOT stored.
 *   'no-index' — no index; every insert is stored. Idempotency must then come
 *               from the caller's pre-count.
 */
export class FakeEventsAdmin {
  rows: Row[] = [];
  inserts = 0;
  constructor(private mode: 'index' | 'no-index') {}

  from(_table: string) {
    const self = this;
    return {
      // select('id', { count: 'exact', head: true }).eq().eq()
      select(_cols: string, _opts?: unknown) {
        const filters: Record<string, unknown> = {};
        const builder = {
          eq(col: string, val: unknown) {
            filters[col] = val;
            return builder;
          },
          then(resolve: (r: CountResult) => void) {
            const count = self.rows.filter(
              (r) => r.event === filters.event && r.agent_id === filters.agent_id,
            ).length;
            resolve({ count, error: null });
          },
        };
        return builder;
      },
      insert(row: Row) {
        return {
          then(resolve: (r: InsertResult) => void) {
            self.inserts += 1;
            if (self.mode === 'index') {
              const dup = self.rows.some(
                (r) => r.event === row.event && r.agent_id === row.agent_id,
              );
              if (dup) {
                resolve({ error: { code: '23505', message: 'duplicate key value' } });
                return;
              }
            }
            self.rows.push(row);
            resolve({ error: null });
          },
        };
      },
    };
  }

  countPaired(agentId: string): number {
    return this.rows.filter((r) => r.event === 'human_paired' && r.agent_id === agentId).length;
  }
}
