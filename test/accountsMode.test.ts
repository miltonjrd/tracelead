import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { openDb } from '../src/db/client.js';
import { clients } from '../src/db/schema.js';
import { createClient, updateClient } from '../src/services/accounts.js';

test('updateClient troca o modo do whatsapp', async () => {
  const db = openDb(':memory:');
  const c = await createClient(db, { name: 'Loja' });
  assert.equal(c.whatsappMode, 'baileys');
  assert.equal((await updateClient(db, c.id, { whatsappMode: 'cloud' })).whatsappMode, 'cloud');
  assert.equal((await updateClient(db, c.id, { name: 'Outro nome' })).whatsappMode, 'cloud', 'sem o campo, o modo fica');
  assert.equal((await createClient(db, { name: 'Loja Meta', whatsappMode: 'cloud' })).whatsappMode, 'cloud');
});

test('updateClient recusa modo inválido', async () => {
  const db = openDb(':memory:');
  const c = await createClient(db, { name: 'Loja' });
  await assert.rejects(() => updateClient(db, c.id, { whatsappMode: 'xyz' }), { message: 'Modo de WhatsApp inválido: xyz' });
  await assert.rejects(() => createClient(db, { name: 'X', whatsappMode: 'xyz' }), { message: 'Modo de WhatsApp inválido: xyz' });
  const saved = await db.query.clients.findFirst({ where: eq(clients.id, c.id) });
  assert.equal(saved?.whatsappMode, 'baileys', 'o valor recusado não foi gravado');
});
