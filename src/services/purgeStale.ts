import { and, count, eq, inArray, isNull, lt, notInArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { contacts, sales } from '../db/schema.js';

export interface PurgeResult {
  total: number;
  matched: number;
  deleted: number;
}

/**
 * Removes contacts that look like old chats imported by WhatsApp and never worked by the client: last message
 * before `before`, no ad/site click, still "aberto", no sale, not exported to Google Ads and not in a funnel
 * stage. Anything the client touched or that has a click stays. Without `apply` it only counts.
 */
export async function purgeStaleContacts(db: Db, clientId: number, before: number, apply: boolean): Promise<PurgeResult> {
  const [{ total }] = await db.select({ total: count() }).from(contacts).where(eq(contacts.clientId, clientId));
  const ids = (
    await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.clientId, clientId),
          lt(contacts.lastMessageAt, before),
          eq(contacts.origem, 'desconhecida'),
          isNull(contacts.clickId),
          eq(contacts.status, 'aberto'),
          isNull(contacts.stageId),
          isNull(contacts.exportadaEm),
          notInArray(contacts.id, db.select({ id: sales.contactId }).from(sales).where(eq(sales.clientId, clientId))),
        ),
      )
  ).map((r) => r.id);

  let deleted = 0;
  if (apply) {
    db.transaction((tx) => {
      for (let i = 0; i < ids.length; i += 500) {
        deleted += tx.delete(contacts).where(inArray(contacts.id, ids.slice(i, i + 500))).run().changes;
      }
    });
  }
  return { total: total, matched: ids.length, deleted };
}
