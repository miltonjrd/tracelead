import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { clicks, contacts, exports, sales, type Client } from '../db/schema.js';
import { toCsv } from '../lib/csv.js';
import { DAY_MS, localDateTime } from '../lib/time.js';

export type ExportTipo = 'lead' | 'venda';

// Google Ads rejects offline conversions for clicks older than 90 days.
const CLICK_MAX_AGE_MS = 90 * DAY_MS;

interface ClickIds {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
}

interface Candidate extends ClickIds {
  referenciaId: number;
  clickAt: number;
  conversaoEm: number;
  valorCentavos: number | null;
}

type Reader = Pick<Db, 'select'>;

const hasClickId = or(isNotNull(clicks.gclid), isNotNull(clicks.gbraid), isNotNull(clicks.wbraid));

/** One identifier per conversion, the most specific the click has: gclid, then gbraid, then wbraid. */
function pickClickId(c: ClickIds): ClickIds {
  if (c.gclid) return { gclid: c.gclid, gbraid: null, wbraid: null };
  if (c.gbraid) return { gclid: null, gbraid: c.gbraid, wbraid: null };
  return { gclid: null, gbraid: null, wbraid: c.wbraid };
}

function leadCandidates(db: Reader, clientId: number): Candidate[] {
  return db
    .select({
      referenciaId: contacts.id,
      gclid: clicks.gclid,
      gbraid: clicks.gbraid,
      wbraid: clicks.wbraid,
      clickAt: clicks.createdAt,
      firstMessageAt: contacts.firstMessageAt,
    })
    .from(contacts)
    .innerJoin(clicks, eq(clicks.id, contacts.clickId))
    .where(and(eq(contacts.clientId, clientId), isNull(contacts.exportadaEm), hasClickId))
    .all()
    .map((r) => ({
      referenciaId: r.referenciaId,
      ...pickClickId(r),
      clickAt: r.clickAt,
      // Google rejects a conversion timed before its click.
      conversaoEm: Math.max(r.firstMessageAt, r.clickAt + 1000),
      valorCentavos: null,
    }));
}

function saleCandidates(db: Reader, clientId: number): Candidate[] {
  return db
    .select({
      referenciaId: sales.id,
      gclid: clicks.gclid,
      gbraid: clicks.gbraid,
      wbraid: clicks.wbraid,
      clickAt: clicks.createdAt,
      soldAt: sales.soldAt,
      valorCentavos: sales.valorCentavos,
    })
    .from(sales)
    .innerJoin(contacts, eq(contacts.id, sales.contactId))
    .innerJoin(clicks, eq(clicks.id, contacts.clickId))
    .where(and(eq(sales.clientId, clientId), isNull(sales.exportadaEm), hasClickId))
    .all()
    .map((r) => ({
      referenciaId: r.referenciaId,
      ...pickClickId(r),
      clickAt: r.clickAt,
      conversaoEm: Math.max(r.soldAt, r.clickAt + 1000),
      valorCentavos: r.valorCentavos,
    }));
}

function candidates(db: Reader, clientId: number, tipo: ExportTipo): Candidate[] {
  return tipo === 'lead' ? leadCandidates(db, clientId) : saleCandidates(db, clientId);
}

export function exportStats(db: Db, clientId: number, now = Date.now()) {
  const split = (tipo: ExportTipo) => {
    const all = candidates(db, clientId, tipo);
    const prontos = all.filter((c) => now - c.clickAt <= CLICK_MAX_AGE_MS).length;
    return { prontos, foraDoPrazo: all.length - prontos };
  };
  // Tracked contacts/sales whose click came without gclid (e.g. iPhone gbraid/wbraid only).
  const [semGclid] = db
    .select({
      leads: sql<number>`count(distinct ${contacts.id})`,
    })
    .from(contacts)
    .innerJoin(clicks, eq(clicks.id, contacts.clickId))
    .where(and(eq(contacts.clientId, clientId), isNull(clicks.gclid), eq(contacts.origem, 'anuncio')))
    .all();
  return { lead: split('lead'), venda: split('venda'), anuncioSemGclid: semGclid?.leads ?? 0 };
}

