import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { openDb } from '../src/db/client.js';
import { clients, contacts, whatsappAuth } from '../src/db/schema.js';
import { createClient } from '../src/services/accounts.js';
import { CONNECTING_MAX_MS, QR_TIMEOUT_MS, SILENT_SOCKET_MAX_MS, SessionLimitError, WhatsAppSessions } from '../src/services/whatsappSessions.js';
import { loadAuthState } from '../src/services/whatsappAuthState.js';
import { FakeTimers, fakeFactory, settle, silentLog } from './fakeWhatsApp.js';

async function setup(opts: { max?: number; failFor?: () => boolean } = {}) {
  const db = openDb(':memory:');
  const fake = fakeFactory({ failFor: opts.failFor });
  const timers = new FakeTimers();
  const log = silentLog();
  const sessions = new WhatsAppSessions(db, { maxSessions: opts.max ?? 5, socketFactory: fake.factory, log, schedule: timers.schedule });
  const client = await createClient(db, { name: 'Loja 1' });
  return { db, fake, timers, log, sessions, client };
}

/** Marks the client as already linked the way a QR pairing does: `me` set, `registered` still false. */
async function saveRegistered(db: ReturnType<typeof openDb>, clientId: number) {
  const a = await loadAuthState(db, clientId);
  a.state.creds.me = { id: '5511999990000:3@s.whatsapp.net', name: 'Loja' };
  await a.saveCreds();
}

test('sessão aberta mostra conectado e o número', async () => {
  const { sessions, fake, client } = await setup();
  await sessions.connect(client.id);
  assert.deepEqual(sessions.status(client.id), { state: 'conectando' });
  fake.last().qr('QR-1');
  assert.deepEqual(sessions.status(client.id), { state: 'aguardando_qr', qr: 'QR-1' });
  fake.last().open('5511999990000:3@s.whatsapp.net');
  assert.deepEqual(sessions.status(client.id), { state: 'conectado', phone: '+5511999990000' });
});

test('qr novo substitui o anterior', async () => {
  const { sessions, fake, client } = await setup();
  await sessions.connect(client.id);
  fake.last().qr('QR-1');
  fake.last().qr('QR-2');
  assert.deepEqual(sessions.status(client.id), { state: 'aguardando_qr', qr: 'QR-2' });
});

test('depois do scan o close 515 reabre com o login salvo', async () => {
  const { sessions, fake, client, db } = await setup();
  await sessions.connect(client.id);
  fake.last().qr('QR-1');
  fake.last().auth.creds.registered = true;
  fake.last().emit('creds.update', {});
  fake.last().close(515);
  await settle();
  assert.equal(fake.socks.length, 2);
  assert.equal(fake.socks[1]!.auth.creds.registered, true);
  fake.last().open();
  assert.equal(sessions.status(client.id).state, 'conectado');
  assert.ok(await db.query.whatsappAuth.findFirst({ where: eq(whatsappAuth.key, 'creds') }));
});

test('desconectar apaga o login e mostra desconectado', async () => {
  const { sessions, fake, client, db } = await setup();
  await sessions.connect(client.id);
  fake.last().open();
  fake.last().emit('creds.update', {});
  await settle();
  assert.ok((await db.select().from(whatsappAuth)).length > 0);

  const sock = fake.last();
  await sessions.disconnect(client.id);
  assert.equal(sock.loggedOut, true);
  assert.equal(sock.ended, true);
  assert.deepEqual(sessions.status(client.id), { state: 'desconectado' });
  assert.equal((await db.select().from(whatsappAuth).where(eq(whatsappAuth.clientId, client.id))).length, 0);
});

test('sexta conexão é recusada pelo limite', async () => {
  const { sessions, db, client } = await setup({ max: 5 });
  const ids = [client.id];
  for (let i = 2; i <= 6; i++) ids.push((await createClient(db, { name: `Loja ${i}` })).id);
  for (const id of ids.slice(0, 5)) await sessions.connect(id);
  await assert.rejects(() => sessions.connect(ids[5]!), (e) => e instanceof SessionLimitError && e.message === 'Limite de conexões atingido');
  assert.equal(sessions.status(ids[5]!).state, 'desconectado');
  // a client that already has a session is not refused
  await sessions.connect(ids[0]!);
});

