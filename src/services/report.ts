import { and, count, eq, gte, inArray, lt, max } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { adSpend, clicks, contacts, sales, type Client, type Click, type Contact, type Origem } from '../db/schema.js';
import { addDays, DAY_MS, fromLocal, localDate } from '../lib/time.js';

export interface CampaignRow {
  key: string;
  name: string;
  costMicros: number;
  adClicks: number;
  impressions: number;
  conversas: number;
  vendas: number;
  valorCentavos: number;
}

export interface OrigemRow {
  origem: Origem;
  conversas: number;
  vendas: number;
  valorCentavos: number;
}

export interface WeeklyReport {
  start: string;
  end: string;
  campaigns: CampaignRow[];
  origens: OrigemRow[];
  totals: { costMicros: number; conversas: number; vendas: number; valorCentavos: number; valorAnuncioCentavos: number };
  botaoCliques: number;
  conversasRastreadas: number;
  pendentesMarcacao: number;
}

const NO_CAMPAIGN = '__sem_campanha__';

export async function weeklyReport(db: Db, client: Client, start: string, now = Date.now()): Promise<WeeklyReport> {
  const tz = client.timezone;
  const end = addDays(start, 6);
  const fromTs = fromLocal(start, tz);
  const toTs = fromLocal(addDays(start, 7), tz);

  const allSpend = await db.select().from(adSpend).where(eq(adSpend.clientId, client.id));
  const names = new Map<string, string>();
  for (const s of allSpend) names.set(s.campaignId, s.campaignName);
  const byLowerName = new Map([...names].map(([id, name]) => [name.toLowerCase(), id]));

  const rows = new Map<string, CampaignRow>();
  const row = (key: string): CampaignRow => {
    let r = rows.get(key);
    if (!r) {
      const name =
        key === NO_CAMPAIGN ? 'Anúncio (campanha não identificada)' : key.startsWith('utm:') ? key.slice(4) : names.get(key) ?? `Campanha ${key}`;
      r = { key, name, costMicros: 0, adClicks: 0, impressions: 0, conversas: 0, vendas: 0, valorCentavos: 0 };
      rows.set(key, r);
    }
    return r;
  };

  for (const s of allSpend) {
    if (s.date < start || s.date > end) continue;
    const r = row(s.campaignId);
    r.costMicros += s.costMicros;
    r.adClicks += s.clicks;
    r.impressions += s.impressions;
  }

  const campaignKey = (contact: Contact, click: Click | null): string | null => {
    if (contact.origem !== 'anuncio') return null;
    if (click?.campaignId) return click.campaignId;
    const utm = click?.utmCampaign ?? contact.campanha;
    if (utm) return names.has(utm) ? utm : byLowerName.get(utm.toLowerCase()) ?? `utm:${utm}`;
    return NO_CAMPAIGN;
  };

  const origens = new Map<Origem, OrigemRow>();
  const origemRow = (origem: Origem): OrigemRow => {
    let r = origens.get(origem);
    if (!r) origens.set(origem, (r = { origem, conversas: 0, vendas: 0, valorCentavos: 0 }));
    return r;
  };

  const weekContacts = await db
    .select({ contact: contacts, click: clicks })
    .from(contacts)
    .leftJoin(clicks, eq(clicks.id, contacts.clickId))
    .where(and(eq(contacts.clientId, client.id), gte(contacts.firstMessageAt, fromTs), lt(contacts.firstMessageAt, toTs)));
  let conversasRastreadas = 0;
  for (const { contact, click } of weekContacts) {
    origemRow(contact.origem).conversas++;
    if (contact.clickId) conversasRastreadas++;
    const key = campaignKey(contact, click);
    if (key) row(key).conversas++;
  }

  const weekSales = await db
    .select({ sale: sales, contact: contacts, click: clicks })
    .from(sales)
    .innerJoin(contacts, eq(contacts.id, sales.contactId))
    .leftJoin(clicks, eq(clicks.id, contacts.clickId))
    .where(and(eq(sales.clientId, client.id), gte(sales.soldAt, fromTs), lt(sales.soldAt, toTs)));
  for (const { sale, contact, click } of weekSales) {
    const o = origemRow(contact.origem);
    o.vendas++;
    o.valorCentavos += sale.valorCentavos;
    const key = campaignKey(contact, click);
    if (key) {
      const r = row(key);
      r.vendas++;
      r.valorCentavos += sale.valorCentavos;
    }
  }

  const [{ n: botaoCliques } = { n: 0 }] = await db
    .select({ n: count() })
    .from(clicks)
    .where(and(eq(clicks.clientId, client.id), gte(clicks.createdAt, fromTs), lt(clicks.createdAt, toTs)));

  const startOfToday = fromLocal(localDate(now, tz), tz);
  const [{ n: pendentesMarcacao } = { n: 0 }] = await db
    .select({ n: count() })
    .from(contacts)
    .where(
      and(
        eq(contacts.clientId, client.id),
        // A quote still waits for a final mark, so it counts as pending too.
        inArray(contacts.status, ['aberto', 'orcamento']),
        lt(contacts.lastMessageAt, startOfToday),
        gte(contacts.lastMessageAt, now - 7 * DAY_MS),
      ),
    );

  const campaigns = [...rows.values()].sort((a, b) => b.costMicros - a.costMicros || b.conversas - a.conversas);
  const totals = { costMicros: 0, conversas: weekContacts.length, vendas: weekSales.length, valorCentavos: 0, valorAnuncioCentavos: 0 };
  for (const c of campaigns) {
    totals.costMicros += c.costMicros;
    totals.valorAnuncioCentavos += c.valorCentavos;
  }
  for (const { sale } of weekSales) totals.valorCentavos += sale.valorCentavos;

  return {
    start,
    end,
    campaigns,
    origens: [...origens.values()].sort((a, b) => b.conversas - a.conversas),
    totals,
    botaoCliques,
    conversasRastreadas,
    pendentesMarcacao,
  };
}

export async function lastSpendDate(db: Db, clientId: number): Promise<string | null> {
  const [row] = await db.select({ date: max(adSpend.date) }).from(adSpend).where(eq(adSpend.clientId, clientId));
  return row?.date ?? null;
}
