import { eq } from 'drizzle-orm';
import { googleAdsConfigured, type Config } from '../config.js';
import type { Db } from '../db/client.js';
import { clients, type Client } from '../db/schema.js';

export interface GoogleAdsSettingsInput {
  developerToken?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  loginCustomerId?: string;
  conversionNameLead?: string;
  conversionNameVenda?: string;
}

const digits = (v: string) => v.replace(/\D/g, '');

/** The client's own Google Ads credentials win field by field; anything unset falls back to the server env. */
export function resolveGoogleAds(config: Config, client: Client): Config['googleAds'] {
  const g = config.googleAds;
  return {
    developerToken: client.googleAdsDeveloperToken || g.developerToken,
    clientId: client.googleAdsClientId || g.clientId,
    clientSecret: client.googleAdsClientSecret || g.clientSecret,
    refreshToken: client.googleAdsRefreshToken || g.refreshToken,
    loginCustomerId: client.googleAdsLoginCustomerId || g.loginCustomerId,
    apiVersion: g.apiVersion,
  };
}

export function clientGoogleAdsConfigured(config: Config, client: Client): boolean {
  return googleAdsConfigured({ ...config, googleAds: resolveGoogleAds(config, client) });
}

export function resolveConversionNames(config: Config, client: Client): { lead: string; venda: string } {
  return {
    lead: client.conversionNameLead || config.conversionNames.lead,
    venda: client.conversionNameVenda || config.conversionNames.venda,
  };
}

/** Which Google Ads fields come from the client itself (for the admin screen; never exposes the values of secrets). */
export function ownGoogleAds(client: Client) {
  return {
    developerToken: Boolean(client.googleAdsDeveloperToken),
    clientId: Boolean(client.googleAdsClientId),
    clientSecret: Boolean(client.googleAdsClientSecret),
    refreshToken: Boolean(client.googleAdsRefreshToken),
  };
}

/**
 * Secrets (developer token, client secret, refresh token): blank keeps the saved value.
 * Plain fields (client id, MCC, conversion names): blank clears them back to the server default.
 */
export async function saveGoogleAdsSettings(db: Db, clientId: number, input: GoogleAdsSettingsInput): Promise<Client> {
  const set: Partial<typeof clients.$inferInsert> = {};
  const secret = (v: string | undefined) => v?.trim() || undefined;
  const plain = (v: string | undefined) => v?.trim() || null;
  const dev = secret(input.developerToken);
  const sec = secret(input.clientSecret);
  const ref = secret(input.refreshToken);
  if (dev) set.googleAdsDeveloperToken = dev;
  if (sec) set.googleAdsClientSecret = sec;
  if (ref) set.googleAdsRefreshToken = ref;
  set.googleAdsClientId = plain(input.clientId);
  set.googleAdsLoginCustomerId = input.loginCustomerId?.trim() ? digits(input.loginCustomerId) || null : null;
  set.conversionNameLead = plain(input.conversionNameLead);
  set.conversionNameVenda = plain(input.conversionNameVenda);
  const [client] = await db.update(clients).set(set).where(eq(clients.id, clientId)).returning();
  if (!client) throw new Error(`Cliente ${clientId} não existe`);
  return client;
}

/** Drops every per-client Google Ads override so the client goes back to the server-wide settings. */
export async function clearGoogleAdsSettings(db: Db, clientId: number): Promise<Client> {
  const [client] = await db
    .update(clients)
    .set({
      googleAdsDeveloperToken: null,
      googleAdsClientId: null,
      googleAdsClientSecret: null,
      googleAdsRefreshToken: null,
      googleAdsLoginCustomerId: null,
      conversionNameLead: null,
      conversionNameVenda: null,
    })
    .where(eq(clients.id, clientId))
    .returning();
  if (!client) throw new Error(`Cliente ${clientId} não existe`);
  return client;
}
