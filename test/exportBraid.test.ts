import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Database from 'better-sqlite3';

function migrationSql(name: string): string[] {
  return readFileSync(new URL(`../drizzle/${name}.sql`, import.meta.url), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
}

function migrated(upTo: string[]): Database.Database {
  const sqlite = new Database(':memory:');
  for (const name of upTo) for (const stmt of migrationSql(name)) sqlite.exec(stmt);
  return sqlite;
}

const CLIENT = `insert into clients (name, public_key, timezone, currency, created_at) values ('Loja', 'k1', 'America/Sao_Paulo', 'BRL', 1)`;

test('migração mantém exportações antigas com gclid', () => {
  const sqlite = migrated(['0000_init', '0001_whatsapp_baileys']);
  sqlite.exec(CLIENT);
  sqlite.exec(
    `insert into exports (client_id, tipo, referencia_id, arquivo, gclid, conversao_em, valor_centavos, exportado_em)
     values (1, 'venda', 7, 'venda-antigo.csv', 'GCLID-ANTIGO', 1000, 15000, 2000)`,
  );
  for (const stmt of migrationSql('0002_export_braid')) sqlite.exec(stmt);

  const rows = sqlite
    .prepare('select tipo, referencia_id as ref, arquivo, gclid, gbraid, wbraid, conversao_em as em, valor_centavos as valor, status from exports')
    .all();
  assert.deepEqual(rows, [
    { tipo: 'venda', ref: 7, arquivo: 'venda-antigo.csv', gclid: 'GCLID-ANTIGO', gbraid: null, wbraid: null, em: 1000, valor: 15000, status: 'gerado' },
  ]);
});

test('exportação só com gbraid é aceita depois da migração', () => {
  const sqlite = migrated(['0000_init', '0001_whatsapp_baileys', '0002_export_braid']);
  sqlite.exec(CLIENT);
  sqlite.exec(
    `insert into exports (client_id, tipo, referencia_id, arquivo, gbraid, conversao_em, exportado_em)
     values (1, 'lead', 3, 'lead-novo.csv', 'GBRAID-1', 1000, 2000)`,
  );
  const row = sqlite.prepare('select gclid, gbraid, wbraid from exports').get();
  assert.deepEqual(row, { gclid: null, gbraid: 'GBRAID-1', wbraid: null });
});
