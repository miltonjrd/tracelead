import { randomBytes } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { clients, sessions, users, type Client } from '../db/schema.js';
import { hashPassword, hashToken, verifyPassword } from './auth.js';
import { ensureDefaultStages } from './funnel.js';

export interface ClientInput {
  name: string;
  timezone?: string;
  currency?: string;
  googleAdsCustomerId?: string | null;
  whatsappPhoneNumberId?: string | null;
  whatsappMode?: string;
}

export function checkWhatsappMode(mode: string): 'baileys' | 'cloud' {
  if (mode !== 'baileys' && mode !== 'cloud') throw new Error(`Modo de WhatsApp inválido: ${mode}`);
  return mode;
}

function cleanCustomerId(id: string | null | undefined): string | null | undefined {
  return id === undefined || id === null ? id : id.replace(/\D/g, '') || null;
}

function checkTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
  } catch {
    throw new Error(`Fuso horário inválido: ${tz}`);
  }
}

export async function createClient(db: Db, input: ClientInput, now = Date.now()): Promise<Client> {
  if (input.timezone) checkTimezone(input.timezone);
  const whatsappMode = input.whatsappMode === undefined ? undefined : checkWhatsappMode(input.whatsappMode);
  const [client] = await db
    .insert(clients)
    .values({
      name: input.name,
      publicKey: randomBytes(9).toString('base64url'),
      timezone: input.timezone ?? 'America/Sao_Paulo',
      currency: input.currency ?? 'BRL',
      googleAdsCustomerId: cleanCustomerId(input.googleAdsCustomerId) ?? null,
      whatsappPhoneNumberId: input.whatsappPhoneNumberId || null,
      ...(whatsappMode ? { whatsappMode } : {}),
      createdAt: now,
    })
    .returning();
  await ensureDefaultStages(db, client!.id, now);
  return client!;
}

export async function updateClient(db: Db, id: number, input: Partial<ClientInput>): Promise<Client> {
  if (input.timezone) checkTimezone(input.timezone);
  const set: Partial<typeof clients.$inferInsert> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.timezone !== undefined) set.timezone = input.timezone;
  if (input.currency !== undefined) set.currency = input.currency;
  if (input.googleAdsCustomerId !== undefined) set.googleAdsCustomerId = cleanCustomerId(input.googleAdsCustomerId);
  if (input.whatsappPhoneNumberId !== undefined) set.whatsappPhoneNumberId = input.whatsappPhoneNumberId || null;
  if (input.whatsappMode !== undefined) set.whatsappMode = checkWhatsappMode(input.whatsappMode);
  const [client] = await db.update(clients).set(set).where(eq(clients.id, id)).returning();
  if (!client) throw new Error(`Cliente ${id} não existe`);
  return client;
}

/** Deactivating locks the store's users out right away (open sessions end) and stops its tracking; data is kept. */
export async function setClientActive(db: Db, id: number, active: boolean): Promise<Client> {
  const [client] = await db.update(clients).set({ active }).where(eq(clients.id, id)).returning();
  if (!client) throw new Error(`Cliente ${id} não existe`);
  if (!active) {
    const storeUsers = await db.select({ id: users.id }).from(users).where(eq(users.clientId, id));
    for (const u of storeUsers) await db.delete(sessions).where(eq(sessions.userId, u.id));
  }
  return client;
}

export function generatePassword(): string {
  return randomBytes(12).toString('base64url');
}

export async function createUser(
  db: Db,
  input: { username: string; password: string; role: 'admin' | 'client'; clientId?: number | null; mustChangePassword?: boolean },
  now = Date.now(),
) {
  if (input.role === 'client' && !input.clientId) throw new Error('Usuário do tipo cliente precisa de um cliente');
  if (input.password.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres');
  const [user] = await db
    .insert(users)
    .values({
      username: input.username.trim().toLowerCase(),
      passwordHash: await hashPassword(input.password),
      role: input.role,
      clientId: input.role === 'admin' ? null : input.clientId!,
      mustChangePassword: input.mustChangePassword ?? false,
      createdAt: now,
    })
    .returning();
  return user!;
}

export async function setPassword(db: Db, username: string, password: string, mustChange = false): Promise<void> {
  if (password.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres');
  const [user] = await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: mustChange })
    .where(eq(users.username, username.trim().toLowerCase()))
    .returning();
  if (!user) throw new Error(`Usuário ${username} não existe`);
  await db.delete(sessions).where(eq(sessions.userId, user.id));
}

/** Self-service change: needs the current password, clears the first-access flag and ends the other sessions. */
export async function changeOwnPassword(db: Db, userId: number, current: string, next: string, keepToken: string): Promise<void> {
  if (next.length < 8) throw new Error('A nova senha precisa ter pelo menos 8 caracteres');
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || !(await verifyPassword(current, user.passwordHash))) throw new Error('A senha atual está incorreta');
  if (current === next) throw new Error('A nova senha precisa ser diferente da atual');
  await db.update(users).set({ passwordHash: await hashPassword(next), mustChangePassword: false }).where(eq(users.id, userId));
  await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, hashToken(keepToken))));
}
