import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WAMessage } from 'baileys';
import { eq } from 'drizzle-orm';
import { openDb } from '../src/db/client.js';
import { clicks, contacts } from '../src/db/schema.js';
import { createClient } from '../src/services/accounts.js';
import { processUpsert } from '../src/services/baileysInbound.js';

const PHONE = '5511988887777';
const now = Date.now();

function makeLog() {
  const warns: { obj: Record<string, unknown>; msg: string }[] = [];
  return { warns, info: () => {}, warn: (obj: object, msg: string) => void warns.push({ obj: obj as Record<string, unknown>, msg }), error: () => {} };
}

function msg(over: { jid?: string; alt?: string; fromMe?: boolean; text?: string; name?: string; id?: string; ts?: number }): WAMessage {
  return {
    key: { remoteJid: over.jid ?? `${PHONE}@s.whatsapp.net`, remoteJidAlt: over.alt, fromMe: over.fromMe ?? false, id: over.id ?? 'M1' },
    pushName: over.name ?? 'Maria',
    messageTimestamp: Math.floor((over.ts ?? now) / 1000),
    message: { conversation: over.text ?? 'oi' },
  } as WAMessage;
}

async function setupClient() {
  const db = openDb(':memory:');
  const client = await createClient(db, { name: 'Loja' });
  return { db, client, log: makeLog(), noLid: async () => null };
}

test('mensagem baileys com ref liga ao clique', async () => {
  const { db, client, log, noLid } = await setupClient();
  await db.insert(clicks).values({ clientId: client.id, ref: 'AB2CD', gclid: 'G1', utmCampaign: 'Camp', createdAt: now - 60_000 });
  await processUpsert(db, client, { type: 'notify', messages: [msg({ text: 'Olá! (ref. AB2CD)' })] }, noLid, log, now);
  const c = (await db.query.contacts.findFirst({ where: eq(contacts.phone, `+${PHONE}`) }))!;
  assert.equal(c.origem, 'anuncio');
  assert.equal(c.name, 'Maria');
  assert.equal(c.campanha, 'Camp');
  assert.ok(c.clickId);
});

test('mensagem baileys sem ref cria contato sem clique', async () => {
  const { db, client, log, noLid } = await setupClient();
  await processUpsert(db, client, { type: 'notify', messages: [msg({ text: 'quanto custa?' })] }, noLid, log, now);
  const c = (await db.query.contacts.findFirst({ where: eq(contacts.phone, `+${PHONE}`) }))!;
  assert.equal(c.origem, 'desconhecida');
  assert.equal(c.clickId, null);
});

test('texto da mensagem baileys não é guardado', async () => {
  const { db, client, log, noLid } = await setupClient();
  const secret = 'segredo-da-conversa-12345';
  await processUpsert(db, client, { type: 'notify', messages: [msg({ text: `${secret} (ref. AB2CD)` })] }, noLid, log, now);
  const tables = db.$client.prepare("select name from sqlite_master where type='table'").all() as { name: string }[];
  for (const { name } of tables) {
    const dump = JSON.stringify(db.$client.prepare(`select * from "${name}"`).all());
    assert.ok(!dump.includes(secret), `texto apareceu em ${name}`);
  }
});

test('ignora grupo, status e mensagem da própria loja', async () => {
  const { db, client, log, noLid } = await setupClient();
  await processUpsert(
    db,
    client,
    {
      type: 'notify',
      messages: [
        msg({ jid: '120363000000000000@g.us', id: 'G' }),
        msg({ jid: 'status@broadcast', id: 'S' }),
        msg({ jid: '5511900000000@broadcast', id: 'B' }),
        msg({ jid: '120363111111111111@newsletter', id: 'N' }),
        msg({ fromMe: true, id: 'F' }),
      ],
    },
    noLid,
    log,
    now,
  );
  assert.equal((await db.select().from(contacts)).length, 0);
});

