import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';

const dir = join(import.meta.dirname, '..', 'drizzle');
const run = (db: Database.Database, file: string) => {
  for (const stmt of readFileSync(join(dir, file), 'utf8').split('--> statement-breakpoint')) db.exec(stmt);
};

test('migração 0009 troca o status orçamento pela etapa Orçamento e dá a etapa a todo cliente', () => {
  const db = new Database(':memory:');
  const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const last = files.at(-1)!;
  assert.equal(last, '0009_orcamento_to_funnel_stage.sql');
  for (const f of files.slice(0, -1)) run(db, f);

  const client = (name: string, key: string) =>
    Number(db.prepare(`INSERT INTO clients (name, public_key, created_at) VALUES (?, ?, 1)`).run(name, key).lastInsertRowid);
  const a = client('A', 'ka');
  const b = client('B', 'kb');
  const c = client('C', 'kc');
  // B already has its own "orçamento" stage (any case) and another one; C has no quotes at all.
  db.prepare(`INSERT INTO funnel_stages (client_id, name, position, created_at) VALUES (?, 'Novo', 0, 1), (?, 'ORÇAMENTO', 1, 1)`).run(b, b);
  const contact = (clientId: number, phone: string, status: string) =>
    db
      .prepare(
        `INSERT INTO contacts (client_id, phone, first_message_at, last_message_at, origem, status, status_at) VALUES (?, ?, 1, 1, 'desconhecida', ?, 777)`,
      )
      .run(clientId, phone, status);
  contact(a, '+551', 'orcamento');
  contact(a, '+552', 'vendeu');
  contact(b, '+553', 'orcamento');
  contact(b, '+554', 'aberto');

  run(db, last);

  const stages = (id: number) => db.prepare(`SELECT name FROM funnel_stages WHERE client_id = ? ORDER BY position`).all(id).map((r) => (r as { name: string }).name);
  assert.deepEqual(stages(a), ['Orçamento']);
  assert.deepEqual(stages(b), ['Novo', 'ORÇAMENTO'], 'reaproveita a etapa existente, sem duplicar');
  assert.deepEqual(stages(c), ['Orçamento'], 'todo cliente recebe a etapa padrão');

  const row = (phone: string) =>
    db.prepare(`SELECT c.status, c.status_at AS statusAt, f.name AS stage FROM contacts c LEFT JOIN funnel_stages f ON f.id = c.stage_id WHERE c.phone = ?`).get(phone) as {
      status: string;
      statusAt: number;
      stage: string | null;
    };
  assert.deepEqual(row('+551'), { status: 'aberto', statusAt: 777, stage: 'Orçamento' });
  assert.deepEqual(row('+553'), { status: 'aberto', statusAt: 777, stage: 'ORÇAMENTO' });
  assert.deepEqual(row('+552'), { status: 'vendeu', statusAt: 777, stage: null });
  assert.deepEqual(row('+554'), { status: 'aberto', statusAt: 777, stage: null });
  assert.equal(db.prepare(`SELECT count(*) AS n FROM contacts WHERE status = 'orcamento'`).get()!.n, 0);
});
