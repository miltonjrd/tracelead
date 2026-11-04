import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../src/db/client.js';
import { clicks, contacts, type Client } from '../src/db/schema.js';
import { createClient } from '../src/services/accounts.js';
import { CLICKS_WITHOUT_MESSAGES_MIN, connectionHealth, SILENCE_LIMIT_MS } from '../src/services/connectionHealth.js';
import type { SessionStatus } from '../src/services/whatsappSessions.js';

const H = 60 * 60 * 1000;
const now = Date.now();
const conectado: SessionStatus = { state: 'conectado', phone: '+5511999990000' };

async function setup() {
  const db = openDb(':memory:');
  const client = (await createClient(db, { name: 'Loja', whatsappMode: 'baileys' })) as Client;
  let n = 0;
  const addClicks = async (count: number, at: number) => {
    for (let i = 0; i < count; i++) await db.insert(clicks).values({ clientId: client.id, ref: `R${n++}`.padEnd(5, '2'), createdAt: at });
  };
  return { db, client, addClicks };
}

test('conta quieta sem cliques não gera alerta, mesmo com muitas horas de silêncio', async () => {
  const { db, client } = await setup();
  assert.deepEqual(await connectionHealth(db, client, conectado, now - 30 * H, now), []);
});

test('silêncio longo com cliques no período gera alerta', async () => {
  const { db, client, addClicks } = await setup();
  await addClicks(1, now - 2 * H);
  const r = await connectionHealth(db, client, conectado, now - SILENCE_LIMIT_MS - H, now);
  assert.deepEqual(r, [{ kind: 'silencio', hours: 13, clicks: 1 }]);
});

test('silêncio curto não gera alerta mesmo com cliques', async () => {
  const { db, client, addClicks } = await setup();
  await addClicks(3, now - H);
  assert.deepEqual(await connectionHealth(db, client, conectado, now - 2 * H, now), []);
});

test('muitos cliques em 24h e nenhuma mensagem gera alerta', async () => {
  const { db, client, addClicks } = await setup();
  await addClicks(CLICKS_WITHOUT_MESSAGES_MIN, now - 3 * H);
  assert.deepEqual(await connectionHealth(db, client, conectado, now - H, now), [{ kind: 'cliques', clicks: CLICKS_WITHOUT_MESSAGES_MIN }]);
});

test('poucos cliques sem mensagem não geram alerta', async () => {
  const { db, client, addClicks } = await setup();
  await addClicks(CLICKS_WITHOUT_MESSAGES_MIN - 1, now - 3 * H);
  assert.deepEqual(await connectionHealth(db, client, conectado, now - H, now), []);
});

test('cliques com mensagem recebida no período não geram alerta', async () => {
  const { db, client, addClicks } = await setup();
  await addClicks(CLICKS_WITHOUT_MESSAGES_MIN, now - 3 * H);
  await db.insert(contacts).values({ clientId: client.id, phone: '+5511988887777', origem: 'desconhecida', firstMessageAt: now - 2 * H, lastMessageAt: now - 2 * H, statusAt: now - 2 * H });
  assert.deepEqual(await connectionHealth(db, client, conectado, now - H, now), []);
});

test('os dois sinais aparecem juntos', async () => {
  const { db, client, addClicks } = await setup();
  await addClicks(CLICKS_WITHOUT_MESSAGES_MIN, now - 3 * H);
  const r = await connectionHealth(db, client, conectado, now - 14 * H, now);
  assert.deepEqual(r.map((x) => x.kind), ['silencio', 'cliques']);
});

test('só avalia sessão conectada em cliente baileys', async () => {
  const { db, client, addClicks } = await setup();
  await addClicks(CLICKS_WITHOUT_MESSAGES_MIN, now - 3 * H);
  assert.deepEqual(await connectionHealth(db, client, { state: 'desconectado' }, now - 20 * H, now), []);
  assert.deepEqual(await connectionHealth(db, { ...client, whatsappMode: 'cloud' }, conectado, now - 20 * H, now), []);
});

test('a tela do WhatsApp mostra o aviso só quando há motivo', async () => {
  const { client } = await setup();
  const { whatsappStatus } = await import('../src/views/whatsapp.js');
  const quiet = whatsappStatus(client, conectado).value;
  assert.equal(quiet.includes('Confira a conexão'), false);
  const warned = whatsappStatus(client, conectado, undefined, undefined, [
    { kind: 'silencio', hours: 13, clicks: 2 },
    { kind: 'cliques', clicks: 7 },
  ]).value;
  assert.match(warned, /Confira a conexão/);
  assert.match(warned, /há 13 h/);
  assert.match(warned, /7 cliques/);
});