test('append: ignora histórico antigo e aceita o que chegou nas últimas 24h', async () => {
  const { db, client, log, noLid } = await setupClient();
  const old = msg({ id: 'OLD', ts: now - 25 * 60 * 60 * 1000 });
  await processUpsert(db, client, { type: 'append', messages: [old] }, noLid, log, now);
  assert.equal((await db.select().from(contacts)).length, 0);

  const recent = msg({ id: 'NEW', ts: now - 3 * 60 * 60 * 1000 });
  await processUpsert(db, client, { type: 'append', messages: [recent] }, noLid, log, now);
  const [c] = await db.select().from(contacts);
  assert.equal(c?.phone, `+${PHONE}`);
  assert.equal(c?.firstMessageAt, now - 3 * 60 * 60 * 1000 - ((now - 3 * 60 * 60 * 1000) % 1000));
});

test('notify: mensagem de 2 anos atrás (conversa reentregue pelo WhatsApp) não vira contato, nem com ref', async () => {
  const { db, client, log, noLid } = await setupClient();
  const twoYears = now - 730 * 24 * 60 * 60 * 1000;
  await processUpsert(db, client, { type: 'notify', messages: [msg({ id: 'O1', ts: twoYears }), msg({ id: 'O2', ts: twoYears, text: 'Olá! (ref. AB2CD)' })] }, noLid, log, now);
  assert.equal((await db.select().from(contacts)).length, 0);

  await processUpsert(db, client, { type: 'notify', messages: [msg({ id: 'N1', ts: now - 2 * 24 * 60 * 60 * 1000 })] }, noLid, log, now);
  assert.equal((await db.select().from(contacts)).length, 1);
});

test('append: mensagem enviada por nós e mensagem sem data não viram contato', async () => {
  const { db, client, log, noLid } = await setupClient();
  const noDate = { ...msg({ id: 'ND' }), messageTimestamp: undefined } as WAMessage;
  await processUpsert(db, client, { type: 'append', messages: [msg({ id: 'ME', fromMe: true }), noDate] }, noLid, log, now);
  assert.equal((await db.select().from(contacts)).length, 0);
});

test('mensagem repetida gera um contato só', async () => {
  const { db, client, log, noLid } = await setupClient();
  const m = msg({});
  await processUpsert(db, client, { type: 'notify', messages: [m] }, noLid, log, now);
  await processUpsert(db, client, { type: 'notify', messages: [m, m] }, noLid, log, now);
  assert.equal((await db.select().from(contacts)).length, 1);
});

test('lid sem telefone é ignorado e lid resolvido é aceito', async () => {
  const { db, client, log } = await setupClient();
  const lid = '99887766554433@lid';

  await processUpsert(db, client, { type: 'notify', messages: [msg({ jid: lid, id: 'L1' })] }, async () => null, log, now);
  assert.equal((await db.select().from(contacts)).length, 0);
  assert.equal(log.warns.length, 1);
  assert.equal(log.warns[0]!.obj.reason, 'lid-sem-telefone');

  // remoteJidAlt wins over the lookup: the lookup would answer another phone and must not even be asked
  let asked = 0;
  const otherPhone = async () => {
    asked++;
    return '5511900009999@s.whatsapp.net';
  };
  await processUpsert(db, client, { type: 'notify', messages: [msg({ jid: lid, alt: '5511911112222@s.whatsapp.net', id: 'L2' })] }, otherPhone, log, now);
  assert.ok(await db.query.contacts.findFirst({ where: eq(contacts.phone, '+5511911112222') }));
  assert.equal(await db.query.contacts.findFirst({ where: eq(contacts.phone, '+5511900009999') }), undefined);
  assert.equal(asked, 0);

  await processUpsert(db, client, { type: 'notify', messages: [msg({ jid: lid, id: 'L3' })] }, async (l) => (l === lid ? '5511933334444@s.whatsapp.net' : null), log, now);
  assert.ok(await db.query.contacts.findFirst({ where: eq(contacts.phone, '+5511933334444') }));
  assert.equal((await db.select().from(contacts)).length, 2);
});
