import { BufferJSON, initAuthCreds, proto, type AuthenticationCreds, type AuthenticationState, type SignalDataSet, type SignalDataTypeMap } from 'baileys';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { whatsappAuth } from '../db/schema.js';

const CREDS_KEY = 'creds';

const encode = (value: unknown) => JSON.stringify(value, BufferJSON.replacer);
const decode = (text: string) => JSON.parse(text, BufferJSON.reviver);

export async function clearAuthState(db: Db, clientId: number): Promise<void> {
  await db.delete(whatsappAuth).where(eq(whatsappAuth.clientId, clientId));
}

/** Baileys' AuthenticationState kept in SQLite, one row per key. Unreadable saved creds are discarded. */
export async function loadAuthState(
  db: Db,
  clientId: number,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const row = await db.query.whatsappAuth.findFirst({
    where: and(eq(whatsappAuth.clientId, clientId), eq(whatsappAuth.key, CREDS_KEY)),
  });
  let creds: AuthenticationCreds | undefined;
  if (row) {
    try {
      creds = decode(row.value) as AuthenticationCreds;
    } catch {
      await clearAuthState(db, clientId);
    }
  }
  creds ??= initAuthCreds();

  const save = async (key: string, value: unknown) => {
    const now = Date.now();
    await db
      .insert(whatsappAuth)
      .values({ clientId, key, value: encode(value), updatedAt: now })
      .onConflictDoUpdate({ target: [whatsappAuth.clientId, whatsappAuth.key], set: { value: encode(value), updatedAt: now } });
  };

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const out: { [id: string]: SignalDataTypeMap[T] } = {};
          if (!ids.length) return out;
          const rows = await db
            .select()
            .from(whatsappAuth)
            .where(and(eq(whatsappAuth.clientId, clientId), inArray(whatsappAuth.key, ids.map((id) => `${type}-${id}`))));
          for (const r of rows) {
            let value = decode(r.value);
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            out[r.key.slice(type.length + 1)] = value;
          }
          return out;
        },
        set: async (data: SignalDataSet) => {
          const now = Date.now();
          db.transaction((tx) => {
            for (const category of Object.keys(data) as (keyof SignalDataSet)[]) {
              for (const [id, value] of Object.entries(data[category] ?? {})) {
                const key = `${category}-${id}`;
                if (value) {
                  tx.insert(whatsappAuth)
                    .values({ clientId, key, value: encode(value), updatedAt: now })
                    .onConflictDoUpdate({ target: [whatsappAuth.clientId, whatsappAuth.key], set: { value: encode(value), updatedAt: now } })
                    .run();
                } else {
                  tx.delete(whatsappAuth).where(and(eq(whatsappAuth.clientId, clientId), eq(whatsappAuth.key, key))).run();
                }
              }
            }
          });
        },
      },
    },
    saveCreds: () => save(CREDS_KEY, creds),
  };
}
