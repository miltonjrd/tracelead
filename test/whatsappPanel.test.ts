import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { clients, whatsappAuth } from '../src/db/schema.js';
import { createClient, createUser } from '../src/services/accounts.js';
import { form, login, setup } from './helpers.js';

const HX = { 'hx-request': 'true' };

async function baileysSetup(env: Record<string, string> = {}) {
  const ctx = await setup({ env });
  await ctx.db.update(clients).set({ whatsappMode: 'baileys' }).where(eq(clients.id, ctx.client.id));
  const cookie = await login(ctx.app, 'loja', 'loja-pass-123');
  const get = (url: string) => ctx.app.inject({ method: 'GET', url, headers: { cookie } });
  const post = (url: string) => ctx.app.inject({ method: 'POST', url, ...form(cookie, {}, HX) });
  return { ...ctx, cookie, get, post };
}

test('painel mostra o qr code de um cliente baileys', async () => {
  const { get, post, fake } = await baileysSetup();

  const page = await get('/painel/whatsapp');
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Conectar WhatsApp/);
  assert.doesNotMatch(page.body, /<svg/);

  const click = await post('/painel/whatsapp/conectar');
  assert.equal(click.statusCode, 200);
  assert.match(click.body, /Conectando/);
  assert.equal(fake.socks.length, 1);

  fake.last().qr('QR-1');
  const poll = await get('/painel/whatsapp/estado');
  assert.match(poll.body, /<div class="qr"[^>]*><svg/);
  assert.match(poll.body, /Aparelhos conectados/);
});

test('painel conecta e desconecta pela tela', async () => {
  const { get, post, fake, db, client } = await baileysSetup();
  await post('/painel/whatsapp/conectar');
  fake.last().qr('QR-1');
  fake.last().open('5511999990000:3@s.whatsapp.net');
  fake.last().emit('creds.update', {});

  const ok = await get('/painel/whatsapp/estado');
  assert.match(ok.body, /Conectado/);
  assert.match(ok.body, /\(11\) 99999-0000/);
  assert.doesNotMatch(ok.body, /<svg/);

  const sock = fake.last();
  const off = await post('/painel/whatsapp/desconectar');
  assert.match(off.body, /Desconectado/);
  assert.equal(sock.loggedOut, true);
  assert.equal((await db.select().from(whatsappAuth).where(eq(whatsappAuth.clientId, client.id))).length, 0);
});

test('painel sem javascript volta para a tela depois de conectar', async () => {
  const { cookie, app, fake } = await baileysSetup();
  const res = await app.inject({ method: 'POST', url: '/painel/whatsapp/conectar', ...form(cookie, {}) });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/painel/whatsapp');
  assert.equal(fake.socks.length, 1);
});

test('painel mostra o limite de conexões', async () => {
  const ctx = await baileysSetup({ BAILEYS_MAX_SESSIONS: '1' });
  const other = await createClient(ctx.db, { name: 'Outra Loja' });
  await createUser(ctx.db, { username: 'loja2', password: 'loja2-pass-123', role: 'client', clientId: other.id });
  const cookie2 = await login(ctx.app, 'loja2', 'loja2-pass-123');

  await ctx.post('/painel/whatsapp/conectar');
  const res = await ctx.app.inject({ method: 'POST', url: '/painel/whatsapp/conectar', ...form(cookie2, {}, HX) });
  assert.match(res.body, /role="alert">Limite de conexões atingido/);
  assert.equal(ctx.fake.socks.length, 1);
});

test('loja não acessa a conexão de outro cliente', async () => {
  const ctx = await baileysSetup();
  const other = await createClient(ctx.db, { name: 'Outra Loja' });
  await ctx.sessions.connect(other.id);
  ctx.fake.last().qr('QR-DA-OUTRA');
  assert.equal(ctx.sessions.status(other.id).state, 'aguardando_qr');

  // the panel always serves the logged-in store's own client
  const own = await ctx.get('/painel/whatsapp');
  assert.doesNotMatch(own.body, /<svg/);
  assert.match(own.body, /Conectar WhatsApp/);

  // the admin area of another client sends a store user back to the panel, with no QR
  const admin = await ctx.get(`/admin/c/${other.id}/sistema`);
  assert.equal(admin.statusCode, 303);
  assert.equal(admin.headers.location, '/painel');
  assert.doesNotMatch(admin.body, /<svg/);

  // a logged-out visitor gets no QR either
  const anon = await ctx.app.inject({ method: 'GET', url: '/painel/whatsapp/estado' });
  assert.equal(anon.statusCode, 303);
  assert.doesNotMatch(anon.body, /<svg/);
});

test('painel de cliente cloud não abre sessão', async () => {
  const ctx = await baileysSetup();
  await ctx.db.update(clients).set({ whatsappMode: 'cloud' }).where(eq(clients.id, ctx.client.id));
  const res = await ctx.post('/painel/whatsapp/conectar');
  assert.match(res.body, /Cloud API da Meta/);
  assert.equal(ctx.fake.socks.length, 0);
});
