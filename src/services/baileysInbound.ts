import {
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isLidUser,
  isPnUser,
  jidDecode,
  normalizeMessageContent,
  type MessageUpsertType,
  type WAMessage,
} from 'baileys';
import type { Db } from '../db/client.js';
import type { Client } from '../db/schema.js';
import { extractRef } from '../lib/ref.js';
import { handleInboundMessage } from './tracking.js';

export interface UpsertLog {
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** Maps a LID to its phone-number JID (Baileys' lidMapping), or null when unknown. */
export type LidLookup = (lid: string) => Promise<string | null>;

// The text is read only to find the ref and is never stored.
function messageText(m: WAMessage): string {
  const c = normalizeMessageContent(m.message);
  return (
    c?.conversation ??
    c?.extendedTextMessage?.text ??
    c?.buttonsResponseMessage?.selectedDisplayText ??
    c?.listResponseMessage?.title ??
    c?.templateButtonReplyMessage?.selectedDisplayText ??
    ''
  );
}

async function senderPhone(m: WAMessage, lookup: LidLookup): Promise<string | null> {
  const jid = m.key.remoteJid;
  if (!jid) return null;
  if (isPnUser(jid)) return jidDecode(jid)?.user ?? null;
  if (!isLidUser(jid)) return null;
  const alt = m.key.remoteJidAlt;
  const pn = alt && isPnUser(alt) ? alt : await lookup(jid);
  return pn && isPnUser(pn) ? (jidDecode(pn)?.user ?? null) : null;
}

export async function processUpsert(
  db: Db,
  client: Client,
  upsert: { messages: WAMessage[]; type: MessageUpsertType },
  lookupPn: LidLookup,
  log: UpsertLog,
  now = Date.now(),
): Promise<number> {
  if (upsert.type !== 'notify') return 0;
  let handled = 0;
  for (const m of upsert.messages) {
    try {
      const jid = m.key.remoteJid;
      if (!jid || m.key.fromMe || isJidGroup(jid) || isJidBroadcast(jid) || isJidNewsletter(jid)) continue;
      const phone = await senderPhone(m, lookupPn);
      if (!phone) {
        log.warn({ clientId: client.id, reason: 'lid-sem-telefone' }, 'mensagem do WhatsApp sem telefone do remetente');
        continue;
      }
      const ts = Number(m.messageTimestamp) * 1000;
      await handleInboundMessage(db, client, {
        from: phone,
        name: m.pushName?.slice(0, 120) || null,
        timestamp: Number.isFinite(ts) && ts > 0 ? ts : now,
        ref: extractRef(messageText(m)),
      });
      handled++;
    } catch (err) {
      log.error({ err, clientId: client.id }, 'falha ao processar mensagem do WhatsApp');
    }
  }
  return handled;
}
