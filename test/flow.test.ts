import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { clicks, clients, contacts, sales } from '../src/db/schema.js';
import { fromLocal, localDate } from '../src/lib/time.js';
import { handleInboundMessage } from '../src/services/tracking.js';
import { form, login, postWebhook, setup, waPayload } from './helpers.js';

const LEAD_PHONE = '5511988887777';

async function clickAndMessage(ctx: Awaited<ReturnType<typeof setup>>, ref = 'AB2CD') {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/click',
    headers: { 'content-type': 'text/plain;charset=UTF-8', 'user-agent': 'test' },
    payload: JSON.stringify({ k: ctx.client.publicKey, ref, gclid: 'GCLID-1', utm_campaign: 'Campanha X', landing_url: 'https://loja.com/?gclid=GCLID-1' }),
  });
  assert.equal(res.statusCode, 204);
  const hook = await postWebhook(ctx.app, waPayload([{ from: LEAD_PHONE, name: 'Maria', text: `Olá! Gostaria de um orçamento. (ref. ${ref})` }]));
  assert.equal(hook.statusCode, 200);
  return (await ctx.db.query.contacts.findFirst({ where: eq(contacts.phone, `+${LEAD_PHONE}`) }))!;
}

test('clique + mensagem com ref viram um contato de anúncio', async () => {
  const ctx = await setup();
  const contact = await clickAndMessage(ctx);
  assert.equal(contact.origem, 'anuncio');
  assert.equal(contact.name, 'Maria');
  assert.equal(contact.campanha, 'Campanha X');
  const click = await ctx.db.query.clicks.findFirst({ where: eq(clicks.id, contact.clickId!) });
  assert.equal(click?.gclid, 'GCLID-1');
  assert.equal(click?.ipHash?.length, 32, 'IP guardado só como hash');

  await postWebhook(ctx.app, waPayload([{ from: '5511977776666', text: 'oi, quanto custa?' }]));
  const semRef = await ctx.db.query.contacts.findFirst({ where: eq(contacts.phone, '+5511977776666') });
  assert.equal(semRef?.origem, 'desconhecida');
  assert.equal(semRef?.clickId, null);
});

test('rastreio rejeita entrada ruim', async () => {
  const { app } = await setup();
  const post = (payload: string) => app.inject({ method: 'POST', url: '/click', headers: { 'content-type': 'text/plain' }, payload });
  assert.equal((await post('{nao-json')).statusCode, 400);
  assert.equal((await post(JSON.stringify({ k: 'x', ref: 'curto' }))).statusCode, 400);
  assert.equal((await post(JSON.stringify({ k: 'chave-que-nao-existe', ref: 'AB2CD' }))).statusCode, 404);
  const script = await app.inject({ method: 'GET', url: '/t.js' });
  assert.equal(script.statusCode, 200);
  assert.equal(script.headers['access-control-allow-origin'], '*');
});

test('webhook exige assinatura da Meta e responde a verificação', async () => {
  const { app, db } = await setup();
  const bad = await postWebhook(app, waPayload([{ from: LEAD_PHONE, text: 'oi' }]), 'segredo-errado');
  assert.equal(bad.statusCode, 401);
  assert.equal((await db.select().from(contacts)).length, 0);

  const ok = await app.inject({ method: 'GET', url: '/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=123' });
  assert.equal(ok.body, '123');
  const no = await app.inject({ method: 'GET', url: '/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=123' });
  assert.equal(no.statusCode, 403);

  const unknown = await postWebhook(app, waPayload([{ from: LEAD_PHONE, text: 'oi' }], 'OUTRO-NUMERO'));
  assert.equal(unknown.statusCode, 200);
  assert.equal((await db.select().from(contacts)).length, 0);
});

