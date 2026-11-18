import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { contacts, funnelStages } from '../src/db/schema.js';
import { createClient } from '../src/services/accounts.js';
import {
  createStage,
  deleteStage,
  listStages,
  MAX_STAGES,
  moveStage,
  renameStage,
  setContactStage,
} from '../src/services/funnel.js';
import { listPanel, PanelError } from '../src/services/panel.js';
import { form, login, setup } from './helpers.js';

const HX = { 'hx-request': 'true' };

async function addContact(db: Awaited<ReturnType<typeof setup>>['db'], clientId: number, phone: string, name = 'Maria') {
  const now = Date.now();
  const [c] = await db
    .insert(contacts)
    .values({ clientId, phone, name, firstMessageAt: now, lastMessageAt: now, origem: 'desconhecida', statusAt: now })
    .returning();
  return c!;
}

test('etapas: cria em ordem, recusa nome vazio, repetido ou acima do limite', async () => {
  const { db, client } = await setup();
  await createStage(db, client.id, '  Novo  ');
  await createStage(db, client.id, 'Em conversa');
  assert.deepEqual((await listStages(db, client.id)).map((s) => s.name), ['Orçamento', 'Novo', 'Em conversa']);

  await assert.rejects(createStage(db, client.id, '   '), PanelError);
  await assert.rejects(createStage(db, client.id, 'novo'), /Já existe/);
  await assert.rejects(createStage(db, client.id, 'x'.repeat(41)), PanelError);

  for (let i = 3; i < MAX_STAGES; i++) await createStage(db, client.id, `Etapa ${i}`);
  await assert.rejects(createStage(db, client.id, 'Uma a mais'), /até 20/);
});

test('etapas: renomear, reordenar e excluir libera os contatos sem apagá-los', async () => {
  const { db, client } = await setup();
  const a = await createStage(db, client.id, 'A');
  const b = await createStage(db, client.id, 'B');
  const c = await createStage(db, client.id, 'C');

  await moveStage(db, client.id, c.id, 'up');
  await moveStage(db, client.id, a.id, 'up'); // already first: no-op
  assert.deepEqual((await listStages(db, client.id)).map((s) => s.name), ['A', 'Orçamento', 'C', 'B']);

  await renameStage(db, client.id, b.id, 'Beta');
  await assert.rejects(renameStage(db, client.id, b.id, 'a'), /Já existe/);

  const contact = await addContact(db, client.id, '+5511900000001');
  await setContactStage(db, client.id, contact.id, b.id);
  assert.equal(await deleteStage(db, client.id, b.id), 1);
  const after = await db.query.contacts.findFirst({ where: eq(contacts.id, contact.id) });
  assert.equal(after?.stageId, null);
  assert.deepEqual((await listStages(db, client.id)).map((s) => s.name), ['A', 'Orçamento', 'C']);
});

test('etapas: um cliente não enxerga nem usa etapas e contatos de outro', async () => {
  const { db, client } = await setup();
  const other = await createClient(db, { name: 'Outra Loja' });
  const mine = await createStage(db, client.id, 'Minha');
  const theirs = await createStage(db, other.id, 'Deles');
  const contact = await addContact(db, client.id, '+5511900000002');
  const foreign = await addContact(db, other.id, '+5511900000003');

  await assert.rejects(setContactStage(db, client.id, contact.id, theirs.id), /Etapa não encontrada/);
  await assert.rejects(setContactStage(db, client.id, foreign.id, mine.id), /Contato não encontrado/);
  await assert.rejects(renameStage(db, client.id, theirs.id, 'X'), PanelError);
  await assert.rejects(deleteStage(db, client.id, theirs.id), PanelError);
  await assert.rejects(moveStage(db, client.id, theirs.id, 'up'), PanelError);
  assert.equal((await db.select().from(funnelStages).where(eq(funnelStages.id, theirs.id))).length, 1);
});

