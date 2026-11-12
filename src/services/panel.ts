import { and, count, desc, eq, gte, inArray, like, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { contacts, ORIGENS, sales, type Client, type Contact, type Origem, type Sale } from '../db/schema.js';
import { addDays, DAY_MS, fromLocal, isIsoDate, localDate } from '../lib/time.js';

export class PanelError extends Error {}

export interface PanelRow {
  contact: Contact;
  lastSale: Sale | null;
}

// Open contacts stay on the client's list this long, so a missed day can still be marked.
export const OPEN_WINDOW_MS = 7 * DAY_MS;

async function withLastSales(db: Db, rows: Contact[]): Promise<PanelRow[]> {
  if (!rows.length) return [];
  const all = await db
    .select()
    .from(sales)
    .where(inArray(sales.contactId, rows.map((r) => r.id)))
    .orderBy(desc(sales.soldAt));
  const last = new Map<number, Sale>();
  for (const s of all) if (!last.has(s.contactId)) last.set(s.contactId, s);
  return rows.map((contact) => ({ contact, lastSale: last.get(contact.id) ?? null }));
}

export const PAGE_SIZES = [15, 30, 50, 100] as const;
export const PAGE_SIZE = PAGE_SIZES[0];

export interface PanelQuery {
  q?: string;
  page?: number;
  size?: number;
  origem?: Origem | '';
  /** Local "YYYY-MM-DD" bounds on the first message; empty means "the current list". */
  de?: string;
  ate?: string;
}

/** Search text, period and page number from a request, tolerant of junk. */
export function parsePanelQuery(raw: Record<string, unknown> = {}): Required<PanelQuery> {
  const n = Number(raw.pagina);
  const sz = Number(raw.por);
  // An inverted period ("de" after "ate") is read in the order the user meant.
  let de = isIsoDate(raw.de) ? raw.de : '';
  let ate = isIsoDate(raw.ate) ? raw.ate : '';
  if (de && ate && de > ate) [de, ate] = [ate, de];
  return {
    q: typeof raw.q === 'string' ? raw.q.trim().slice(0, 80) : '',
    page: Number.isInteger(n) && n > 0 ? n : 1,
    size: (PAGE_SIZES as readonly number[]).includes(sz) ? sz : PAGE_SIZE,
    origem: isOrigem(raw.origem) ? raw.origem : '',
    de,
    ate,
  };
}

export async function listPanel(db: Db, client: Client, now = Date.now(), query: PanelQuery = {}) {
  const startOfToday = fromLocal(localDate(now, client.timezone), client.timezone);
  const q = (query.q ?? '').trim();
  const digits = q.replace(/\D/g, '');
  const search = q
    ? or(like(contacts.name, `%${q}%`), digits ? like(contacts.phone, `%${digits}%`) : undefined)
    : undefined;
  const origem = query.origem ? eq(contacts.origem, query.origem) : undefined;
  // A period is an explicit request for old days: it replaces the 7-day window and today's ledger,
  // and it cuts by the date of contact (the first message), the same date the lists are ordered by.
  const de = query.de || '';
  const ate = query.ate || '';
  const periodo = de || ate ? and(
    de ? gte(contacts.firstMessageAt, fromLocal(de, client.timezone)) : undefined,
    ate ? lt(contacts.firstMessageAt, fromLocal(addDays(ate, 1), client.timezone)) : undefined,
  ) : undefined;
  const open = and(
    eq(contacts.clientId, client.id),
    eq(contacts.status, 'aberto'),
    periodo ?? gte(contacts.lastMessageAt, now - OPEN_WINDOW_MS),
    search,
    origem,
  );
  const [{ total }] = await db.select({ total: count() }).from(contacts).where(open);
  const size = query.size ?? PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, query.page ?? 1), pages);
  const pendentes = await db
    .select()
    .from(contacts)
    .where(open)
    .orderBy(desc(contacts.firstMessageAt))
    .limit(size)
    .offset((page - 1) * size);
  // A quote keeps its own list: still to be decided, but out of the way of the untouched contacts.
  // The window restarts when the quote is marked, so a slow answer does not drop it off the list.
  const orcamentos = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.clientId, client.id),
        eq(contacts.status, 'orcamento'),
        periodo ?? gte(sql`max(${contacts.lastMessageAt}, ${contacts.statusAt})`, now - OPEN_WINDOW_MS),
        search,
        origem,
      ),
    )
    .orderBy(desc(contacts.firstMessageAt));
  const resolvidos = await db
    .select()
    .from(contacts)
    .where(
      // The search box and the origem filter narrow every list, so a marked contact stays findable.
      and(
        eq(contacts.clientId, client.id),
        inArray(contacts.status, ['vendeu', 'nao_comprou']),
        periodo ?? gte(contacts.statusAt, startOfToday),
        search,
        origem,
      ),
    )
    .orderBy(periodo ? desc(contacts.firstMessageAt) : desc(contacts.statusAt));
  return {
    pendentes: await withLastSales(db, pendentes),
    orcamentos: await withLastSales(db, orcamentos),
    resolvidos: await withLastSales(db, resolvidos),
    total,
    page,
    pages,
    size,
    q,
    origem: query.origem ?? '',
    de,
    ate,
  };
}

