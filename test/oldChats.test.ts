import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proto, type WAMessage } from 'baileys';
import { openDb } from '../src/db/client.js';
import { contacts, knownChats } from '../src/db/schema.js';
import { createClient } from '../src/services/accounts.js';
import { processUpsert, recordHistoryChats } from '../src/services/baileysInbound.js';
import { createHistoryProbe, PROBE_TIMEOUT_MS, type HistoryProbe } from '../src/services/historyProbe.js';
import { WhatsAppSessions } from '../src/services/whatsappSessions.js';
import { FakeSock, FakeTimers, fakeFactory, settle, silentLog } from './fakeWhatsApp.js';

const PHONE = '5511988887777';
const JID = `${PHONE}@s.whatsapp.net`;
const now = Date.now();
const log = { info() {}, warn() {}, error() {} };
const ON_DEMAND = proto.HistorySync.HistorySyncType.ON_DEMAND;
const RECENT = proto.HistorySync.HistorySyncType.RECENT;

function msg(over: { jid?: string; id?: string; ts?: number; text?: string; fromMe?: boolean; stub?: number }): WAMessage {
  return {
    key: { remoteJid: over.jid ?? JID, fromMe: over.fromMe ?? false, id: over.id ?? 'M1' },
    pushName: 'Maria',
    messageTimestamp: Math.floor((over.ts ?? now) / 1000),
    ...(over.stub ? { messageStubType: over.stub } : { message: { conversation: over.text ?? 'oi' } }),
  } as WAMessage;
}

async function setup() {
  const db = openDb(':memory:');
  const client = await createClient(db, { name: 'Loja' });
  return { db, client };
}

const fixed = (v: Awaited<ReturnType<HistoryProbe>>) => {
  const calls: WAMessage[] = [];
  const probe: HistoryProbe = async (m) => (calls.push(m), v);
  return { probe, calls };
};

test('histórico do pareamento registra conversas 1:1, resolvendo LID, e ignora grupos', async () => {
  const { db, client } = await setup();
  const added = await recordHistoryChats(
    db,
    client.id,
    {
      chats: [
        { id: JID } as never,
        { id: '111@lid', pnJid: '5511911110000@s.whatsapp.net' } as never,
        { id: '222@lid' } as never,
        { id: '333@lid' } as never,
        { id: '120363000000000000@g.us' } as never,
      ],
      messages: [msg({ jid: '5511944440000@s.whatsapp.net', id: 'H1' }), msg({ jid: '5511955550000@s.whatsapp.net', id: 'H2', stub: 1 })],
      lidPnMappings: [{ lid: '222@lid', pn: '5511922220000@s.whatsapp.net' }],
    },
    async (lid) => (lid === '333@lid' ? '5511933330000@s.whatsapp.net' : null),
    now,
  );
  assert.equal(added, 5);
  const phones = (await db.select().from(knownChats)).map((r) => r.phone).sort();
  assert.deepEqual(phones, ['+5511911110000', '+5511922220000', '+5511933330000', '+5511944440000', `+${PHONE}`]);
});

test('conversa do histórico sem ref não vira contato e nem pergunta ao celular', async () => {
  const { db, client } = await setup();
  await recordHistoryChats(db, client.id, { chats: [{ id: JID } as never], messages: [] }, async () => null, now);
  const { probe, calls } = fixed('nova');
  await processUpsert(db, client, { type: 'notify', messages: [msg({ text: 'oi, tudo bem?' })] }, async () => null, log, now, probe);
  assert.equal((await db.select().from(contacts)).length, 0);
  assert.equal(calls.length, 0);
});

test('conversa antiga com ref de clique vira contato', async () => {
  const { db, client } = await setup();
  await recordHistoryChats(db, client.id, { chats: [{ id: JID } as never], messages: [] }, async () => null, now);
  const { probe, calls } = fixed('antiga');
  await processUpsert(db, client, { type: 'notify', messages: [msg({ text: 'Olá! (ref. AB2CD)' })] }, async () => null, log, now, probe);
  assert.equal((await db.select().from(contacts)).length, 1);
  assert.equal(calls.length, 0);
});

test('contato que já existe continua sendo atualizado mesmo estando no histórico', async () => {
  const { db, client } = await setup();
  await processUpsert(db, client, { type: 'notify', messages: [msg({ id: 'A', ts: now - 60_000 })] }, async () => null, log, now);
  await recordHistoryChats(db, client.id, { chats: [{ id: JID } as never], messages: [] }, async () => null, now);
  await processUpsert(db, client, { type: 'notify', messages: [msg({ id: 'B' })] }, async () => null, log, now);
  const [c] = await db.select().from(contacts);
  assert.equal(c?.lastMessageAt, now - (now % 1000));
});

