import type { SessionLog } from './whatsappSessions.js';

/** The slice of a Baileys socket the drain needs; tests pass a fake. */
export interface DrainSocket {
  ws: { on(event: string, fn: (...args: any[]) => void): unknown };
  sendNode(node: { tag: string; attrs: Record<string, string>; content?: unknown }): Promise<void>;
}

export const DRAIN_QUIET_MS = 5000;
export const DRAIN_MAX_REQUESTS = 50;

/**
 * WhatsApp delivers what was queued while offline in batches. Baileys asks for the first one (100 items)
 * and never again; with a bigger backlog the server waits for the next request, never sends the "offline
 * done" marker, and live messages stay behind it while the socket looks healthy (Baileys issue #2810).
 * After each quiet moment without frames this asks for the next batch, until the marker arrives.
 */
export function drainOfflineBatches(
  sock: DrainSocket,
  log: SessionLog,
  schedule: (fn: () => void, ms: number) => () => void = (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref();
    return () => clearTimeout(t);
  },
) {
  let draining = false;
  let requests = 0;
  let cancel: (() => void) | undefined;
  let startedAt = 0;

  const stop = () => {
    draining = false;
    cancel?.();
    cancel = undefined;
  };
  const arm = () => {
    cancel?.();
    cancel = schedule(next, DRAIN_QUIET_MS);
  };
  const next = () => {
    if (!draining) return;
    if (requests >= DRAIN_MAX_REQUESTS) {
      log.warn({ requests, afterSec: Math.round((Date.now() - startedAt) / 1000) }, 'whatsapp: limite de lotes offline atingido');
      return stop();
    }
    requests++;
    sock
      .sendNode({ tag: 'ib', attrs: {}, content: [{ tag: 'offline_batch', attrs: { count: '100' } }] })
      .then(arm)
      .catch(() => stop());
  };

  sock.ws.on('CB:ib,,offline_preview', () => {
    draining = true;
    requests = 0;
    startedAt = Date.now();
    arm();
  });
  sock.ws.on('frame', () => {
    if (draining) arm();
  });
  sock.ws.on('CB:ib,,offline', () => {
    // Logged on every reconnect that had a backlog, so a healthy 0 can be told apart from "never arrived".
    if (draining) log.info({ extraBatches: requests, afterSec: Math.round((Date.now() - startedAt) / 1000) }, 'whatsapp: fila offline concluída');
    stop();
  });
}