export function createExportFile(
  db: Db,
  client: Client,
  tipo: ExportTipo,
  now = Date.now(),
): { arquivo: string; linhas: number } | null {
  return db.transaction((tx) => {
    const rows = candidates(tx, client.id, tipo).filter((c) => now - c.clickAt <= CLICK_MAX_AGE_MS);
    if (!rows.length) return null;

    const stamp = localDateTime(now, client.timezone).replace(' ', '-').replace(/:/g, '');
    const taken = (name: string) =>
      tx
        .select({ id: exports.id })
        .from(exports)
        .where(and(eq(exports.clientId, client.id), eq(exports.arquivo, name)))
        .limit(1)
        .all().length > 0;
    let arquivo = `${tipo}-${stamp}.csv`;
    for (let n = 2; taken(arquivo); n++) arquivo = `${tipo}-${stamp}-${n}.csv`;

    tx.insert(exports)
      .values(
        rows.map((r) => ({
          clientId: client.id,
          tipo,
          referenciaId: r.referenciaId,
          arquivo,
          gclid: r.gclid,
          gbraid: r.gbraid,
          wbraid: r.wbraid,
          conversaoEm: r.conversaoEm,
          valorCentavos: r.valorCentavos,
          exportadoEm: now,
        })),
      )
      .run();
    const ids = rows.map((r) => r.referenciaId);
    if (tipo === 'lead') tx.update(contacts).set({ exportadaEm: now }).where(inArray(contacts.id, ids)).run();
    else tx.update(sales).set({ exportadaEm: now }).where(inArray(sales.id, ids)).run();
    return { arquivo, linhas: rows.length };
  });
}

export async function listExportFiles(db: Db, clientId: number) {
  return db
    .select({
      arquivo: exports.arquivo,
      tipo: exports.tipo,
      linhas: sql<number>`count(*)`,
      valorCentavos: sql<number>`coalesce(sum(${exports.valorCentavos}), 0)`,
      exportadoEm: sql<number>`min(${exports.exportadoEm})`,
      importado: sql<number>`min(case when ${exports.status} = 'importado' then 1 else 0 end)`,
    })
    .from(exports)
    .where(eq(exports.clientId, clientId))
    .groupBy(exports.arquivo, exports.tipo)
    .orderBy(desc(sql`min(${exports.exportadoEm})`));
}

/** CSV in the layout of Google Ads' offline click-conversion import template. */
export async function exportFileCsv(
  db: Db,
  client: Client,
  arquivo: string,
  names: { lead: string; venda: string },
): Promise<string | null> {
  const rows = await db
    .select()
    .from(exports)
    .where(and(eq(exports.clientId, client.id), eq(exports.arquivo, arquivo)))
    .orderBy(exports.conversaoEm);
  if (!rows.length) return null;
  const lines: (string | number | null)[][] = [
    [`Parameters:TimeZone=${client.timezone}`],
    ['Google Click ID', 'Conversion Name', 'Conversion Time', 'Conversion Value', 'Conversion Currency'],
  ];
  for (const r of rows) {
    const venda = r.tipo === 'venda';
    lines.push([
      r.gclid,
      venda ? names.venda : names.lead,
      localDateTime(r.conversaoEm, client.timezone),
      venda && r.valorCentavos !== null ? (r.valorCentavos / 100).toFixed(2) : '',
      venda ? client.currency : '',
    ]);
  }
  return toCsv(lines);
}

export async function markFileImported(db: Db, clientId: number, arquivo: string): Promise<void> {
  await db
    .update(exports)
    .set({ status: 'importado' })
    .where(and(eq(exports.clientId, clientId), eq(exports.arquivo, arquivo)));
}
