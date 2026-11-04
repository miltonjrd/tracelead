import { createHash } from 'node:crypto';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { clicks, clients, contacts, type Click, type Client, type Origem } from '../db/schema.js';
import { isValidRef } from '../lib/ref.js';
import { DAY_MS, localDate } from '../lib/time.js';

const CLICK_FIELDS = [
  'gclid',
  'gbraid',
  'wbraid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;

// A ref only matches a click this recent: refs are random and short, so old ones may repeat.
const REF_MATCH_WINDOW_MS = 7 * DAY_MS;

export class InvalidClick extends Error {}

function field(body: Record<string, unknown>, name: string, max: number): string | null {
  const v = body[name];
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

export async function recordClick(
  db: Db,
  body: unknown,
  meta: { userAgent?: string; ip: string; ipHashSecret: string },
  now = Date.now(),
): Promise<Click | null> {
  if (!body || typeof body !== 'object') throw new InvalidClick('corpo inválido');
  const b = body as Record<string, unknown>;
  const key = field(b, 'k', 64);
  const ref = b.ref;
  if (!key || !isValidRef(ref)) throw new InvalidClick('chave ou ref inválidos');

  const client = await db.query.clients.findFirst({ where: eq(clients.publicKey, key) });
  if (!client?.active) return null;

  const v = Object.fromEntries(CLICK_FIELDS.map((f) => [f, field(b, f, 512)])) as Record<
    (typeof CLICK_FIELDS)[number],
    string | null
  >;
  const [click] = await db
    .insert(clicks)
    .values({
      clientId: client.id,
      ref,
      gclid: v.gclid,
      gbraid: v.gbraid,
      wbraid: v.wbraid,
      utmSource: v.utm_source,
      utmMedium: v.utm_medium,
      utmCampaign: v.utm_campaign,
      utmTerm: v.utm_term,
      utmContent: v.utm_content,
      landingUrl: field(b, 'landing_url', 2048),
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      ipHash: createHash('sha256').update(meta.ipHashSecret).update(meta.ip).digest('hex').slice(0, 32),
      createdAt: now,
    })
    .returning();
  return click!;
}

const PAID_MEDIUMS = new Set(['cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'sem']);

export function origemFromClick(click: Click): Origem {
  const paid =
    click.gclid || click.gbraid || click.wbraid || PAID_MEDIUMS.has((click.utmMedium ?? '').toLowerCase());
  return paid ? 'anuncio' : 'site';
}

export interface InboundMessage {
  from: string;
  name: string | null;
  timestamp: number;
  ref: string | null;
}

/** Links a WhatsApp message to its contact (creating it) and, via ref, to the click that opened the chat. */
export async function handleInboundMessage(db: Db, client: Client, msg: InboundMessage): Promise<void> {
  const phone = `+${msg.from.replace(/\D/g, '')}`;
  let click: Click | undefined;
  if (msg.ref) {
    [click] = await db
      .select()
      .from(clicks)
      .where(
        and(
          eq(clicks.clientId, client.id),
          eq(clicks.ref, msg.ref),
          gte(clicks.createdAt, msg.timestamp - REF_MATCH_WINDOW_MS),
          lte(clicks.createdAt, msg.timestamp + 5 * 60 * 1000),
        ),
      )
      .orderBy(desc(clicks.createdAt))
      .limit(1);
  }

  const inserted = await db
    .insert(contacts)
    .values({
      clientId: client.id,
      phone,
      name: msg.name,
      firstMessageAt: msg.timestamp,
      lastMessageAt: msg.timestamp,
      origem: click ? origemFromClick(click) : 'desconhecida',
      clickId: click?.id ?? null,
      campanha: click?.utmCampaign ?? null,
      status: 'aberto',
      statusAt: msg.timestamp,
    })
    .onConflictDoNothing({ target: [contacts.clientId, contacts.phone] })
    .returning({ id: contacts.id });
  if (inserted.length) return;

  const existing = (await db.query.contacts.findFirst({
    where: and(eq(contacts.clientId, client.id), eq(contacts.phone, phone)),
  }))!;
  const set: Partial<typeof contacts.$inferInsert> = {
    lastMessageAt: Math.max(existing.lastMessageAt, msg.timestamp),
  };
  if (!existing.name && msg.name) set.name = msg.name;
  if (!existing.clickId && click) {
    set.clickId = click.id;
    set.campanha = click.utmCampaign;
    if (existing.origem === 'desconhecida') set.origem = origemFromClick(click);
  }
  // A message on a later day than the last "vendeu"/"não comprou" puts the contact back in the
  // client's list, so repeat purchases get marked too. Same-day messages ("obrigado!") don't.
  if (
    existing.status !== 'aberto' &&
    localDate(msg.timestamp, client.timezone) > localDate(existing.statusAt, client.timezone)
  ) {
    set.status = 'aberto';
    set.statusAt = msg.timestamp;
  }
  await db.update(contacts).set(set).where(eq(contacts.id, existing.id));
}