test('reinício reabre a sessão salva sem qr', async () => {
  const { sessions, fake, client, db } = await setup();
  await saveRegistered(db, client.id);
  const other = await createClient(db, { name: 'Nunca conectou' });
  await sessions.startAll();
  assert.equal(fake.socks.length, 1, 'só quem tem login salvo reabre');
  assert.ok(fake.last().auth.creds.me);
  fake.last().open();
  assert.equal(sessions.status(client.id).state, 'conectado');
  assert.equal(sessions.status(other.id).state, 'desconectado');
});

test('queda de rede reconecta com espera crescente até 60 s', async () => {
  const { sessions, fake, timers, client } = await setup();
  await sessions.connect(client.id);
  fake.last().open();

  for (let i = 0; i < 9; i++) {
    fake.last().close(408);
    await settle();
    assert.equal(sessions.status(client.id).state, 'reconectando');
    await timers.advance(60_000);
  }
  assert.deepEqual(timers.delays.filter((d) => d !== 45_000), [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);

  fake.last().open();
  assert.equal(sessions.status(client.id).state, 'conectado');
  fake.last().close(408);
  await settle();
  assert.equal(timers.delays.at(-1), 1000, 'espera volta a 1 s depois de conectar');
});

test('logout pelo celular apaga o login e não reconecta', async () => {
  const { sessions, fake, timers, client, db } = await setup();
  await saveRegistered(db, client.id);
  await sessions.startAll();
  fake.last().open();
  fake.last().close(401);
  await settle();
  assert.deepEqual(sessions.status(client.id), { state: 'desconectado_logout' });
  assert.equal((await db.select().from(whatsappAuth)).length, 0);
  await timers.advance(120_000);
  assert.equal(fake.socks.length, 1, 'nenhum socket novo');
});

test('falha ao reabrir um cliente não derruba os outros', async () => {
  let n = 0;
  const { sessions, fake, client, db, log } = await setup({ failFor: () => ++n === 1 });
  const second = await createClient(db, { name: 'Loja 2' });
  await saveRegistered(db, client.id);
  await saveRegistered(db, second.id);
  await sessions.startAll();
  fake.last().open();
  assert.equal(sessions.status(client.id).state, 'reconectando');
  assert.equal(sessions.status(second.id).state, 'conectado');
  assert.equal(log.errors.length, 1);
});

test('qr não escaneado em 2 minutos expira', async () => {
  const { sessions, fake, timers, client } = await setup();
  await sessions.connect(client.id);
  fake.last().qr('QR-1');
  await timers.advance(QR_TIMEOUT_MS - 1);
  assert.equal(sessions.status(client.id).state, 'aguardando_qr');
  await timers.advance(1);
  assert.deepEqual(sessions.status(client.id), { state: 'qr_expirado' });
  assert.equal(fake.last().ended, true);

  await sessions.connect(client.id);
  assert.equal(fake.socks.length, 2, '"Gerar novo QR" abre um socket novo');
  fake.last().qr('QR-2');
  assert.deepEqual(sessions.status(client.id), { state: 'aguardando_qr', qr: 'QR-2' });
});

test('duas conexões da mesma loja usam um socket', async () => {
  const { sessions, fake, client } = await setup();
  await Promise.all([sessions.connect(client.id), sessions.connect(client.id)]);
  await sessions.connect(client.id);
  assert.equal(fake.socks.length, 1);
});

test('login salvo corrompido pede qr novo', async () => {
  const { sessions, fake, client, db } = await setup();
  await db.insert(whatsappAuth).values({ clientId: client.id, key: 'creds', value: '{quebrado', updatedAt: 1 });
  await sessions.connect(client.id);
  assert.equal(fake.last().auth.creds.registered, false);
  fake.last().qr('QR-1');
  assert.equal(sessions.status(client.id).state, 'aguardando_qr');
  assert.equal((await db.select().from(whatsappAuth)).length, 0);
});

test('mensagem recebida na sessão vira contato e reconcile fecha cliente que saiu do modo baileys', async () => {
  const { sessions, fake, client, db } = await setup();
  await sessions.connect(client.id);
  fake.last().open();
  fake.last().emit('messages.upsert', {
    type: 'notify',
    messages: [{ key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false, id: 'A' }, pushName: 'Ana', messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: 'oi' } }],
  });
  await settle();
  assert.equal((await db.select().from(contacts)).length, 1);

  await db.update(clients).set({ whatsappMode: 'cloud' }).where(eq(clients.id, client.id));
  const sock = fake.last();
  await sessions.reconcile();
  assert.equal(sock.loggedOut, true);
  assert.deepEqual(sessions.status(client.id), { state: 'desconectado' });
});

