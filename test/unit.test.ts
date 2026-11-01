import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../src/db/client.js';
import { loadConfig } from '../src/config.js';
import { toCsv } from '../src/lib/csv.js';
import { formatPhone, normalizePhone, parseMoney } from '../src/lib/format.js';
import { html } from '../src/lib/html.js';
import { extractRef, isValidRef } from '../src/lib/ref.js';
import { addDays, fromLocal, localDate, localDateTime, weekStart } from '../src/lib/time.js';
import { createUser } from '../src/services/accounts.js';
import { authenticate, createSession, resolveSession, SESSION_TTL_MS } from '../src/services/auth.js';

test('parseMoney entende os formatos brasileiros', () => {
  assert.equal(parseMoney('150'), 15000);
  assert.equal(parseMoney('150,5'), 15050);
  assert.equal(parseMoney('1.250,90'), 125090);
  assert.equal(parseMoney('R$ 1.234'), 123400);
  assert.equal(parseMoney('1234.56'), 123456);
  assert.equal(parseMoney('0'), null);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney('1,2,3'), null);
  assert.equal(parseMoney(undefined), null);
});

test('extractRef acha o ref na mensagem e ignora o resto', () => {
  assert.equal(extractRef('Olá! Gostaria de um orçamento. (ref. 4F7KX)'), '4F7KX');
  assert.equal(extractRef('oi ref:ab2cd'), 'AB2CD');
  assert.equal(extractRef('Quero+um+box+(ref.+8FW84)'), '8FW84');
  assert.equal(extractRef('ref. AB0CD'), null, '0 não existe no alfabeto');
  assert.equal(extractRef('sem referência'), null);
  assert.ok(isValidRef('ZZZZZ'));
  assert.ok(!isValidRef('ZZZZ'));
});

test('telefones', () => {
  assert.equal(normalizePhone('(11) 98888-7777'), '+11988887777');
  assert.equal(formatPhone('+5511988887777'), '(11) 98888-7777');
  assert.equal(normalizePhone('123'), null);
});

test('datas no fuso do cliente', () => {
  const tz = 'America/Sao_Paulo';
  const ts = fromLocal('2026-10-31', tz, '14:30');
  assert.equal(new Date(ts).toISOString(), '2026-10-31T17:30:00.000Z');
  assert.equal(localDate(fromLocal('2026-11-01', tz), tz), '2026-11-01');
  assert.equal(localDateTime(ts, tz), '2026-10-31 14:30:00');
  assert.equal(weekStart('2026-11-01'), '2026-10-26', 'domingo pertence à semana da segunda anterior');
  assert.equal(weekStart('2026-10-26'), '2026-10-26');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('csv escapa vírgulas e aspas', () => {
  assert.equal(toCsv([['a,b', 'c"d', 1, null]]), '"a,b","c""d",1,\r\n');
});

test('html escapa valores interpolados', () => {
  assert.equal(html`<p>${'<script>'}</p>`.value, '<p>&lt;script&gt;</p>');
  assert.equal(html`<p>${html`<b>ok</b>`}</p>`.value, '<p><b>ok</b></p>');
});

test('sessão renova a cada hora e expira em 7 dias sem uso', async () => {
  const db = openDb(':memory:');
  const user = await createUser(db, { username: 'Admin', password: 'senha-forte-1', role: 'admin' });
  assert.equal((await authenticate(db, 'admin', 'senha-forte-1'))?.id, user.id, 'usuário sem diferenciar maiúsculas');
  assert.equal(await authenticate(db, 'admin', 'errada'), null);
  assert.equal(await authenticate(db, 'ninguem', 'senha-forte-1'), null);

  const t0 = Date.UTC(2026, 9, 1);
  const used = await createSession(db, user.id, t0);
  assert.equal((await resolveSession(db, used, t0 + 30 * 60 * 1000))?.renewed, false);
  assert.equal((await resolveSession(db, used, t0 + 6 * 24 * 60 * 60 * 1000))?.renewed, true, 'uso no 6º dia renova');
  assert.ok(await resolveSession(db, used, t0 + SESSION_TTL_MS + 60_000), 'continua válida depois da validade original');

  const idle = await createSession(db, user.id, t0);
  assert.equal(await resolveSession(db, idle, t0 + SESSION_TTL_MS + 1000), null, 'sem uso por 7 dias expira');
  assert.equal(await resolveSession(db, 'token-falso'), null);
});

test('BAILEYS_MAX_SESSIONS padrão 5 e lê o valor', () => {
  assert.equal(loadConfig({}).whatsapp.maxSessions, 5);
  assert.equal(loadConfig({ BAILEYS_MAX_SESSIONS: '12' }).whatsapp.maxSessions, 12);
  assert.equal(loadConfig({ BAILEYS_MAX_SESSIONS: 'abc' }).whatsapp.maxSessions, 5, 'valor inválido volta ao padrão');
  assert.equal(loadConfig({ BAILEYS_MAX_SESSIONS: '0' }).whatsapp.maxSessions, 5, 'zero volta ao padrão');
});
