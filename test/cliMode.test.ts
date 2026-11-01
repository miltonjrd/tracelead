import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { openDb } from '../src/db/client.js';
import { clients } from '../src/db/schema.js';
import { createClient } from '../src/services/accounts.js';
import { WhatsAppSessions } from '../src/services/whatsappSessions.js';
import { fakeFactory, silentLog } from './fakeWhatsApp.js';

function cli(dbPath: string, ...args: string[]) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    env: { ...process.env, DATABASE_PATH: dbPath },
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('cli troca o modo do whatsapp', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'tracker-cli-')), 'cli.db');
  const db = openDb(dbPath);
  const client = await createClient(db, { name: 'Loja' });
  const fake = fakeFactory();
  const sessions = new WhatsAppSessions(db, { maxSessions: 5, socketFactory: fake.factory, log: silentLog() });
  await sessions.connect(client.id);
  fake.last().open();

  const r = cli(dbPath, 'update-client', '--id', String(client.id), '--whatsapp-mode', 'cloud');
  assert.equal(r.code, 0, r.err);
  assert.equal((await db.query.clients.findFirst({ where: eq(clients.id, client.id) }))?.whatsappMode, 'cloud');

  await sessions.reconcile();
  assert.equal(fake.last().loggedOut, true);
  assert.deepEqual(sessions.status(client.id), { state: 'desconectado' });

  const created = cli(dbPath, 'create-client', '--name', 'Loja Meta', '--whatsapp-mode', 'cloud');
  assert.equal(created.code, 0, created.err);
  const rows = await db.select().from(clients);
  assert.equal(rows.find((c) => c.name === 'Loja Meta')?.whatsappMode, 'cloud');
});

test('cli recusa modo inválido', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'tracker-cli-')), 'cli.db');
  const db = openDb(dbPath);
  const client = await createClient(db, { name: 'Loja' });
  const r = cli(dbPath, 'update-client', '--id', String(client.id), '--whatsapp-mode', 'xyz');
  assert.notEqual(r.code, 0);
  assert.match(r.err, /Modo de WhatsApp inválido: xyz/);
  assert.equal((await db.query.clients.findFirst({ where: eq(clients.id, client.id) }))?.whatsappMode, 'baileys');
});