test('close 500 mantém o login e reconecta com espera', async () => {
  const { sessions, fake, timers, client, db } = await setup();
  await saveRegistered(db, client.id);
  await sessions.startAll();
  fake.last().open();
  fake.last().close(500);
  await settle();
  assert.deepEqual(sessions.status(client.id), { state: 'reconectando', attempt: 1 });
  assert.equal((await db.select().from(whatsappAuth).where(eq(whatsappAuth.clientId, client.id))).length > 0, true);
  await timers.advance(1000);
  assert.equal(fake.socks.length, 2);
  assert.ok(fake.last().auth.creds.me);
});

test('close 440 (login aberto em outro lugar) não reconecta e mantém o login', async () => {
  const { sessions, fake, timers, client, db, log } = await setup();
  await saveRegistered(db, client.id);
  await sessions.startAll();
  fake.last().open();
  fake.last().close(440);
  await settle();
  assert.deepEqual(sessions.status(client.id), { state: 'substituida' });
  await timers.advance(10 * 60_000);
  assert.equal(fake.socks.length, 1, 'não tenta de novo');
  assert.equal((await db.select().from(whatsappAuth).where(eq(whatsappAuth.clientId, client.id))).length > 0, true);
  assert.equal(log.warns.length, 1);
  // the person can take the login back
  await sessions.connect(client.id);
  assert.equal(fake.socks.length, 2);
});

test('registra abertura e fechamento com o código e o tempo de silêncio', async () => {
  const { sessions, fake, client, db, log } = await setup();
  await saveRegistered(db, client.id);
  await sessions.startAll();
  assert.equal(sessions.lastEventAt(client.id), undefined);
  fake.last().open();
  assert.ok(sessions.lastEventAt(client.id));
  fake.last().close(500);
  await settle();
  const closed = log.infos.find((o) => (o as { code?: number }).code === 500) as Record<string, unknown>;
  assert.ok(closed, 'fechamento registrado com o código');
  assert.equal(typeof closed.openForSec, 'number');
  assert.equal(typeof closed.silentForSec, 'number');
  assert.equal(JSON.stringify(log.infos).includes('5511'), false, 'sem número de telefone no log');
});

test('reinício acima do limite reabre só até o limite', async () => {
  const { sessions, fake, client, db, log } = await setup({ max: 1 });
  const second = await createClient(db, { name: 'Loja 2' });
  await saveRegistered(db, client.id);
  await saveRegistered(db, second.id);
  await sessions.startAll();
  assert.equal(fake.socks.length, 1);
  assert.equal(sessions.status(client.id).state, 'conectando');
  assert.equal(sessions.status(second.id).state, 'desconectado');
  assert.equal(log.warns.length, 1);
});

test('watchdog reabre sessão conectada que ficou muda por horas', async () => {
  const { sessions, fake, client } = await setup();
  await sessions.connect(client.id);
  fake.last().open();
  const first = fake.last();
  const t0 = Date.now();
  await sessions.watchdog(t0 + SILENT_SOCKET_MAX_MS - 1000);
  assert.equal(fake.socks.length, 1);
  await sessions.watchdog(t0 + SILENT_SOCKET_MAX_MS + 1000);
  assert.equal(first.ended, true);
  assert.equal(fake.socks.length, 2);
  fake.last().open();
  assert.equal(sessions.status(client.id).state, 'conectado');
});

test('watchdog não mexe em sessão que recebeu mensagem recentemente', async () => {
  const { sessions, fake, client } = await setup();
  await sessions.connect(client.id);
  fake.last().open();
  fake.last().emit('messages.upsert', { messages: [], type: 'notify' });
  await sessions.watchdog(Date.now() + SILENT_SOCKET_MAX_MS - 60_000);
  assert.equal(fake.socks.length, 1);
});

test('watchdog reabre conexão travada em conectando', async () => {
  const { sessions, fake, client } = await setup();
  await sessions.connect(client.id);
  await sessions.watchdog(Date.now() + CONNECTING_MAX_MS + 1000);
  assert.equal(fake.socks.length, 2);
  assert.equal(fake.socks[0]!.ended, true);
});

test('avisa quando os pendentes não chegam em 45s e não avisa quando chegam', async () => {
  const { sessions, fake, client, log, timers } = await setup();
  await sessions.connect(client.id);
  fake.last().open();
  await timers.advance(46_000);
  assert.equal(log.warns.length, 1);

  fake.last().close(500);
  await settle();
  await timers.advance(2000);
  fake.last().open();
  fake.last().emit('connection.update', { receivedPendingNotifications: true });
  await timers.advance(46_000);
  assert.equal(log.warns.length, 1);
});