test('cliente marca venda no painel e não acessa o admin', async () => {
  const ctx = await setup();
  const contact = await clickAndMessage(ctx);
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/painel' })).headers.location, '/login');

  const cookie = await login(ctx.app, 'loja', 'loja-pass-123');
  const panel = await ctx.app.inject({ method: 'GET', url: '/painel', headers: { cookie } });
  assert.equal(panel.statusCode, 200);
  assert.match(panel.body, /Maria/);
  assert.match(panel.headers['content-security-policy'] as string, /script-src 'self'/);

  const bad = await ctx.app.inject({ method: 'POST', url: `/painel/contatos/${contact.id}/venda`, ...form(cookie, { valor: 'abc' }, { 'hx-request': 'true' }) });
  assert.match(bad.body, /Digite o valor/);

  const sold = await ctx.app.inject({ method: 'POST', url: `/painel/contatos/${contact.id}/venda`, ...form(cookie, { valor: '1.250,90' }, { 'hx-request': 'true' }) });
  assert.equal(sold.statusCode, 200);
  assert.match(sold.body, /Vendeu R\$\s1\.250,90/);
  const [sale] = await ctx.db.select().from(sales);
  assert.equal(sale?.valorCentavos, 125090);

  const tracked = await ctx.app.inject({ method: 'POST', url: `/painel/contatos/${contact.id}/origem`, ...form(cookie, { origem: 'indicacao' }, { 'hx-request': 'true' }) });
  assert.match(tracked.body, /veio do rastreio/);

  const admin = await ctx.app.inject({ method: 'GET', url: '/admin', headers: { cookie } });
  assert.equal(admin.headers.location, '/painel');

  const csrf = await ctx.app.inject({ method: 'POST', url: `/painel/contatos/${contact.id}/nao-comprou`, ...form(cookie, {}, { origin: 'https://site-malicioso.com' }) });
  assert.equal(csrf.statusCode, 403);

  const undo = await ctx.app.inject({ method: 'POST', url: `/painel/contatos/${contact.id}/reabrir`, ...form(cookie, {}) });
  assert.equal(undo.headers.location, '/painel', 'sem HTMX volta para a lista');
  assert.equal((await ctx.db.select().from(sales)).length, 0);
});

