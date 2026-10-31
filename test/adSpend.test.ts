import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adSpend, clicks } from '../src/db/schema.js';
import { syncAdSpend } from '../src/jobs/adSpend.js';
import { resetTokenCache, type FetchLike } from '../src/jobs/googleAds.js';
import { addDays, localDate, weekStart } from '../src/lib/time.js';
import { weeklyReport } from '../src/services/report.js';
import { recordClick, handleInboundMessage } from '../src/services/tracking.js';
import { setup } from './helpers.js';

const ENV = {
  GOOGLE_ADS_DEVELOPER_TOKEN: 'dev-token',
  GOOGLE_ADS_CLIENT_ID: 'cid',
  GOOGLE_ADS_CLIENT_SECRET: 'secret',
  GOOGLE_ADS_REFRESH_TOKEN: 'refresh',
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: '999-888-7777',
};

function fakeGoogle(yesterday: string) {
  const calls: { url: string; headers: Record<string, string>; query?: string }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (url === 'https://oauth2.googleapis.com/token') {
      calls.push({ url, headers });
      return Response.json({ access_token: 'access-1', expires_in: 3600 });
    }
    const query = JSON.parse(String(init?.body)).query as string;
    calls.push({ url, headers, query });
    if (query.includes('FROM campaign')) {
      return Response.json([
        {
          results: [
            { segments: { date: yesterday }, campaign: { id: '111', name: 'Busca Orçamento' }, metrics: { costMicros: '25500000', clicks: '40', impressions: '900' } },
          ],
        },
      ]);
    }
    const results = query.includes(yesterday) ? [{ clickView: { gclid: 'GCLID-ADS' }, campaign: { id: '111' } }] : [];
    return Response.json([{ results }]);
  };
  return { calls, fetchImpl };
}

test('sincroniza gasto e liga o gclid à campanha', async () => {
  resetTokenCache();
  const now = Date.now();
  const yesterday = addDays(localDate(now, 'America/Sao_Paulo'), -1);
  const google = fakeGoogle(yesterday);
  const ctx = await setup({ env: ENV, fetchImpl: google.fetchImpl });

  const click = await recordClick(
    ctx.db,
    { k: ctx.client.publicKey, ref: 'QWERT', gclid: 'GCLID-ADS' },
    { ip: '1.2.3.4', ipHashSecret: 'x' },
    now - 24 * 60 * 60 * 1000,
  );
  await handleInboundMessage(ctx.db, ctx.client, { from: '5511955554444', name: null, timestamp: now - 23 * 60 * 60 * 1000, ref: 'QWERT' });

  const detail = await syncAdSpend(ctx.db, ctx.config, ctx.client, { fetchImpl: google.fetchImpl, now });
  assert.match(detail, /1 linhas de gasto/);
  assert.match(detail, /1 cliques ligados/);

  const api = google.calls.filter((c) => c.query);
  assert.equal(api[0]!.url, 'https://googleads.googleapis.com/v25/customers/1234567890/googleAds:searchStream');
  assert.equal(api[0]!.headers['developer-token'], 'dev-token');
  assert.equal(api[0]!.headers['login-customer-id'], '9998887777');
  assert.equal(api[0]!.headers.Authorization, 'Bearer access-1');
  assert.equal(api.length, 1 + 7, 'uma consulta de campanhas + uma de click_view por dia');

  const [spend] = await ctx.db.select().from(adSpend);
  assert.equal(spend?.costMicros, 25_500_000);
  const [linked] = await ctx.db.select().from(clicks);
  assert.equal(linked?.id, click?.id);
  assert.equal(linked?.campaignId, '111');

  await syncAdSpend(ctx.db, ctx.config, ctx.client, { fetchImpl: google.fetchImpl, now });
  assert.equal((await ctx.db.select().from(adSpend)).length, 1, 'reler os mesmos dias atualiza em vez de duplicar');

  const contactWeek = weekStart(localDate(now - 23 * 60 * 60 * 1000, ctx.client.timezone));
  const report = await weeklyReport(ctx.db, ctx.client, contactWeek, now);
  const campaign = report.campaigns.find((c) => c.key === '111');
  assert.equal(campaign?.name, 'Busca Orçamento');
  assert.equal(campaign?.conversas, 1);
  if (weekStart(yesterday) === contactWeek) assert.equal(campaign?.costMicros, 25_500_000);
});

test('erro da API vira mensagem legível', async () => {
  resetTokenCache();
  const fetchImpl: FetchLike = async (url) =>
    url.includes('oauth2')
      ? Response.json({ access_token: 'a', expires_in: 3600 })
      : Response.json([{ error: { message: 'outer', details: [{ errors: [{ message: 'The developer token is only approved for use with test accounts.' }] }] } }], { status: 403 });
  const ctx = await setup({ env: ENV, fetchImpl });
  await assert.rejects(syncAdSpend(ctx.db, ctx.config, ctx.client, { fetchImpl }), /only approved for use with test accounts/);
});
