import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { clients } from '../src/db/schema.js';
import { syncAdSpend } from '../src/jobs/adSpend.js';
import { resetTokenCache, type FetchLike } from '../src/jobs/googleAds.js';
import { form, login, setup } from './helpers.js';

const reload = async (ctx: Awaited<ReturnType<typeof setup>>) =>
  (await ctx.db.query.clients.findFirst({ where: eq(clients.id, ctx.client.id) }))!;

test('admin configura o Google Ads de um cliente sem depender do .env', async () => {
  resetTokenCache();
  const ctx = await setup(); // sem GOOGLE_ADS_* no ambiente
  const admin = await login(ctx.app, 'admin', 'admin-pass-123');
  const url = `/admin/c/${ctx.client.id}/sistema/google-ads`;

  const res = await ctx.app.inject({
    method: 'POST',
    url,
    ...form(admin, {
      customerId: '111-222-3333',
      loginCustomerId: '999-888-7777',
      developerToken: 'dev-x',
      clientId: 'cid-x',
      clientSecret: 'sec-x',
      refreshToken: 'ref-x',
      conversionNameLead: 'Lead Loja',
      conversionNameVenda: '',
    }),
  });
  assert.equal(res.statusCode, 303);
  let c = await reload(ctx);
  assert.equal(c.googleAdsCustomerId, '1112223333');
  assert.equal(c.googleAdsLoginCustomerId, '9998887777');
  assert.equal(c.googleAdsRefreshToken, 'ref-x');
  assert.equal(c.conversionNameLead, 'Lead Loja');

  const calls: Record<string, string>[] = [];
  const fetchImpl: FetchLike = async (u, init) => {
    if (u.includes('oauth2')) return Response.json({ access_token: 'tok', expires_in: 3600 });
    calls.push((init?.headers ?? {}) as Record<string, string>);
    return Response.json([{ results: [] }]);
  };
  await syncAdSpend(ctx.db, ctx.config, c, { fetchImpl });
  assert.equal(calls[0]!['developer-token'], 'dev-x');
  assert.equal(calls[0]!['login-customer-id'], '9998887777');

  // Segredos em branco mantêm o valor salvo; campos comuns em branco voltam ao padrão.
  await ctx.app.inject({ method: 'POST', url, ...form(admin, { customerId: '1112223333', developerToken: '', clientSecret: '', refreshToken: '', loginCustomerId: '', clientId: 'cid-x' }) });
  c = await reload(ctx);
  assert.equal(c.googleAdsDeveloperToken, 'dev-x');
  assert.equal(c.googleAdsLoginCustomerId, null);
  assert.equal(c.conversionNameLead, null);

  const page = await ctx.app.inject({ method: 'GET', url: `/admin/c/${ctx.client.id}/sistema`, headers: { cookie: admin } });
  assert.ok(!page.body.includes('ref-x') && !page.body.includes('sec-x') && !page.body.includes('dev-x'), 'segredos não voltam na tela');

  await ctx.app.inject({ method: 'POST', url, ...form(admin, { limpar: '1' }) });
  c = await reload(ctx);
  assert.equal(c.googleAdsRefreshToken, null);
  await assert.rejects(syncAdSpend(ctx.db, ctx.config, c, { fetchImpl }), /não configurada/);
});

test('cada cliente usa as próprias credenciais e cai no .env nos campos vazios', async () => {
  resetTokenCache();
  const ctx = await setup({ env: { GOOGLE_ADS_DEVELOPER_TOKEN: 'env-dev', GOOGLE_ADS_CLIENT_ID: 'env-cid', GOOGLE_ADS_CLIENT_SECRET: 'env-sec', GOOGLE_ADS_REFRESH_TOKEN: 'env-ref' } });
  const { resolveGoogleAds } = await import('../src/services/googleAdsSettings.js');
  const own = { ...ctx.client, googleAdsRefreshToken: 'own-ref' };
  const g = resolveGoogleAds(ctx.config, own);
  assert.equal(g.refreshToken, 'own-ref');
  assert.equal(g.developerToken, 'env-dev');
});