test('admin exporta lead e venda no formato do Google Ads', async () => {
  const ctx = await setup();
  const contact = await clickAndMessage(ctx);
  const loja = await login(ctx.app, 'loja', 'loja-pass-123');
  await ctx.app.inject({ method: 'POST', url: `/painel/contatos/${contact.id}/venda`, ...form(loja, { valor: '150' }) });

  const cookie = await login(ctx.app, 'admin', 'admin-pass-123');
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/admin', headers: { cookie } })).headers.location, `/admin/c/${ctx.client.id}`);

  const report = await ctx.app.inject({ method: 'GET', url: `/admin/c/${ctx.client.id}`, headers: { cookie } });
  assert.equal(report.statusCode, 200);
  assert.match(report.body, /Campanha X/);

  for (const tipo of ['lead', 'venda']) {
    const r = await ctx.app.inject({ method: 'POST', url: `/admin/c/${ctx.client.id}/exportacoes`, ...form(cookie, { tipo }) });
    assert.match(r.headers.location as string, /ok=arquivo/);
  }
  const again = await ctx.app.inject({ method: 'POST', url: `/admin/c/${ctx.client.id}/exportacoes`, ...form(cookie, { tipo: 'venda' }) });
  assert.match(again.headers.location as string, /ok=vazio/, 'não exporta a mesma venda duas vezes');

  const list = await ctx.app.inject({ method: 'GET', url: `/admin/c/${ctx.client.id}/exportacoes`, headers: { cookie } });
  const files = [...list.body.matchAll(/exportacoes\/((lead|venda)-[\w-]+\.csv)"/g)].map((m) => m[1]!);
  assert.equal(files.length, 2);

  const venda = await ctx.app.inject({ method: 'GET', url: `/admin/c/${ctx.client.id}/exportacoes/${files.find((f) => f.startsWith('venda'))}`, headers: { cookie } });
  assert.equal(venda.headers['content-type'], 'text/csv; charset=utf-8');
  const lines = venda.body.trim().split('\r\n');
  assert.equal(lines[0], 'Parameters:TimeZone=America/Sao_Paulo');
  assert.equal(lines[1], 'Google Click ID,GBRAID,WBRAID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency');
  assert.match(lines[2]!, /^GCLID-1,,,Venda WhatsApp,\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},150\.00,BRL$/);

  const lead = await ctx.app.inject({ method: 'GET', url: `/admin/c/${ctx.client.id}/exportacoes/${files.find((f) => f.startsWith('lead'))}`, headers: { cookie } });
  assert.match(lead.body, /GCLID-1,,,Lead WhatsApp,[\d: -]+,,\r\n$/);

  const undo = await ctx.app.inject({ method: 'POST', url: `/painel/contatos/${contact.id}/reabrir`, ...form(loja, {}, { 'hx-request': 'true' }) });
  assert.match(undo.body, /já foi enviada ao Google Ads/);

  const [sale] = await ctx.db.select().from(sales);
  const today = localDate(Date.now(), ctx.client.timezone);
  const edit = await ctx.app.inject({
    method: 'POST',
    url: `/admin/c/${ctx.client.id}/vendas/${sale!.id}`,
    ...form(cookie, { valor: '180,00', data: today, hora: '10:15', telefone: `+${LEAD_PHONE}` }),
  });
  assert.equal(edit.statusCode, 303);
  const fixed = await ctx.db.query.sales.findFirst({ where: eq(sales.id, sale!.id) });
  assert.equal(fixed?.valorCentavos, 18000);
  assert.equal(fixed?.soldAt, fromLocal(today, ctx.client.timezone, '10:15'));

  const reDownload = await ctx.app.inject({ method: 'GET', url: `/admin/c/${ctx.client.id}/exportacoes/${files.find((f) => f.startsWith('venda'))}`, headers: { cookie } });
  assert.match(reDownload.body, /150\.00,BRL/, 'arquivo já gerado continua igual ao que foi enviado');

  const wrongPhone = await ctx.app.inject({
    method: 'POST',
    url: `/admin/c/${ctx.client.id}/vendas/${sale!.id}`,
    ...form(cookie, { valor: '180,00', data: today, hora: '10:15', telefone: '+5511000000000' }),
  });
  assert.equal(wrongPhone.statusCode, 422);
  assert.match(wrongPhone.body, /Nenhum contato com o telefone/);
});

test('contato volta para a lista quando escreve num dia seguinte', async () => {
  const ctx = await setup();
  const tz = ctx.client.timezone;
  const day1 = fromLocal('2026-10-29', tz, '10:00');
  await handleInboundMessage(ctx.db, ctx.client, { from: LEAD_PHONE, name: null, timestamp: day1, ref: null });
  await ctx.db.update(contacts).set({ status: 'vendeu', statusAt: day1 + 60_000 });

  await handleInboundMessage(ctx.db, ctx.client, { from: LEAD_PHONE, name: null, timestamp: day1 + 2 * 60 * 60 * 1000, ref: null });
  assert.equal((await ctx.db.query.contacts.findFirst())?.status, 'vendeu', 'mesmo dia: "obrigado" não reabre');

  await handleInboundMessage(ctx.db, ctx.client, { from: LEAD_PHONE, name: 'Maria', timestamp: fromLocal('2026-10-30', tz, '09:00'), ref: null });
  const c = await ctx.db.query.contacts.findFirst();
  assert.equal(c?.status, 'aberto');
  assert.equal(c?.name, 'Maria');
});

test('health e backup', async () => {
  const ctx = await setup();
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
  const cookie = await login(ctx.app, 'admin', 'admin-pass-123');
  const r = await ctx.app.inject({ method: 'POST', url: `/admin/c/${ctx.client.id}/sistema/backup`, ...form(cookie, {}) });
  assert.match(r.headers.location as string, /ok=job/);
  const page = await ctx.app.inject({ method: 'GET', url: `/admin/c/${ctx.client.id}/sistema`, headers: { cookie } });
  assert.match(page.body, /tracelead-.+\.db \(\d+ KB\)/);
  assert.match(page.body, new RegExp(`data-client=&quot;${ctx.client.publicKey}&quot;`), 'snippet exibido como texto');
  assert.match(page.body, /aria-current="page"/);
});

test('marcar venda devolve as duas listas, contagens e aviso para o leitor de tela', async () => {
  const ctx = await setup();
  const contact = await clickAndMessage(ctx);
  const cookie = await login(ctx.app, 'loja', 'loja-pass-123');
  const hx = { 'hx-request': 'true' };

  const sold = await ctx.app.inject({ method: 'POST', url: `/painel/contatos/${contact.id}/venda`, ...form(cookie, { valor: '150' }, hx) });
  assert.equal(sold.headers['hx-retarget'], '#painel-lista');
  assert.equal(sold.headers['hx-reswap'], 'outerHTML');
  assert.match(sold.body, /id="painel-lista"/);
  assert.match(sold.body, /Contatos <span class="count">0<\/span>/);
  assert.match(sold.body, /Marcados hoje <span class="count">1<\/span>/);
  assert.match(sold.body, /class="ledger-row moved"/);
  assert.match(sold.body, /Total do dia · 1 venda/);
  assert.match(sold.body, /hx-swap-oob="true"[^>]*role="status"[\s\S]*Venda de R\$\s150,00 registrada[\s\S]*aviso-undo/);

  const undo = await ctx.app.inject({ method: 'POST', url: `/painel/contatos/${contact.id}/reabrir`, ...form(cookie, {}, hx) });
  assert.match(undo.body, /Contatos <span class="count">1<\/span>/);

  // A rejected amount only re-renders the card, so the typed form stays where it is.
  const bad = await ctx.app.inject({ method: 'POST', url: `/painel/contatos/${contact.id}/venda`, ...form(cookie, { valor: 'abc' }, hx) });
  assert.equal(bad.headers['hx-retarget'], undefined);
  assert.match(bad.body, /Digite o valor/);
});

test('painel avisa quando o WhatsApp do cliente baileys está desconectado', async () => {
  const ctx = await setup();
  await ctx.db.update(clients).set({ whatsappMode: 'baileys' }).where(eq(clients.id, ctx.client.id));
  const cookie = await login(ctx.app, 'loja', 'loja-pass-123');
  const res = await ctx.app.inject({ method: 'GET', url: '/painel', headers: { cookie } });
  assert.match(res.body, /chip-error[^>]*>WhatsApp desconectado/);
  assert.match(res.body, /Conecte o WhatsApp para começar/);
});

test('origem fica recolhida no cartão e o botão de salvar tem rótulo para o estado pendente', async () => {
  const ctx = await setup();
  const contact = await clickAndMessage(ctx);
  await ctx.db.update(clicks).set({ gclid: null }).where(eq(clicks.id, contact.clickId!));
  await ctx.db.update(contacts).set({ clickId: null }).where(eq(contacts.id, contact.id));
  const cookie = await login(ctx.app, 'loja', 'loja-pass-123');
  const res = await ctx.app.inject({ method: 'GET', url: '/painel', headers: { cookie } });
  assert.match(res.body, /data-modal-open="origem-modal-\d+">Alterar origem<\/button>\s*<dialog class="modal"/);
});

test('painel mostra primeira vez, aviso de expiração e total do dia', async () => {
  const ctx = await setup();
  const cookie = await login(ctx.app, 'loja', 'loja-pass-123');
  const empty = await ctx.app.inject({ method: 'GET', url: '/painel', headers: { cookie } });
  assert.match(empty.body, /Nenhum contato ainda/);
  assert.doesNotMatch(empty.body, /Tudo marcado/);

  const contact = await clickAndMessage(ctx);
  const old = Date.now() - 6 * 24 * 60 * 60 * 1000 - 3_600_000;
  await ctx.db.update(contacts).set({ firstMessageAt: old, lastMessageAt: old }).where(eq(contacts.id, contact.id));
  const aging = await ctx.app.inject({ method: 'GET', url: '/painel', headers: { cookie } });
  assert.match(aging.body, /Sai da lista em 1 dias|Sai da lista hoje/);

  const sold = await ctx.app.inject({ method: 'POST', url: `/painel/contatos/${contact.id}/venda`, ...form(cookie, { valor: '200' }, { 'hx-request': 'true' }) });
  assert.match(sold.body, /Total do dia · 1 venda<\/span><strong class="num">R\$\s200,00/);
  const done = await ctx.app.inject({ method: 'GET', url: '/painel', headers: { cookie } });
  assert.match(done.body, /Tudo marcado/);
});
