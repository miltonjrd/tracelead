import makeWASocket, { Browsers, fetchLatestWaWebVersion, makeCacheableSignalKeyStore, type AuthenticationState } from 'baileys';
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
 * store keeps getting notifications on the phone), nothing is sent. The default history sync stays
 * on because Baileys gets its first LID mappings from it; its messages arrive in a different event
 * than `messages.upsert`, which is the only one TraceLead handles.
 */
export const createBaileysSocket: SocketFactory = async (auth: AuthenticationState, log) => {
  const logger = baileysLogger(log);
  // Falls back to the version bundled in Baileys when the lookup fails or is not the latest.
  const latest = await fetchLatestWaWebVersion().catch(() => undefined);
  return makeWASocket({
    auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.keys, logger) },
    ...(latest?.isLatest ? { version: latest.version } : {}),
    browser: Browsers.ubuntu('TraceLead'),
    logger,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    getMessage: async () => undefined,
  });
};
