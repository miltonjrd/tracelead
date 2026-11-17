import {
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isLidUser,
  isPnUser,
  jidDecode,
  normalizeMessageContent,
  type Chat,
  type LIDMapping,
  type MessageUpsertType,
  type WAMessage,
} from 'baileys';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { contacts, knownChats, type Client } from '../db/schema.js';
import { extractRef } from '../lib/ref.js';
import { DAY_MS } from '../lib/time.js';
import { isRealMessage, type HistoryProbe } from './historyProbe.js';
import { handleInboundMessage } from './tracking.js';

export interface UpsertLog {
  info(obj: object, msg: string): void;
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

// `append` carries history and what arrived while the socket was down. Only the last day counts:
// enough to recover leads from a short outage without importing old chats as new contacts.
const APPEND_MAX_AGE_MS = DAY_MS;

const isOneToOne = (jid: string) => isPnUser(jid) || isLidUser(jid);

/**
 * Remembers the phones of the 1:1 chats in the history WhatsApp sends after pairing, so a customer who
 * already talked to the store doesn't become a new lead when they write again. Returns how many were new.
 */
export async function recordHistoryChats(
  db: Db,
  clientId: number,
  set: { chats: Chat[]; messages: WAMessage[]; lidPnMappings?: LIDMapping[] },
  lookupPn: LidLookup,
  now = Date.now(),
): Promise<number> {
  const pnByLid = new Map((set.lidPnMappings ?? []).map((x) => [x.lid, x.pn]));
  const jids = new Map<string, string | undefined>();
  for (const c of set.chats) if (c.id && isOneToOne(c.id)) jids.set(c.id, c.pnJid ?? undefined);
  for (const m of set.messages) {
    const jid = m.key.remoteJid;
    if (jid && isOneToOne(jid) && !jids.has(jid) && isRealMessage(m)) jids.set(jid, m.key.remoteJidAlt ?? undefined);
  }
  const phones = new Set<string>();
  for (const [jid, alt] of jids) {
    let pn: string | null | undefined = isPnUser(jid) ? jid : alt && isPnUser(alt) ? alt : pnByLid.get(jid);
    if (!pn) pn = await lookupPn(jid).catch(() => null);
    const user = pn && isPnUser(pn) ? jidDecode(pn)?.user : undefined;
    if (user) phones.add(`+${user}`);
  }
  const rows = [...phones].map((phone) => ({ clientId, phone, source: 'historico' as const, createdAt: now }));
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const r = await db.insert(knownChats).values(rows.slice(i, i + 500)).onConflictDoNothing().returning({ phone: knownChats.phone });
    added += r.length;
  }
  return added;
}

/**
 * A message from someone who isn't a contact yet, in a chat that already had messages before TraceLead
 * saw it, is an old conversation and not a lead. Known from the pairing history, or by asking the phone.
 */
async function isOldChat(db: Db, client: Client, phone: string, m: WAMessage, probe: HistoryProbe | undefined, log: UpsertLog) {
  const isContact = await db.query.contacts.findFirst({
    columns: { id: true },
    where: and(eq(contacts.clientId, client.id), eq(contacts.phone, phone)),
  });
  if (isContact) return false;
  const known = await db.query.knownChats.findFirst({ where: and(eq(knownChats.clientId, client.id), eq(knownChats.phone, phone)) });
  if (known) return true;
  if (!probe) return false;
  const verdict = await probe(m);
  if (verdict === 'sem_resposta') log.warn({ clientId: client.id, reason: 'historico-sem-resposta' }, 'celular não respondeu se a conversa já existia, contato criado');
  if (verdict !== 'antiga') return false;
  await db.insert(knownChats).values({ clientId: client.id, phone, source: 'consulta', createdAt: Date.now() }).onConflictDoNothing();
  return true;
}

export async function processUpsert(
  db: Db,
  client: Client,
  upsert: { messages: WAMessage[]; type: MessageUpsertType },
  lookupPn: LidLookup,
  log: UpsertLog,
  now = Date.now(),
  probe?: HistoryProbe,
): Promise<number> {
  // Grouped by phone: each chat keeps its message order, and one chat waiting on the phone's answer
  // doesn't hold up the others.
  const byPhone = new Map<string, WAMessage[]>();
  for (const m of upsert.messages) {
    try {
      if (upsert.type === 'append' && !(now - Number(m.messageTimestamp) * 1000 <= APPEND_MAX_AGE_MS)) continue;
      const jid = m.key.remoteJid;
      if (!jid || m.key.fromMe || isJidGroup(jid) || isJidBroadcast(jid) || isJidNewsletter(jid)) continue;
      const phone = await senderPhone(m, lookupPn);
      if (!phone) {
        log.warn({ clientId: client.id, reason: 'lid-sem-telefone' }, 'mensagem do WhatsApp sem telefone do remetente');
        continue;
      }
      byPhone.set(phone, [...(byPhone.get(phone) ?? []), m]);
    } catch (err) {
      log.error({ err, clientId: client.id }, 'falha ao processar mensagem do WhatsApp');
    }
  }

  const handled = await Promise.all(
    [...byPhone].map(async ([phone, msgs]) => {
      let n = 0;
      for (const m of msgs) {
        try {
          const ref = extractRef(messageText(m));
          // A ref means the message came from a click on the site or an ad: it counts even for an old customer.
          if (!ref && (await isOldChat(db, client, `+${phone}`, m, probe, log))) {
            log.info({ clientId: client.id, reason: 'conversa-antiga' }, 'mensagem de conversa antiga ignorada');
            continue;
          }
          const ts = Number(m.messageTimestamp) * 1000;
          await handleInboundMessage(db, client, {
            from: phone,
            name: m.pushName?.slice(0, 120) || null,
            timestamp: Number.isFinite(ts) && ts > 0 ? ts : now,
            ref,
          });
          n++;
        } catch (err) {
          log.error({ err, clientId: client.id }, 'falha ao processar mensagem do WhatsApp');
        }
      }
      return n;
    }),
  );
  return handled.reduce((a, b) => a + b, 0);
}
