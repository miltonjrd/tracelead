import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { jobRuns } from '../db/schema.js';

export type JobName = 'backup' | 'ad_spend';

export async function runJob(
  db: Db,
  job: JobName,
  clientId: number | null,
  fn: () => Promise<string>,
): Promise<{ ok: boolean; detail: string }> {
  const [run] = await db
    .insert(jobRuns)
    .values({ job, clientId, status: 'rodando', startedAt: Date.now() })
    .returning({ id: jobRuns.id });
  try {
    const detail = await fn();
    await db.update(jobRuns).set({ status: 'ok', detail, finishedAt: Date.now() }).where(eq(jobRuns.id, run!.id));
    return { ok: true, detail };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await db.update(jobRuns).set({ status: 'erro', detail, finishedAt: Date.now() }).where(eq(jobRuns.id, run!.id));
    return { ok: false, detail };
  }
}

export async function recentRuns(db: Db, job: JobName, clientId: number | null, limit = 10) {
  return db
    .select()
    .from(jobRuns)
    .where(and(eq(jobRuns.job, job), clientId === null ? isNull(jobRuns.clientId) : eq(jobRuns.clientId, clientId)))
    .orderBy(desc(jobRuns.startedAt))
    .limit(limit);
}
