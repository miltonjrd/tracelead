import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { clients } from '../src/db/schema.js';
import { form, login, setup } from './helpers.js';

async function adminSetup(mode: 'baileys' | 'cloud', env: Record<string, string> = {}) {
  const ctx = await setup({ env });
  await ctx.db.update(clients).set({ whatsappMode: mode }).where(eq(clients.id, ctx.client.id));
  const admin = await login(ctx.app, 'admin', 'admin-pass-123');
  const store = await login(ctx.app, 'loja', 'loja-pass-123');
  const sistema = (cookie = admin) => ctx.app.inject({ method: 'GET', url: `/admin/c/${ctx.client.id}/sistema`, headers: { cookie } });
  return { ...ctx, admin, store, sistema };
}

test('painel e admin mostram conectado', async () => {
  const ctx = await adminSetup('baileys');
  await ctx.sessions.connect(ctx.client.id);
  ctx.fake.last().open('5511999990000:3@s.whatsapp.net');

  const panel = await ctx.app.inject({ method: 'GET', url: '/painel/whatsapp', headers: { cookie: ctx.store } });
  assert.match(panel.body, /Conectado/);
  assert.match(panel.body, /\(11\) 99999-0000/);

  const sys = await ctx.sistema();
  assert.equal(sys.statusCode, 200);
  assert.match(sys.body, /WhatsApp \(Baileys\)/);
  assert.match(sys.body, /Conectado/);
  assert.match(sys.body, /\(11\) 99999-0000/);
});

test('admin mostra cliente desconectado por logout', async () => {
  const ctx = await adminSetup('baileys');
  await ctx.sessions.connect(ctx.client.id);
  ctx.fake.last().open();
  ctx.fake.last().close(401);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const sys = await ctx.sistema();
  assert.match(sys.body, /Desconectado pelo celular/);
  assert.doesNotMatch(sys.body, />Conectado</);
});

test('admin desconecta o whatsapp do cliente', async () => {
  const ctx = await adminSetup('baileys');
  await ctx.sessions.connect(ctx.client.id);
  ctx.fake.last().open();
  const sock = ctx.fake.last();
  const url = `/admin/c/${ctx.client.id}/sistema/whatsapp/desconectar`;

  // a store user cannot use it
  const denied = await ctx.app.inject({ method: 'POST', url, ...form(ctx.store, {}) });
  assert.equal(denied.statusCode, 303);
  assert.equal(denied.headers.location, '/painel');
  assert.equal(ctx.sessions.status(ctx.client.id).state, 'conectado');

  const res = await ctx.app.inject({ method: 'POST', url, ...form(ctx.admin, {}) });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/admin/c/${ctx.client.id}/sistema?ok=whatsappDesconectado`);
  assert.equal(sock.loggedOut, true);
  assert.equal(ctx.sessions.status(ctx.client.id).state, 'desconectado');
  const followed = await ctx.app.inject({ method: 'GET', url: String(res.headers.location), headers: { cookie: ctx.admin } });
  assert.match(followed.body, /role="status">WhatsApp desconectado\./);
});

test('admin só cobra segredos da meta de cliente cloud', async () => {
  const baileys = await adminSetup('baileys', { META_APP_SECRET: '', META_VERIFY_TOKEN: '' });
  const b = (await baileys.sistema()).body;
  assert.doesNotMatch(b, /META_APP_SECRET/);
  assert.doesNotMatch(b, /META_VERIFY_TOKEN/);
  assert.doesNotMatch(b, /Phone number ID/);

  const cloud = await adminSetup('cloud', { META_APP_SECRET: '', META_VERIFY_TOKEN: '' });
  const c = (await cloud.sistema()).body;
  assert.match(c, /WhatsApp \(Cloud API\)/);
  assert.match(c, /META_APP_SECRET/);
  assert.match(c, /META_VERIFY_TOKEN/);
  assert.match(c, /Phone number ID/);
  assert.match(c, /faltando/);
});
