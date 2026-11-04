import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { clients } from '../db/schema.js';
import { extractRef } from '../lib/ref.js';
import { handleInboundMessage } from './tracking.js';

export function validSignature(rawBody: string, header: unknown, appSecret: string): boolean {
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex'));
  const actual = Buffer.from(header.slice('sha256='.length));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Shapes of the Cloud API "messages" webhook that we read. Message text is used only to find
// the ref and is never stored.
interface WaMessage {
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
}
interface WaValue {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: WaMessage[];
}
interface WaPayload {
  entry?: { changes?: { field?: string; value?: WaValue }[] }[];
}

function messageText(m: WaMessage): string {
  return (
    m.text?.body ??
    m.button?.text ??
    m.interactive?.button_reply?.title ??
    m.interactive?.list_reply?.title ??
    ''
  );
}

export interface WebhookResult {
  messages: number;
  unknownPhoneNumberIds: string[];
}

export async function processWebhook(db: Db, payload: unknown, now = Date.now()): Promise<WebhookResult> {
  const result: WebhookResult = { messages: 0, unknownPhoneNumberIds: [] };
  const body = payload as WaPayload;
  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      // Coexistence also sends "smb_message_echoes" (what the business typed in the app); skip those.
      if (change.field !== 'messages' || !change.value?.messages?.length) continue;
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const client = await db.query.clients.findFirst({ where: eq(clients.whatsappPhoneNumberId, phoneNumberId) });
      // A client on Baileys gets its messages from its own session, never from this webhook.
      if (client && client.whatsappMode !== 'cloud') continue;
      if (!client) {
        result.unknownPhoneNumberIds.push(phoneNumberId);
        continue;
      }
      if (!client.active) continue;
      const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]));
      for (const m of value.messages ?? []) {
        if (!m.from) continue;
        const ts = Number(m.timestamp) * 1000;
        await handleInboundMessage(db, client, {
          from: m.from,
          name: names.get(m.from)?.slice(0, 120) ?? null,
          timestamp: Number.isFinite(ts) && ts > 0 ? ts : now,
          ref: extractRef(messageText(m)),
        });
        result.messages++;
      }
    }
  }
  return result;
}
