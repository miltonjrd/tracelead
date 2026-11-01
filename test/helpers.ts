import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/client.js';
import { eq } from 'drizzle-orm';
import { clients } from '../src/db/schema.js';
import { createClient, createUser } from '../src/services/accounts.js';
import type { FetchLike } from '../src/jobs/googleAds.js';

export const APP_SECRET = 'test-app-secret';

export async function setup(opts: { fetchImpl?: FetchLike; env?: Record<string, string> } = {}) {
  const config = loadConfig({
    META_APP_SECRET: APP_SECRET,
    META_VERIFY_TOKEN: 'verify-me',
    BASE_URL: 'http://localhost',
    BACKUP_DIR: mkdtempSync(join(tmpdir(), 'tracker-backup-')),
    ...opts.env,
  });
  const db = openDb(':memory:');
  const app = await buildApp({ config, db, fetchImpl: opts.fetchImpl });
  const created = await createClient(db, {
    name: 'Loja Teste',
    whatsappPhoneNumberId: 'PNID-1',
    googleAdsCustomerId: '123-456-7890',
  });
  // The existing flows exercise the Cloud API webhook, so this client uses that mode.
  const [client] = await db.update(clients).set({ whatsappMode: 'cloud' }).where(eq(clients.id, created.id)).returning();
  await createUser(db, { username: 'admin', password: 'admin-pass-123', role: 'admin' });
  await createUser(db, { username: 'loja', password: 'loja-pass-123', role: 'client', clientId: client!.id });
  return { config, db, app, client: client! };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

export async function login(app: App, username: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/login',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ username, password }).toString(),
  });
  if (res.statusCode !== 303) throw new Error(`login falhou: ${res.statusCode}`);
  const cookie = [res.headers['set-cookie']].flat().find((c) => c?.startsWith('sid='));
  return cookie!.split(';')[0]!;
}

export function form(cookie: string, data: Record<string, string>, extra: Record<string, string> = {}) {
  return {
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', ...extra },
    payload: new URLSearchParams(data).toString(),
  };
}

export function waPayload(messages: { from: string; text: string; name?: string; ts?: number }[], phoneNumberId = 'PNID-1') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '5511900000000', phone_number_id: phoneNumberId },
              contacts: messages.map((m) => ({ wa_id: m.from, profile: { name: m.name ?? 'Cliente' } })),
              messages: messages.map((m, i) => ({
                from: m.from,
                id: `wamid.${i}`,
                timestamp: String(Math.floor((m.ts ?? Date.now()) / 1000)),
                type: 'text',
                text: { body: m.text },
              })),
            },
          },
        ],
      },
    ],
  };
}

export async function postWebhook(app: App, payload: unknown, secret = APP_SECRET) {
  const body = JSON.stringify(payload);
  return app.inject({
    method: 'POST',
    url: '/webhook',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
    payload: body,
  });
}
