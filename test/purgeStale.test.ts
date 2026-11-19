import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../src/db/client.js';
import { clicks, contacts, sales } from '../src/db/schema.js';
import { createClient } from '../src/services/accounts.js';
import { createStage } from '../src/services/funnel.js';
import { purgeStaleContacts } from '../src/services/purgeStale.js';

const DAY = 86_400_000;

test('apaga só contatos antigos sem trabalho do cliente', async () => {
  const db = openDb(':memory:');
  const c = await createClient(db, { name: 'Loja' });
  const other = await createClient(db, { name: 'Outra' });
  const now = Date.now();
  const old = now - 30 * DAY;
  const base = { clientId: c.id, firstMessageAt: old, lastMessageAt: old, origem: 'desconhecida' as const, status: 'aberto' as const, statusAt: old };
  const [click] = await db.insert(clicks).values({ clientId: c.id, ref: 'r', createdAt: old }).returning();
  const stage = await createStage(db, c.id, 'Negociando');
  const rows = await db
    .insert(contacts)
    .values([
      { ...base, phone: '+5511900000001' }, // lixo: apaga
      { ...base, phone: '+5511900000002', lastMessageAt: now }, // recente: fica
      { ...base, phone: '+5511900000003', origem: 'anuncio', clickId: click!.id }, // veio de anúncio: fica
      { ...base, phone: '+5511900000004', stageId: stage.id }, // no funil: fica
      { ...base, phone: '+5511900000005' }, // com venda: fica
      { ...base, phone: '+5511900000006', status: 'nao_comprou' }, // marcado: fica
      { ...base, phone: '+5511900000007', clientId: other.id }, // outro cliente: fica
    ])
    .returning();
  await db.insert(sales).values({ clientId: c.id, contactId: rows[4]!.id, valorCentavos: 100, soldAt: old, createdAt: old, updatedAt: old });

  const dry = await purgeStaleContacts(db, c.id, now - 7 * DAY, false);
  assert.deepEqual(dry, { total: 6, matched: 1, deleted: 0 });
  const done = await purgeStaleContacts(db, c.id, now - 7 * DAY, true);
  assert.equal(done.deleted, 1);
  const left = (await db.select().from(contacts)).map((r) => r.phone);
  assert.ok(!left.includes('+5511900000001'));
  assert.equal(left.length, 6);

  // Sem data de corte, pega também o recente.
  const all = await purgeStaleContacts(db, c.id, null, true);
  assert.equal(all.deleted, 1);
  assert.ok(!(await db.select().from(contacts)).map((r) => r.phone).includes('+5511900000002'));
});
