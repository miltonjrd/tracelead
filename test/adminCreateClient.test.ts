import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clients, users } from '../src/db/schema.js';
import { form, login, setup } from './helpers.js';

test('admin cria cliente com login pelo painel', async () => {
  const ctx = await setup();
  const admin = await login(ctx.app, 'admin', 'admin-pass-123');
  const store = await login(ctx.app, 'loja', 'loja-pass-123');

  const get = await ctx.app.inject({ method: 'GET', url: '/admin/novo', headers: { cookie: admin } });
  assert.equal(get.statusCode, 200);
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/admin/novo', headers: { cookie: store } })).statusCode === 200, false);

  const res = await ctx.app.inject({
    method: 'POST',
    url: '/admin/novo',
    ...form(admin, { name: 'Padaria Nova', timezone: 'America/Sao_Paulo', adsCustomerId: '111-222-3333', whatsappMode: 'baileys', username: 'Padaria' }),
  });
  assert.equal(res.statusCode, 200);
  const [created] = (await ctx.db.select().from(clients)).filter((c) => c.name === 'Padaria Nova');
  assert.ok(created);
  assert.equal(created.googleAdsCustomerId, '1112223333');
  assert.ok(res.body.includes(created.publicKey) && res.body.includes("/t.js"));
  const user = (await ctx.db.select().from(users)).find((u) => u.username === 'padaria');
  assert.equal(user?.role, 'client');
  assert.equal(user?.clientId, created.id);
  const password = /<code>([^<]+)<\/code>/.exec(res.body)![1]!;
  assert.ok(await login(ctx.app, 'padaria', password));
});

test('admin: nome vazio, usuário repetido e fuso inválido voltam ao formulário', async () => {
  const ctx = await setup();
  const admin = await login(ctx.app, 'admin', 'admin-pass-123');
  const before = (await ctx.db.select().from(clients)).length;
  for (const data of [{ name: '' }, { name: 'X', username: 'loja' }, { name: 'X', timezone: 'Marte/Olimpo' }]) {
    const res = await ctx.app.inject({ method: 'POST', url: '/admin/novo', ...form(admin, data) });
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.includes('flash-erro'));
  }
  assert.equal((await ctx.db.select().from(clients)).length, before);
});

test('cliente criado pelo admin é obrigado a trocar a senha no primeiro acesso', async () => {
  const ctx = await setup();
  const admin = await login(ctx.app, 'admin', 'admin-pass-123');
  const res = await ctx.app.inject({ method: 'POST', url: '/admin/novo', ...form(admin, { name: 'Nova Loja', username: 'nova' }) });
  const temp = /<code>([^<]+)<\/code>/.exec(res.body)![1]!;
  const cookie = await login(ctx.app, 'nova', temp);

  const blocked = await ctx.app.inject({ method: 'GET', url: '/painel', headers: { cookie } });
  assert.equal(blocked.statusCode, 303);
  assert.equal(blocked.headers.location, '/senha');
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/senha', headers: { cookie } })).statusCode, 200);

  const bad = [
    { current: 'errada-123', next: 'senha-nova-123', confirm: 'senha-nova-123' },
    { current: temp, next: 'curta', confirm: 'curta' },
    { current: temp, next: 'senha-nova-123', confirm: 'outra-coisa-1' },
    { current: temp, next: temp, confirm: temp },
  ];
  for (const data of bad) {
    const r = await ctx.app.inject({ method: 'POST', url: '/senha', ...form(cookie, data) });
    assert.equal(r.statusCode, 400);
  }
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/painel', headers: { cookie } })).statusCode, 303);

  const ok = await ctx.app.inject({ method: 'POST', url: '/senha', ...form(cookie, { current: temp, next: 'senha-nova-123', confirm: 'senha-nova-123' }) });
  assert.equal(ok.statusCode, 303);
  assert.equal(ok.headers.location, '/painel');
  assert.notEqual((await ctx.app.inject({ method: 'GET', url: '/painel', headers: { cookie } })).headers.location, '/senha');
  await login(ctx.app, 'nova', 'senha-nova-123');
  const old = await ctx.app.inject({ method: 'POST', url: '/login', ...form('', { username: 'nova', password: temp }) });
  assert.equal(old.statusCode, 401);
});

test('login de cliente novo cai direto na troca de senha', async () => {
  const ctx = await setup();
  const admin = await login(ctx.app, 'admin', 'admin-pass-123');
  const res = await ctx.app.inject({ method: 'POST', url: '/admin/novo', ...form(admin, { name: 'Loja Z', username: 'lojaz' }) });
  const temp = /<code>([^<]+)<\/code>/.exec(res.body)![1]!;
  const r = await ctx.app.inject({ method: 'POST', url: '/login', ...form('', { username: 'lojaz', password: temp }) });
  assert.equal(r.statusCode, 303);
  assert.equal(r.headers.location, '/senha');
});

test('admin desativa e reativa cliente', async () => {
  const ctx = await setup();
  const admin = await login(ctx.app, 'admin', 'admin-pass-123');
  const store = await login(ctx.app, 'loja', 'loja-pass-123');
  const id = ctx.client.id;
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/painel', headers: { cookie: store } })).statusCode, 200);

  const off = await ctx.app.inject({ method: 'POST', url: `/admin/c/${id}/desativar`, ...form(admin, {}) });
  assert.equal(off.statusCode, 303);
  const after = await ctx.app.inject({ method: 'GET', url: '/painel', headers: { cookie: store } });
  assert.equal(after.statusCode, 303);
  assert.equal(after.headers.location, '/login');
  const denied = await ctx.app.inject({ method: 'POST', url: '/login', ...form('', { username: 'loja', password: 'loja-pass-123' }) });
  assert.equal(denied.statusCode, 401);
  const click = await ctx.app.inject({
    method: 'POST',
    url: '/click',
    payload: JSON.stringify({ k: ctx.client.publicKey, ref: 'ABC23' }),
    headers: { 'content-type': 'text/plain' },
  });
  assert.equal(click.statusCode, 404);
  const list = await ctx.app.inject({ method: 'GET', url: '/admin?todos=1', headers: { cookie: admin } });
  assert.ok(list.body.includes('Desativado'));

  await ctx.app.inject({ method: 'POST', url: `/admin/c/${id}/ativar`, ...form(admin, {}) });
  assert.ok(await login(ctx.app, 'loja', 'loja-pass-123'));
});
