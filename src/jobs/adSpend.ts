import { and, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { adSpend, clicks, type Client } from '../db/schema.js';
import { addDays, DAY_MS, localDate } from '../lib/time.js';
import { clientGoogleAdsConfigured, resolveGoogleAds } from '../services/googleAdsSettings.js';
import { searchStream, type FetchLike } from './googleAds.js';

interface CampaignResult {
  segments: { date: string };
  campaign: { id: string; name: string };
  metrics: { costMicros?: string; clicks?: string; impressions?: string };
}

interface ClickViewResult {
  clickView: { gclid: string };
  campaign: { id: string };
}

/**
 * Pulls the last `days` full days of cost per campaign (re-read daily because Google keeps
 * adjusting recent figures) and, via click_view, which campaign each of our gclids came from.
 */
export async function syncAdSpend(
  db: Db,
  config: Config,
  client: Client,
  opts: { days?: number; now?: number; fetchImpl?: FetchLike } = {},
): Promise<string> {
  if (!clientGoogleAdsConfigured(config, client)) throw new Error('Google Ads API não configurada para este cliente (nem no cliente nem nas variáveis GOOGLE_ADS_*)');
  const googleAds = resolveGoogleAds(config, client);
  if (!client.googleAdsCustomerId) throw new Error('Cliente sem google_ads_customer_id');
  const days = opts.days ?? 7;
  const now = opts.now ?? Date.now();
  const customerId = client.googleAdsCustomerId;
  const to = addDays(localDate(now, client.timezone), -1);
  const from = addDays(to, -(days - 1));

  const rows = await searchStream<CampaignResult>(
    googleAds,
    customerId,
    `SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.clicks, metrics.impressions
     FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`,
    opts.fetchImpl,
  );
  for (const r of rows) {
    const values = {
      costMicros: Number(r.metrics.costMicros ?? 0),
      clicks: Number(r.metrics.clicks ?? 0),
      impressions: Number(r.metrics.impressions ?? 0),
      campaignName: r.campaign.name,
      updatedAt: now,
    };
    await db
      .insert(adSpend)
      .values({ clientId: client.id, date: r.segments.date, campaignId: String(r.campaign.id), ...values })
      .onConflictDoUpdate({ target: [adSpend.clientId, adSpend.date, adSpend.campaignId], set: values });
  }

  const pending = await db
    .select({ id: clicks.id, gclid: clicks.gclid })
    .from(clicks)
    .where(
      and(
        eq(clicks.clientId, client.id),
        isNull(clicks.campaignId),
        isNotNull(clicks.gclid),
        gte(clicks.createdAt, now - (days + 2) * DAY_MS),
      ),
    );
  let linked = 0;
  if (pending.length) {
    const byGclid = new Map(pending.map((p) => [p.gclid!, p.id]));
    // click_view only accepts a single-day filter.
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const views = await searchStream<ClickViewResult>(
        googleAds,
        customerId,
        `SELECT click_view.gclid, campaign.id FROM click_view WHERE segments.date = '${d}'`,
        opts.fetchImpl,
      );
      for (const v of views) {
        const id = byGclid.get(v.clickView.gclid);
        if (id === undefined) continue;
        await db.update(clicks).set({ campaignId: String(v.campaign.id) }).where(eq(clicks.id, id));
        byGclid.delete(v.clickView.gclid);
        linked++;
      }
    }
  }

  const [total] = await db
    .select({ micros: sql<number>`coalesce(sum(${adSpend.costMicros}), 0)` })
    .from(adSpend)
    .where(and(eq(adSpend.clientId, client.id), gte(adSpend.date, from)));
  const reais = ((total?.micros ?? 0) / 1e6).toFixed(2);
  return `${rows.length} linhas de gasto de ${from} a ${to} (total ${reais} ${client.currency}); ${linked} cliques ligados à campanha`;
}
