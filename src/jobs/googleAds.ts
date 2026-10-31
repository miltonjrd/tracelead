import type { Config } from '../config.js';

export class GoogleAdsError extends Error {}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

let cached: { refreshToken: string; token: string; expiresAt: number } | null = null;

async function accessToken(cfg: Config['googleAds'], fetchImpl: FetchLike): Promise<string> {
  if (cached && cached.refreshToken === cfg.refreshToken && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new GoogleAdsError(`Falha ao renovar o token OAuth: ${data.error_description ?? data.error ?? res.status}`);
  }
  cached = { refreshToken: cfg.refreshToken, token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

function errorMessage(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    const obj = (Array.isArray(parsed) ? parsed[0] : parsed) as {
      error?: { message?: string; details?: { errors?: { message?: string }[] }[] };
    };
    return obj.error?.details?.[0]?.errors?.[0]?.message ?? obj.error?.message ?? `HTTP ${status}`;
  } catch {
    return `HTTP ${status}`;
  }
}

/** Runs a GAQL query and returns every result row (camelCase JSON, as the REST API sends it). */
export async function searchStream<T>(
  cfg: Config['googleAds'],
  customerId: string,
  query: string,
  fetchImpl: FetchLike = fetch,
): Promise<T[]> {
  const token = await accessToken(cfg, fetchImpl);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'developer-token': cfg.developerToken,
    'Content-Type': 'application/json',
  };
  if (cfg.loginCustomerId) headers['login-customer-id'] = cfg.loginCustomerId;
  const res = await fetchImpl(
    `https://googleads.googleapis.com/${cfg.apiVersion}/customers/${customerId}/googleAds:searchStream`,
    { method: 'POST', headers, body: JSON.stringify({ query }) },
  );
  const text = await res.text();
  if (!res.ok) throw new GoogleAdsError(`Google Ads API: ${errorMessage(text, res.status)}`);
  const batches = JSON.parse(text) as { results?: T[] }[];
  return batches.flatMap((b) => b.results ?? []);
}

export function resetTokenCache(): void {
  cached = null;
}
