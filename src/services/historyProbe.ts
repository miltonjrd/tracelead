import { normalizeMessageContent, proto, type BaileysEventEmitter, type WAMessage, type WAMessageKey } from 'baileys';

/** Answer to "did this chat have messages before this one?": `sem_resposta` when the phone didn't reply in time. */
export type ProbeVerdict = 'antiga' | 'nova' | 'sem_resposta';
export type HistoryProbe = (m: WAMessage) => Promise<ProbeVerdict>;

/** The slice of a Baileys socket the probe needs; tests pass a fake. */
export interface ProbeSocket {
  ev: Pick<BaileysEventEmitter, 'on'>;
  fetchMessageHistory(count: number, oldestMsgKey: WAMessageKey, oldestMsgTimestamp: number): Promise<string>;
}

export const PROBE_TIMEOUT_MS = 15_000;
// One earlier message is enough to call the chat old; a few more cover stubs and protocol messages.
const PROBE_COUNT = 10;

const NOT_CONTENT = new Set(['protocolMessage', 'senderKeyDistributionMessage', 'messageContextInfo']);

/** True for a message someone wrote (text, media, reaction...), false for stubs like "messages are encrypted". */
export function isRealMessage(m: WAMessage): boolean {
  if (m.messageStubType) return false;
  const c = normalizeMessageContent(m.message);
  return !!c && Object.keys(c).some((k) => !NOT_CONTENT.has(k) && (c as Record<string, unknown>)[k] != null);
}

/**
 * Asks the store's phone for the messages before `m` in its chat (WhatsApp's on-demand history sync).
 * The reply comes back as a `messaging-history.set` of type ON_DEMAND; it is read only to see whether
 * an earlier message exists, nothing from it is stored. The phone may be offline or ignore the request,
 * so after PROBE_TIMEOUT_MS the answer is `sem_resposta`.
 */
export function createHistoryProbe(
  sock: ProbeSocket,
  schedule: (fn: () => void, ms: number) => () => void = (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref();
    return () => clearTimeout(t);
  },
): HistoryProbe {
  const waiting = new Map<string, Set<(msgs: WAMessage[]) => void>>();

  sock.ev.on('messaging-history.set', ({ syncType, chats, messages }) => {
    if (syncType !== proto.HistorySync.HistorySyncType.ON_DEMAND) return;
    const byJid = new Map<string, WAMessage[]>();
    for (const c of chats) if (c.id) byJid.set(c.id, []);
    for (const m of messages) {
      const jid = m.key.remoteJid;
      if (jid) byJid.set(jid, [...(byJid.get(jid) ?? []), m]);
    }
    for (const [jid, msgs] of byJid) for (const fn of [...(waiting.get(jid) ?? [])]) fn(msgs);
  });

  return (m) =>
    new Promise<ProbeVerdict>((resolve) => {
      const jids = [m.key.remoteJid, m.key.remoteJidAlt].filter((j): j is string => !!j);
      const tsMs = Number(m.messageTimestamp) * 1000;
      let cancel = () => {};
      const finish = (v: ProbeVerdict) => {
        cancel();
        for (const j of jids) {
          waiting.get(j)?.delete(onReply);
          if (!waiting.get(j)?.size) waiting.delete(j);
        }
        resolve(v);
      };
      const onReply = (msgs: WAMessage[]) =>
        finish(msgs.some((x) => x.key.id !== m.key.id && isRealMessage(x) && Number(x.messageTimestamp) * 1000 <= tsMs) ? 'antiga' : 'nova');
      for (const j of jids) waiting.set(j, (waiting.get(j) ?? new Set()).add(onReply));
      cancel = schedule(() => finish('sem_resposta'), PROBE_TIMEOUT_MS);
      sock.fetchMessageHistory(PROBE_COUNT, m.key, tsMs).catch(() => finish('sem_resposta'));
    });
}
