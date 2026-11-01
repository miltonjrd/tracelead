import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { openDb, type Db } from '../src/db/client.js';
import { clicks, contacts, exports, sales, type Client } from '../src/db/schema.js';
import { createClient } from '../src/services/accounts.js';
import { createExportFile, exportFileCsv, exportStats } from '../src/services/exports.js';
import { DAY_MS } from '../src/lib/time.js';
import { form, login, setup } from './helpers.js';

function migrationSql(name: string): string[] {
  return readFileSync(new URL(`../drizzle/${name}.sql`, import.meta.url), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
}

function migrated(upTo: string[]): Database.Database {
  const sqlite = new Database(':memory:');
  for (const name of upTo) for (const stmt of migrationSql(name)) sqlite.exec(stmt);
  return sqlite;
}

const CLIENT = `insert into clients (name, public_key, timezone, currency, created_at) values ('Loja', 'k1', 'America/Sao_Paulo', 'BRL', 1)`;

test('migração mantém exportações antigas com gclid', () => {
  const sqlite = migrated(['0000_init', '0001_whatsapp_baileys']);
  sqlite.exec(CLIENT);
  sqlite.exec(
    `insert into exports (client_id, tipo, referencia_id, arquivo, gclid, conversao_em, valor_centavos, exportado_em)
     values (1, 'venda', 7, 'venda-antigo.csv', 'GCLID-ANTIGO', 1000, 15000, 2000)`,
  );
  for (const stmt of migrationSql('0002_export_braid')) sqlite.exec(stmt);

  const rows = sqlite
    .prepare('select tipo, referencia_id as ref, arquivo, gclid, gbraid, wbraid, conversao_em as em, valor_centavos as valor, status from exports')
    .all();
  assert.deepEqual(rows, [
    { tipo: 'venda', ref: 7, arquivo: 'venda-antigo.csv', gclid: 'GCLID-ANTIGO', gbraid: null, wbraid: null, em: 1000, valor: 15000, status: 'gerado' },
  ]);
});

test('exportação só com gbraid é aceita depois da migração', () => {
  const sqlite = migrated(['0000_init', '0001_whatsapp_baileys', '0002_export_braid']);
  sqlite.exec(CLIENT);
  sqlite.exec(
    `insert into exports (client_id, tipo, referencia_id, arquivo, gbraid, conversao_em, exportado_em)
     values (1, 'lead', 3, 'lead-novo.csv', 'GBRAID-1', 1000, 2000)`,
  );
  const row = sqlite.prepare('select gclid, gbraid, wbraid from exports').get();
  assert.deepEqual(row, { gclid: null, gbraid: 'GBRAID-1', wbraid: null });
});

const NOW = Date.UTC(2026, 9, 31, 15, 0, 0);
let seq = 0;

interface Ids {
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
}

/** A contact (and, for "venda", its sale) whose click happened `ageDays` before NOW. */
async function seed(db: Db, client: Client, ids: Ids, opts: { ageDays?: number; extraMs?: number; sale?: boolean; now?: number } = {}) {
  const n = ++seq;
  const clickAt = (opts.now ?? NOW) - (opts.ageDays ?? 1) * DAY_MS - (opts.extraMs ?? 0);
  const [click] = await db
    .insert(clicks)
    .values({
      clientId: client.id,
      ref: `REF${n}`.padEnd(5, '2').slice(0, 5),
      gclid: ids.gclid ?? null,
      gbraid: ids.gbraid ?? null,
      wbraid: ids.wbraid ?? null,
      utmMedium: 'cpc',
      createdAt: clickAt,
    })
    .returning();
  const [contact] = await db
    .insert(contacts)
    .values({
      clientId: client.id,
      phone: `+55119000000${String(n).padStart(2, '0')}`,
      firstMessageAt: clickAt + 60_000,
      lastMessageAt: clickAt + 60_000,
      origem: 'anuncio',
      clickId: click!.id,
      status: opts.sale ? 'vendeu' : 'aberto',
      statusAt: clickAt + 60_000,
    })
    .returning();
  if (!opts.sale) return { contact: contact! };
  const [sale] = await db
    .insert(sales)
    .values({
      clientId: client.id,
      contactId: contact!.id,
      valorCentavos: 10000 + n,
      soldAt: clickAt + 120_000,
      createdAt: clickAt + 120_000,
      updatedAt: clickAt + 120_000,
    })
    .returning();
  return { contact: contact!, sale: sale! };
}

async function fresh() {
  const db = openDb(':memory:');
  const client = await createClient(db, { name: 'Loja' }, NOW);
  return { db, client };
}

async function exported(db: Db) {
  return db.select().from(exports).orderBy(exports.id);
}

test('arquivo inclui itens com gclid, gbraid ou wbraid', async () => {
  const { db, client } = await fresh();
  const a = await seed(db, client, { gclid: 'G-A' }, { sale: true });
  const b = await seed(db, client, { gbraid: 'GB-B' }, { sale: true });
  const c = await seed(db, client, { wbraid: 'WB-C' }, { sale: true });

  const lead = createExportFile(db, client, 'lead', NOW);
  assert.equal(lead?.linhas, 3);
  const venda = createExportFile(db, client, 'venda', NOW);
  assert.equal(venda?.linhas, 3);

  const rows = await exported(db);
  const byTipo = (tipo: string) => rows.filter((r) => r.tipo === tipo).map((r) => [r.referenciaId, r.gclid, r.gbraid, r.wbraid]);
  assert.deepEqual(byTipo('lead'), [
    [a.contact.id, 'G-A', null, null],
    [b.contact.id, null, 'GB-B', null],
    [c.contact.id, null, null, 'WB-C'],
  ]);
  assert.deepEqual(byTipo('venda'), [
    [a.sale!.id, 'G-A', null, null],
    [b.sale!.id, null, 'GB-B', null],
    [c.sale!.id, null, null, 'WB-C'],
  ]);
});

test('exportação grava só o gclid quando o clique tem os três', async () => {
  const { db, client } = await fresh();
  await seed(db, client, { gclid: 'G-1', gbraid: 'GB-1', wbraid: 'WB-1' });
  createExportFile(db, client, 'lead', NOW);
  const [row] = await exported(db);
  assert.deepEqual([row!.gclid, row!.gbraid, row!.wbraid], ['G-1', null, null]);
});

test('exportação grava só o gbraid quando não há gclid', async () => {
  const { db, client } = await fresh();
  await seed(db, client, { gbraid: 'GB-1', wbraid: 'WB-1' });
  createExportFile(db, client, 'lead', NOW);
  const [row] = await exported(db);
  assert.deepEqual([row!.gclid, row!.gbraid, row!.wbraid], [null, 'GB-1', null]);
});

test('exportação grava o wbraid quando é o único identificador', async () => {
  const { db, client } = await fresh();
  await seed(db, client, { wbraid: 'WB-1' });
  createExportFile(db, client, 'lead', NOW);
  const [row] = await exported(db);
  assert.deepEqual([row!.gclid, row!.gbraid, row!.wbraid], [null, null, 'WB-1']);
});

test('gbraid de clique com mais de 90 dias fica fora do arquivo', async () => {
  const { db, client } = await fresh();
  await seed(db, client, { gbraid: 'GB-VELHO' }, { ageDays: 91 });
  const fresco = await seed(db, client, { gbraid: 'GB-NOVO' }, { ageDays: 89 });
  const file = createExportFile(db, client, 'lead', NOW);
  assert.equal(file?.linhas, 1);
  const rows = await exported(db);
  assert.deepEqual(rows.map((r) => [r.referenciaId, r.gbraid]), [[fresco.contact.id, 'GB-NOVO']]);
});

test('item sem identificador continua pendente', async () => {
  const { db, client } = await fresh();
  const semId = await seed(db, client, {}, { sale: true });
  assert.equal(createExportFile(db, client, 'lead', NOW), null);
  assert.equal(createExportFile(db, client, 'venda', NOW), null);
  assert.equal((await exported(db)).length, 0);
  const [contact] = await db.select().from(contacts);
  const [sale] = await db.select().from(sales);
  assert.equal(contact!.exportadaEm, null);
  assert.equal(sale!.exportadaEm, null);
  assert.equal(semId.sale!.id, sale!.id);
});

test('segundo gerar arquivo não repete itens', async () => {
  const { db, client } = await fresh();
  await seed(db, client, { gbraid: 'GB-1' }, { sale: true });
  assert.equal(createExportFile(db, client, 'venda', NOW)?.linhas, 1);
  assert.equal(createExportFile(db, client, 'venda', NOW + 1000), null);
  assert.equal((await exported(db)).length, 1);
});

async function exportsPage(ctx: Awaited<ReturnType<typeof setup>>) {
  const cookie = await login(ctx.app, 'admin', 'admin-pass-123');
  const res = await ctx.app.inject({ method: 'GET', url: `/admin/c/${ctx.client.id}/exportacoes`, headers: { cookie } });
  assert.equal(res.statusCode, 200);
  return { cookie, body: res.body };
}

function tiles(body: string): number[] {
  return [...body.matchAll(/<p class="tile-value">(\d+)<\/p>/g)].map((m) => Number(m[1]));
}

const NO_ID_NOTICE =
  /1 contato\(s\) de anúncio chegaram sem identificador de clique \(gclid, gbraid ou wbraid\)\. Eles aparecem no relatório, mas não entram no arquivo\./;

test('prontos conta gclid, gbraid e wbraid', async () => {
  const ctx = await setup();
  const now = Date.now();
  await seed(ctx.db, ctx.client, { gclid: 'G-1' }, { now, sale: true });
  await seed(ctx.db, ctx.client, { gbraid: 'GB-1' }, { now, sale: true });
  await seed(ctx.db, ctx.client, { wbraid: 'WB-1' }, { now, sale: true });
  assert.deepEqual(tiles((await exportsPage(ctx)).body), [3, 3], 'leads e vendas prontos');
});

test('gbraid antigo fica fora do arquivo e conta como fora do prazo', async () => {
  const ctx = await setup();
  const now = Date.now();
  await seed(ctx.db, ctx.client, { gbraid: 'GB-VELHO' }, { now, ageDays: 91 });
  const { cookie, body } = await exportsPage(ctx);
  assert.deepEqual(tiles(body), [0, 0]);
  assert.match(body, /1 com clique há mais de 90 dias \(o Ads recusa\)/);
  const gerar = await ctx.app.inject({ method: 'POST', url: `/admin/c/${ctx.client.id}/exportacoes`, ...form(cookie, { tipo: 'lead' }) });
  assert.match(gerar.headers.location as string, /ok=vazio/);
  assert.equal((await exported(ctx.db)).length, 0);

  // The limit itself: "no máximo 90 dias" includes day 90, "mais de 90 dias" starts 1 ms later.
  const { db, client } = await fresh();
  const noLimite = await seed(db, client, { gbraid: 'GB-90' }, { ageDays: 90 });
  await seed(db, client, { gbraid: 'GB-90-MAIS-1MS' }, { ageDays: 90, extraMs: 1 });
  assert.deepEqual(exportStats(db, client.id, NOW).lead, { prontos: 1, foraDoPrazo: 1 });
  assert.equal(createExportFile(db, client, 'lead', NOW)?.linhas, 1);
  assert.deepEqual((await exported(db)).map((r) => [r.referenciaId, r.gbraid]), [[noLimite.contact.id, 'GB-90']]);
});

test('aviso aparece para anúncio sem identificador', async () => {
  const ctx = await setup();
  const now = Date.now();
  await seed(ctx.db, ctx.client, { gbraid: 'GB-1' }, { now });
  await seed(ctx.db, ctx.client, {}, { now });
  assert.match((await exportsPage(ctx)).body, NO_ID_NOTICE);
});

test('aviso some quando todo anúncio tem identificador', async () => {
  const ctx = await setup();
  const now = Date.now();
  await seed(ctx.db, ctx.client, { gclid: 'G-1' }, { now });
  await seed(ctx.db, ctx.client, { gbraid: 'GB-1' }, { now });
  await seed(ctx.db, ctx.client, { wbraid: 'WB-1' }, { now });
  const { body } = await exportsPage(ctx);
  assert.doesNotMatch(body, /sem identificador de clique/);
  assert.doesNotMatch(body, /sem gclid/);
});

const NAMES = { lead: 'Lead WhatsApp', venda: 'Venda WhatsApp' };
const HEADER = 'Google Click ID,GBRAID,WBRAID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency';
// The click is 1 day before NOW and the first message 60 s later; America/Sao_Paulo is UTC-3.
const LEAD_TIME = '2026-10-30 12:01:00';

async function csvOf(db: Db, client: Client, tipo: 'lead' | 'venda'): Promise<string[]> {
  const file = createExportFile(db, client, tipo, NOW);
  assert.ok(file, 'arquivo gerado');
  const csv = await exportFileCsv(db, client, file.arquivo, NAMES);
  return csv!.trim().split('\r\n');
}

test('CSV põe o gclid só na coluna Google Click ID quando o clique tem os três', async () => {
  const { db, client } = await fresh();
  await seed(db, client, { gclid: 'G-1', gbraid: 'GB-1', wbraid: 'WB-1' });
  const lines = await csvOf(db, client, 'lead');
  assert.equal(lines[2], `G-1,,,Lead WhatsApp,${LEAD_TIME},,`);
});

test('CSV põe o gbraid só na coluna GBRAID quando não há gclid', async () => {
  const { db, client } = await fresh();
  await seed(db, client, { gbraid: 'GB-1', wbraid: 'WB-1' });
  const lines = await csvOf(db, client, 'lead');
  assert.equal(lines[2], `,GB-1,,Lead WhatsApp,${LEAD_TIME},,`);
});

test('CSV põe o wbraid só na coluna WBRAID quando é o único', async () => {
  const { db, client } = await fresh();
  await seed(db, client, { wbraid: 'WB-1' });
  const lines = await csvOf(db, client, 'lead');
  assert.equal(lines[2], `,,WB-1,Lead WhatsApp,${LEAD_TIME},,`);
});

test('cabeçalho do CSV tem as sete colunas na ordem', async () => {
  const { db, client } = await fresh();
  await seed(db, client, { gbraid: 'GB-1' }, { sale: true });
  const lines = await csvOf(db, client, 'venda');
  assert.equal(lines[0], 'Parameters:TimeZone=America/Sao_Paulo');
  assert.equal(lines[1], HEADER);
  assert.equal(lines.length, 3);
});

test('arquivo gerado antes da mudança baixa no layout novo', async () => {
  const { db, client } = await fresh();
  // A row as the old code wrote it: gclid only, no braid columns.
  await db.insert(exports).values({
    clientId: client.id,
    tipo: 'venda',
    referenciaId: 1,
    arquivo: 'venda-antigo.csv',
    gclid: 'GCLID-ANTIGO',
    conversaoEm: Date.UTC(2026, 9, 1, 15, 0, 0),
    valorCentavos: 15000,
    exportadoEm: Date.UTC(2026, 9, 2, 15, 0, 0),
  });
  const csv = await exportFileCsv(db, client, 'venda-antigo.csv', NAMES);
  assert.deepEqual(csv!.trim().split('\r\n').slice(1), [HEADER, 'GCLID-ANTIGO,,,Venda WhatsApp,2026-10-01 12:00:00,150.00,BRL']);
});

test('tipos diferentes no mesmo arquivo caem cada um na sua coluna', async () => {
  const { db, client } = await fresh();
  await seed(db, client, { gclid: 'G-1' }, { sale: true });
  await seed(db, client, { gbraid: 'GB-2' }, { sale: true });
  await seed(db, client, { wbraid: 'WB-3' }, { sale: true });
  const lines = await csvOf(db, client, 'lead');
  assert.deepEqual(lines.slice(2).sort(), [
    `,,WB-3,Lead WhatsApp,${LEAD_TIME},,`,
    `,GB-2,,Lead WhatsApp,${LEAD_TIME},,`,
    `G-1,,,Lead WhatsApp,${LEAD_TIME},,`,
  ].sort());
});

test('página explica a contagem Todas para gbraid e wbraid', async () => {
  const ctx = await setup();
  const { body } = await exportsPage(ctx);
  assert.match(
    body,
    /Conversões com gbraid ou wbraid exigem que a ação de conversão no Google Ads esteja com a contagem em “Todas”\./,
  );
});
