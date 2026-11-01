import assert from 'node:assert/strict';
import { test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { openDb } from '../src/db/client.js';
import { whatsappAuth } from '../src/db/schema.js';
import { createClient } from '../src/services/accounts.js';
import { clearAuthState, loadAuthState } from '../src/services/whatsappAuthState.js';

async function twoClients() {
  const db = openDb(':memory:');
  const a = await createClient(db, { name: 'A' });
  const b = await createClient(db, { name: 'B' });
  return { db, a, b };
}

test('auth state guarda e relê creds e chaves', async () => {
  const { db, a } = await twoClients();
  const first = await loadAuthState(db, a.id);
  assert.equal(first.state.creds.registered, false);

  first.state.creds.registered = true;
  first.state.creds.me = { id: '5511999990000:3@s.whatsapp.net', name: 'Loja' };
  await first.saveCreds();
  await first.state.keys.set({
    'pre-key': { '7': { public: Buffer.from([1, 2, 3]), private: Buffer.from([4, 5, 6]) } },
    session: { 'abc.0': Buffer.from([9, 8, 7]) },
  });

  const second = await loadAuthState(db, a.id);
  assert.equal(second.state.creds.registered, true);
  assert.equal(second.state.creds.me?.id, '5511999990000:3@s.whatsapp.net');
  assert.deepEqual(Buffer.from(second.state.creds.noiseKey.private), Buffer.from(first.state.creds.noiseKey.private));

  const pre = await second.state.keys.get('pre-key', ['7', 'missing']);
  assert.deepEqual(Buffer.from(pre['7']!.public), Buffer.from([1, 2, 3]));
  assert.deepEqual(Buffer.from(pre['7']!.private), Buffer.from([4, 5, 6]));
  assert.equal(pre['missing'], undefined);
  const sess = await second.state.keys.get('session', ['abc.0']);
  assert.deepEqual(Buffer.from(sess['abc.0']!), Buffer.from([9, 8, 7]));

  await second.state.keys.set({ 'pre-key': { '7': null } });
  const gone = await (await loadAuthState(db, a.id)).state.keys.get('pre-key', ['7']);
  assert.equal(gone['7'], undefined);
});

test('auth state apaga só o cliente pedido', async () => {
  const { db, a, b } = await twoClients();
  for (const c of [a, b]) {
    const s = await loadAuthState(db, c.id);
    s.state.creds.registered = true;
    await s.saveCreds();
    await s.state.keys.set({ session: { x: Buffer.from([1]) } });
  }
  await clearAuthState(db, a.id);

  assert.equal((await db.select().from(whatsappAuth).where(eq(whatsappAuth.clientId, a.id))).length, 0);
  assert.equal((await db.select().from(whatsappAuth).where(eq(whatsappAuth.clientId, b.id))).length, 2);
  assert.equal((await loadAuthState(db, a.id)).state.creds.registered, false);
  assert.equal((await loadAuthState(db, b.id)).state.creds.registered, true);
});

test('auth state corrompido volta a creds novas', async () => {
  const { db, a } = await twoClients();
  await db.insert(whatsappAuth).values({ clientId: a.id, key: 'creds', value: '{not json', updatedAt: 1 });
  await db.insert(whatsappAuth).values({ clientId: a.id, key: 'session-x', value: '{"also": bad', updatedAt: 1 });

  const s = await loadAuthState(db, a.id);
  assert.equal(s.state.creds.registered, false);
  assert.equal((await db.select().from(whatsappAuth).where(eq(whatsappAuth.clientId, a.id))).length, 0);
  assert.equal(
    (await db.select().from(whatsappAuth).where(and(eq(whatsappAuth.clientId, a.id), eq(whatsappAuth.key, 'creds')))).length,
    0,
  );
});