test('lista de contatos filtra por etapa e por "sem etapa"', async () => {
  const { db, client } = await setup();
  const st = await createStage(db, client.id, 'Negociando');
  const a = await addContact(db, client.id, '+5511900000004', 'Ana');
  await addContact(db, client.id, '+5511900000005', 'Beto');
  await setContactStage(db, client.id, a.id, st.id);

  const names = async (etapa: string) =>
    (await listPanel(db, client, Date.now(), { etapa })).pendentes.map((r) => r.contact.name).sort();
  assert.deepEqual(await names(''), ['Ana', 'Beto']);
  assert.deepEqual(await names(String(st.id)), ['Ana']);
  assert.deepEqual(await names('sem'), ['Beto']);
});

test('tela do funil: cria, categoriza o contato pela lista e filtra', async () => {
  const { app, db, client } = await setup();
  const cookie = await login(app, 'loja', 'loja-pass-123');
  const contact = await addContact(db, client.id, '+5511900000006', 'Carla');

  const start = await app.inject({ method: 'GET', url: '/painel/funil', headers: { cookie } });
  assert.equal(start.statusCode, 200);
  assert.match(start.body, /value="Orçamento"/, 'etapa padrão já existe');

  const created = await app.inject({ method: 'POST', url: '/painel/funil', ...form(cookie, { nome: 'Visita agendada' }) });
  assert.match(created.body, /Etapa “Visita agendada” criada/);
  const dup = await app.inject({ method: 'POST', url: '/painel/funil', ...form(cookie, { nome: 'visita agendada' }) });
  assert.equal(dup.statusCode, 400);
  assert.match(dup.body, /Já existe/);

  const stage = (await listStages(db, client.id)).find((s) => s.name === 'Visita agendada');
  const list = await app.inject({ method: 'GET', url: '/painel', headers: { cookie } });
  assert.match(list.body, /Visita agendada/);
  assert.match(list.body, /Todas as etapas/);

  const pick = await app.inject({
    method: 'POST',
    url: `/painel/contatos/${contact.id}/etapa`,
    ...form(cookie, { etapa: String(stage!.id) }, HX),
  });
  assert.equal(pick.statusCode, 200);
  assert.match(pick.body, new RegExp(`<option value="${stage!.id}" selected>`));
  assert.equal((await db.query.contacts.findFirst({ where: eq(contacts.id, contact.id) }))?.stageId, stage!.id);

  const filtered = await app.inject({ method: 'GET', url: `/painel?etapa=${stage!.id}`, headers: { cookie } });
  assert.match(filtered.body, /Carla/);
  const none = await app.inject({ method: 'GET', url: '/painel?etapa=sem', headers: { cookie } });
  assert.doesNotMatch(none.body, /Carla/);

  const del = await app.inject({ method: 'POST', url: `/painel/funil/${stage!.id}/excluir`, ...form(cookie, {}) });
  assert.match(del.body, /1 contato ficou sem etapa/);
});

test('funil exige login de cliente e o modelo só vale para funil vazio', async () => {
  const { app, db, client } = await setup();
  const anon = await app.inject({ method: 'GET', url: '/painel/funil' });
  assert.notEqual(anon.statusCode, 200);

  const cookie = await login(app, 'loja', 'loja-pass-123');
  // The default stage is there, so the template does nothing until the funnel is emptied.
  await app.inject({ method: 'POST', url: '/painel/funil/modelo', ...form(cookie, {}) });
  assert.equal((await listStages(db, client.id)).length, 1);
  const [only] = await listStages(db, client.id);
  const emptied = await app.inject({ method: 'POST', url: `/painel/funil/${only!.id}/excluir`, ...form(cookie, {}) });
  assert.match(emptied.body, /Usar modelo sugerido/);
  await app.inject({ method: 'POST', url: '/painel/funil/modelo', ...form(cookie, {}) });
  assert.equal((await listStages(db, client.id)).length, 4);
  await app.inject({ method: 'POST', url: '/painel/funil/modelo', ...form(cookie, {}) });
  assert.equal((await listStages(db, client.id)).length, 4);
});
