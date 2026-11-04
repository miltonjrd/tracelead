import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { clicks, contacts, type Client } from '../db/schema.js';
import { DAY_MS } from '../lib/time.js';
import type { SessionStatus } from './whatsappSessions.js';

// A session can show "conectado" while WhatsApp no longer delivers anything. Neither signal alone is
// reliable (a quiet store is normal; clicks that never message are normal), so each one needs the other
// kind of evidence: silence only counts if people clicked meanwhile, and clicks only count in bulk.
export const SILENCE_LIMIT_MS = 12 * 60 * 60 * 1000;
export const CLICKS_WITHOUT_MESSAGES_MIN = 5;

export type HealthReason = { kind: 'silencio'; hours: number; clicks: number } | { kind: 'cliques'; clicks: number };

async function countClicks(db: Db, clientId: number, since: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(clicks)
    .where(and(eq(clicks.clientId, clientId), gte(clicks.createdAt, since)));
  return row?.n ?? 0;
}

/** Why a "connected" WhatsApp may be silently deaf; empty when nothing looks wrong. */
export async function connectionHealth(
  db: Db,
  client: Client,
  status: SessionStatus,
  lastEventAt: number | undefined,
  now = Date.now(),
): Promise<HealthReason[]> {
  if (client.whatsappMode !== 'baileys' || status.state !== 'conectado') return [];
  const reasons: HealthReason[] = [];

  if (lastEventAt !== undefined && now - lastEventAt >= SILENCE_LIMIT_MS) {
    const n = await countClicks(db, client.id, lastEventAt);
    if (n > 0) reasons.push({ kind: 'silencio', hours: Math.floor((now - lastEventAt) / 3_600_000), clicks: n });
  }

  const since = now - DAY_MS;
  const n = await countClicks(db, client.id, since);
  if (n >= CLICKS_WITHOUT_MESSAGES_MIN) {
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(contacts)
      .where(and(eq(contacts.clientId, client.id), gte(contacts.lastMessageAt, since)));
    if ((row?.n ?? 0) === 0) reasons.push({ kind: 'cliques', clicks: n });
  }
  return reasons;
}