test('celular diz que a conversa é antiga: sem contato, e a próxima mensagem não pergunta de novo', async () => {
  const { db, client } = await setup();
  const { probe, calls } = fixed('antiga');
  await processUpsert(db, client, { type: 'notify', messages: [msg({ id: 'A' }), msg({ id: 'B' })] }, async () => null, log, now, probe);
  await processUpsert(db, client, { type: 'notify', messages: [msg({ id: 'C' })] }, async () => null, log, now, probe);
  assert.equal((await db.select().from(contacts)).length, 0);
  assert.equal(calls.length, 1);
  const [k] = await db.select().from(knownChats);
  assert.equal(k?.source, 'consulta');
});

test('celular diz que é nova, ou não responde: contato criado', async () => {
  for (const v of ['nova', 'sem_resposta'] as const) {
    const { db, client } = await setup();
    const { probe, calls } = fixed(v);
    await processUpsert(db, client, { type: 'notify', messages: [msg({ id: 'A' }), msg({ id: 'B' })] }, async () => null, log, now, probe);
    assert.equal((await db.select().from(contacts)).length, 1, v);
    assert.equal(calls.length, 1, v);
    assert.equal((await db.select().from(knownChats)).length, 0, v);
  }
});

function probeSock() {
  const sock = new FakeSock({} as never);
  const asked: { count: number; id?: string | null; ts: number }[] = [];
  const timers = new FakeTimers();
  const probe = createHistoryProbe(
    {
      ev: sock.ev,
      fetchMessageHistory: async (count, key, ts) => {
        asked.push({ count, id: key.id, ts });
        return 'REQ';
      },
    },
    timers.schedule,
  );
  return { sock, asked, timers, probe };
}

test('sonda: mensagem anterior real na resposta = antiga; só o aviso de criptografia = nova', async () => {
  const { sock, asked, probe } = probeSock();
  const m = msg({ id: 'NOW' });
  const p1 = probe(m);
  await settle();
  assert.equal(asked[0]?.id, 'NOW');
  assert.equal(asked[0]?.ts, Number(m.messageTimestamp) * 1000);
  sock.emit('messaging-history.set', { syncType: ON_DEMAND, chats: [{ id: JID }], messages: [msg({ id: 'OLD', ts: now - 86_400_000, fromMe: true })] });
  assert.equal(await p1, 'antiga');

  const p2 = probe(msg({ id: 'NOW2' }));
  await settle();
  // a different chat's reply and a non-on-demand sync don't answer this one
  sock.emit('messaging-history.set', { syncType: ON_DEMAND, chats: [], messages: [msg({ jid: '5511900000000@s.whatsapp.net', id: 'X' })] });
  sock.emit('messaging-history.set', { syncType: RECENT, chats: [{ id: JID }], messages: [msg({ id: 'Y', ts: now - 1000 })] });
  sock.emit('messaging-history.set', { syncType: ON_DEMAND, chats: [{ id: JID }], messages: [msg({ id: 'E2E', ts: now - 1000, stub: 1 }), msg({ id: 'NOW2' })] });
  assert.equal(await p2, 'nova');
});

test('sonda: sem resposta até o limite = sem_resposta; erro ao pedir também', async () => {
  const { timers, probe } = probeSock();
  let verdict: string | undefined;
  void probe(msg({})).then((v) => (verdict = v));
  await timers.advance(PROBE_TIMEOUT_MS - 1);
  assert.equal(verdict, undefined);
  await timers.advance(1);
  assert.equal(verdict, 'sem_resposta');

  const sock = new FakeSock({} as never);
  const failing = createHistoryProbe({ ev: sock.ev, fetchMessageHistory: async () => Promise.reject(new Error('offline')) }, new FakeTimers().schedule);
  assert.equal(await failing(msg({})), 'sem_resposta');
});

test('sessão registra conversas do histórico e pergunta ao celular por número desconhecido', async () => {
  const db = openDb(':memory:');
  const client = await createClient(db, { name: 'Loja' });
  const fake = fakeFactory();
  const asked: string[] = [];
  const factory: typeof fake.factory = async (auth) => {
    const sock = await fake.factory(auth);
    sock.fetchMessageHistory = async (_count, key) => (asked.push(key.id!), 'REQ');
    return sock;
  };
  const timers = new FakeTimers();
  const sessions = new WhatsAppSessions(db, { maxSessions: 5, socketFactory: factory, log: silentLog(), schedule: timers.schedule });
  await sessions.connect(client.id);
  const sock = fake.last();
  sock.open();

  sock.emit('messaging-history.set', { syncType: RECENT, chats: [{ id: '5511977770000@s.whatsapp.net' }], messages: [] });
  await settle();
  assert.equal((await db.select().from(knownChats)).length, 1);
  sock.emit('messages.upsert', { type: 'notify', messages: [msg({ jid: '5511977770000@s.whatsapp.net', id: 'K' })] });
  await settle();
  assert.equal((await db.select().from(contacts)).length, 0);
  assert.deepEqual(asked, []);

  sock.emit('messages.upsert', { type: 'notify', messages: [msg({ id: 'U' })] });
  await settle();
  assert.deepEqual(asked, ['U']);
  sock.emit('messaging-history.set', { syncType: ON_DEMAND, chats: [{ id: JID }], messages: [] });
  await settle();
  assert.equal((await db.select().from(contacts)).length, 1);
});