/** True once the store has ever received a contact; tells a first-run list from a finished one. */
export async function hasAnyContact(db: Db, clientId: number): Promise<boolean> {
  const row = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.clientId, clientId)).limit(1);
  return row.length > 0;
}

export async function getPanelRow(db: Db, clientId: number, contactId: number): Promise<PanelRow | null> {
  const contact = await db.query.contacts.findFirst({
    where: and(eq(contacts.id, contactId), eq(contacts.clientId, clientId)),
  });
  if (!contact) return null;
  return (await withLastSales(db, [contact]))[0]!;
}

async function requireContact(db: Db, clientId: number, contactId: number): Promise<Contact> {
  const contact = await db.query.contacts.findFirst({
    where: and(eq(contacts.id, contactId), eq(contacts.clientId, clientId)),
  });
  if (!contact) throw new PanelError('Contato não encontrado');
  return contact;
}

export async function markSold(
  db: Db,
  clientId: number,
  contactId: number,
  valorCentavos: number,
  userId: number,
  now = Date.now(),
): Promise<void> {
  await requireContact(db, clientId, contactId);
  db.transaction((tx) => {
    tx.insert(sales)
      .values({ clientId, contactId, valorCentavos, soldAt: now, marcadoPor: userId, createdAt: now, updatedAt: now })
      .run();
    tx.update(contacts).set({ status: 'vendeu', statusAt: now }).where(eq(contacts.id, contactId)).run();
  });
}

/** Sets the contact aside as a pending quote; it still has to end in "vendeu" or "não comprou". */
export async function markBudget(db: Db, clientId: number, contactId: number, now = Date.now()): Promise<void> {
  const contact = await requireContact(db, clientId, contactId);
  if (contact.status === 'vendeu') throw new PanelError('Esse contato já foi marcado como vendeu. Desfaça a venda primeiro.');
  if (contact.status === 'orcamento') return;
  await db.update(contacts).set({ status: 'orcamento', statusAt: now }).where(eq(contacts.id, contactId));
}

export async function markNotBought(db: Db, clientId: number, contactId: number, now = Date.now()): Promise<void> {
  await requireContact(db, clientId, contactId);
  await db.update(contacts).set({ status: 'nao_comprou', statusAt: now }).where(eq(contacts.id, contactId));
}

/** Undoes "vendeu" / "não comprou" / "orçamento". A sale already sent to Google Ads can only be fixed by the admin. */
export async function reopen(db: Db, clientId: number, contactId: number, now = Date.now()): Promise<void> {
  const contact = await requireContact(db, clientId, contactId);
  if (contact.status === 'aberto') return;
  if (contact.status === 'vendeu') {
    const [sale] = await db
      .select()
      .from(sales)
      .where(eq(sales.contactId, contactId))
      .orderBy(desc(sales.soldAt))
      .limit(1);
    if (sale?.exportadaEm) throw new PanelError('Essa venda já foi enviada ao Google Ads. Peça a correção ao gestor.');
    db.transaction((tx) => {
      if (sale) tx.delete(sales).where(eq(sales.id, sale.id)).run();
      tx.update(contacts).set({ status: 'aberto', statusAt: now }).where(eq(contacts.id, contactId)).run();
    });
    return;
  }
  await db.update(contacts).set({ status: 'aberto', statusAt: now }).where(eq(contacts.id, contactId));
}

export function isOrigem(v: unknown): v is Origem {
  return typeof v === 'string' && (ORIGENS as readonly string[]).includes(v);
}

/** The client may only reclassify contacts without a tracked click; the admin may override any. */
export async function setOrigem(
  db: Db,
  clientId: number,
  contactId: number,
  origem: Origem,
  opts: { overrideTracked: boolean },
): Promise<void> {
  const contact = await requireContact(db, clientId, contactId);
  if (contact.clickId && !opts.overrideTracked) throw new PanelError('A origem desse contato veio do rastreio.');
  await db.update(contacts).set({ origem }).where(eq(contacts.id, contactId));
}
