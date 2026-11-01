import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { clients, contacts } from '../src/db/schema.js';
import { loadAuthState } from '../src/services/whatsappAuthState.js';
import { WhatsAppSessions } from '../src/services/whatsappSessions.js';
import { fakeFactory, silentLog } from './fakeWhatsApp.js';
import { postWebhook, setup, waPayload } from './helpers.js';

test('cliente cloud usa o webhook e não abre sessão', async () => {
  const ctx = await setup();
  assert.equal(ctx.client.whatsappMode, 'cloud');
  const res = await postWebhook(ctx.app, waPayload([{ from: '5511988887777', text: 'oi' }]));
  assert.equal(res.statusCode, 200);
  assert.ok(await ctx.db.query.contacts.findFirst({ where: eq(contacts.phone, '+5511988887777') }));

  // even with a saved Baileys login, a cloud client gets no socket
  const a = await loadAuthState(ctx.db, ctx.client.id);
  a.state.creds.registered = true;
  await a.saveCreds();
  const fake = fakeFactory();
  const sessions = new WhatsAppSessions(ctx.db, { maxSessions: 5, socketFactory: fake.factory, log: silentLog() });
  await sessions.startAll();
  assert.equal(fake.socks.length, 0);
  assert.equal(sessions.status(ctx.client.id).state, 'desconectado');
});

test('webhook de cliente baileys é ignorado', async () => {
  const ctx = await setup();
  await ctx.db.update(clients).set({ whatsappMode: 'baileys' }).where(eq(clients.id, ctx.client.id));
  const res = await postWebhook(ctx.app, waPayload([{ from: '5511977776666', text: 'oi (ref. AB2CD)' }]));
  assert.equal(res.statusCode, 200, 'a Meta não deve reenviar');
  assert.equal((await ctx.db.select().from(contacts)).length, 0);
});
