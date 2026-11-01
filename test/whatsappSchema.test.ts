import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { openDb } from '../src/db/client.js';
import { createClient } from '../src/services/accounts.js';

function migrationSql(name: string): string[] {
  return readFileSync(new URL(`../drizzle/${name}.sql`, import.meta.url), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
}

test('migração põe em cloud quem já tem phone number id', () => {
  const sqlite = new Database(':memory:');
  for (const stmt of migrationSql('0000_init')) sqlite.exec(stmt);
  sqlite.exec(
    `insert into clients (name, public_key, whatsapp_phone_number_id, timezone, currency, created_at)
     values ('Com Meta', 'k1', 'PNID-9', 'America/Sao_Paulo', 'BRL', 1),
            ('Sem Meta', 'k2', null, 'America/Sao_Paulo', 'BRL', 1)`,
  );
  for (const stmt of migrationSql('0001_whatsapp_baileys')) sqlite.exec(stmt);
  const rows = sqlite.prepare('select name, whatsapp_mode as mode from clients order by id').all();
  assert.deepEqual(rows, [
    { name: 'Com Meta', mode: 'cloud' },
    { name: 'Sem Meta', mode: 'baileys' },
  ]);
});

test('cliente novo nasce em modo baileys', async () => {
  const db = openDb(':memory:');
  const client = await createClient(db, { name: 'Loja Nova' });
  assert.equal(client.whatsappMode, 'baileys');
});
