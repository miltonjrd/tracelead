import makeWASocket, { Browsers, fetchLatestWaWebVersion, makeCacheableSignalKeyStore, type AuthenticationState } from 'baileys';
import { drainOfflineBatches } from './offlineDrain.js';
import type { SessionLog, SocketFactory } from './whatsappSessions.js';

/** Baileys wants an ILogger (pino-shaped); only warnings and errors are worth keeping. */
function baileysLogger(log: SessionLog) {
  const logger = {
    level: 'warn',
    child: () => logger,
    trace() {},
    debug() {},
    info() {},
    warn: (obj: unknown, msg?: string) => log.warn(typeof obj === 'object' && obj ? obj : { obj }, msg ?? 'baileys'),
    error: (obj: unknown, msg?: string) => log.error(typeof obj === 'object' && obj ? obj : { obj }, msg ?? 'baileys'),
  };
  return logger;
}

/**
 * The only place that talks to Baileys. TraceLead just listens: never marked online (the
 * store keeps getting notifications on the phone), nothing is sent to customers. The default history
 * sync stays on: Baileys gets its first LID mappings from it, and TraceLead records which chats already
 * existed (`messaging-history.set`) so old customers don't turn into new leads. The only thing sent is
 * an on-demand history request to the store's own phone, when an unknown number writes without a ref.
 */
export const createBaileysSocket: SocketFactory = async (auth: AuthenticationState, log) => {
  const logger = baileysLogger(log);
  // Falls back to the version bundled in Baileys when the lookup fails or is not the latest.
  const latest = await fetchLatestWaWebVersion().catch(() => undefined);
  const sock = makeWASocket({
    auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.keys, logger) },
    ...(latest?.isLatest ? { version: latest.version } : {}),
    browser: Browsers.ubuntu('TraceLead'),
    logger,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    getMessage: async () => undefined,
  });
  drainOfflineBatches(sock, log);
  return sock;
};
