import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, lt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sessions, users, type User } from '../db/schema.js';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Sliding expiry is written at most once per hour, not on every request.
const RENEW_EVERY_MS = 60 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, key] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Compared against when the username does not exist, so response time doesn't reveal it.
let dummyHash: Promise<string> | null = null;

export async function authenticate(db: Db, username: string, password: string): Promise<User | null> {
  const user = await db.query.users.findFirst({ where: eq(users.username, username.trim().toLowerCase()) });
  if (!user) {
    dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
    await verifyPassword(password, await dummyHash);
    return null;
  }
  return (await verifyPassword(password, user.passwordHash)) ? user : null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(db: Db, userId: number, now = Date.now()): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: now + SESSION_TTL_MS,
    renewedAt: now,
    createdAt: now,
  });
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, now)));
  return token;
}

export interface SessionUser {
  id: number;
  username: string;
  role: 'admin' | 'client';
  clientId: number | null;
}

export async function resolveSession(
  db: Db,
  token: string,
  now = Date.now(),
): Promise<{ user: SessionUser; renewed: boolean } | null> {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      renewedAt: sessions.renewedAt,
      id: users.id,
      username: users.username,
      role: users.role,
      clientId: users.clientId,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, tokenHash));
  if (!row) return null;
  if (row.expiresAt <= now) {
    await db.delete(sessions).where(eq(sessions.id, row.sessionId));
    return null;
  }
  const renewed = now - row.renewedAt >= RENEW_EVERY_MS;
  if (renewed) {
    await db
      .update(sessions)
      .set({ expiresAt: now + SESSION_TTL_MS, renewedAt: now })
      .where(eq(sessions.id, row.sessionId));
  }
  const { id, username, role, clientId } = row;
  return { user: { id, username, role, clientId }, renewed };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}
