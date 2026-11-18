import { and, asc, count, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { contacts, funnelStages, type FunnelStage } from '../db/schema.js';
import { PanelError } from './panel.js';

export const MAX_STAGES = 20;
export const MAX_STAGE_NAME = 40;

export interface StageWithCount extends FunnelStage {
  contacts: number;
}

export async function listStages(db: Db, clientId: number): Promise<FunnelStage[]> {
  return db
    .select()
    .from(funnelStages)
    .where(eq(funnelStages.clientId, clientId))
    .orderBy(asc(funnelStages.position), asc(funnelStages.id));
}

export async function listStagesWithCounts(db: Db, clientId: number): Promise<StageWithCount[]> {
  const stages = await listStages(db, clientId);
  const rows = await db
    .select({ stageId: contacts.stageId, n: count() })
    .from(contacts)
    .where(eq(contacts.clientId, clientId))
    .groupBy(contacts.stageId);
  const byStage = new Map(rows.map((r) => [r.stageId, r.n]));
  return stages.map((s) => ({ ...s, contacts: byStage.get(s.id) ?? 0 }));
}

function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!name) throw new PanelError('Digite o nome da etapa.');
  if (name.length > MAX_STAGE_NAME) throw new PanelError(`O nome da etapa pode ter até ${MAX_STAGE_NAME} letras.`);
  return name;
}

async function requireStage(db: Db, clientId: number, stageId: number): Promise<FunnelStage> {
  const stage = await db.query.funnelStages.findFirst({
    where: and(eq(funnelStages.id, stageId), eq(funnelStages.clientId, clientId)),
  });
  if (!stage) throw new PanelError('Etapa não encontrada.');
  return stage;
}

async function assertNameFree(db: Db, clientId: number, name: string, exceptId?: number): Promise<void> {
  const clash = (await listStages(db, clientId)).find(
    (s) => s.id !== exceptId && s.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'),
  );
  if (clash) throw new PanelError(`Já existe uma etapa chamada "${clash.name}".`);
}

export async function createStage(db: Db, clientId: number, rawName: unknown, now = Date.now()): Promise<FunnelStage> {
  const name = cleanName(rawName);
  const stages = await listStages(db, clientId);
  if (stages.length >= MAX_STAGES) throw new PanelError(`O funil pode ter até ${MAX_STAGES} etapas.`);
  await assertNameFree(db, clientId, name);
  const position = stages.length ? Math.max(...stages.map((s) => s.position)) + 1 : 0;
  const [stage] = await db.insert(funnelStages).values({ clientId, name, position, createdAt: now }).returning();
  return stage!;
}

export async function renameStage(db: Db, clientId: number, stageId: number, rawName: unknown): Promise<void> {
  const name = cleanName(rawName);
  await requireStage(db, clientId, stageId);
  await assertNameFree(db, clientId, name, stageId);
  await db.update(funnelStages).set({ name }).where(eq(funnelStages.id, stageId));
}

/** Swaps the stage with its neighbour; moving past either end does nothing. */
export async function moveStage(db: Db, clientId: number, stageId: number, direction: 'up' | 'down'): Promise<void> {
  await requireStage(db, clientId, stageId);
  const stages = await listStages(db, clientId);
  const i = stages.findIndex((s) => s.id === stageId);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= stages.length) return;
  const order = stages.map((s) => s.id);
  [order[i], order[j]] = [order[j]!, order[i]!];
  // Renumber the whole list so positions stay dense even if earlier deletes left gaps or ties.
  db.transaction((tx) => {
    order.forEach((id, position) => tx.update(funnelStages).set({ position }).where(eq(funnelStages.id, id)).run());
  });
}

/** Deletes the stage; its contacts stay in the system, just uncategorised. Returns how many were released. */
export async function deleteStage(db: Db, clientId: number, stageId: number): Promise<number> {
  await requireStage(db, clientId, stageId);
  return db.transaction((tx) => {
    const released = tx
      .update(contacts)
      .set({ stageId: null })
      .where(and(eq(contacts.clientId, clientId), eq(contacts.stageId, stageId)))
      .run().changes;
    tx.delete(funnelStages).where(eq(funnelStages.id, stageId)).run();
    return released;
  });
}

/** Puts the contact in a stage of the same client, or clears it with null. */
export async function setContactStage(db: Db, clientId: number, contactId: number, stageId: number | null): Promise<void> {
  const contact = await db.query.contacts.findFirst({
    where: and(eq(contacts.id, contactId), eq(contacts.clientId, clientId)),
  });
  if (!contact) throw new PanelError('Contato não encontrado');
  if (stageId !== null) await requireStage(db, clientId, stageId);
  await db.update(contacts).set({ stageId }).where(eq(contacts.id, contactId));
}

/** Form value to stage id: "" means no stage, anything else must be a positive integer. */
export function parseStageId(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new PanelError('Etapa inválida.');
  return n;
}


/** Every client starts with this stage (it replaced the old "Orçamento" button). */
export const DEFAULT_STAGES = ['Orçamento'] as const;

export const TEMPLATE_STAGES = ['Novo', 'Em conversa', 'Orçamento', 'Negociando'] as const;

/** Creates the default stages a client always starts with; safe to call again. */
export async function ensureDefaultStages(db: Db, clientId: number, now = Date.now()): Promise<void> {
  const have = new Set((await listStages(db, clientId)).map((s) => s.name.toLocaleLowerCase('pt-BR')));
  for (const name of DEFAULT_STAGES) {
    if (!have.has(name.toLocaleLowerCase('pt-BR'))) await createStage(db, clientId, name, now);
  }
}

/** One-tap starting point for a store with no funnel yet; does nothing if it already has stages. */
export async function createTemplateStages(db: Db, clientId: number, now = Date.now()): Promise<void> {
  if ((await listStages(db, clientId)).length) return;
  for (const name of TEMPLATE_STAGES) await createStage(db, clientId, name, now);
}
