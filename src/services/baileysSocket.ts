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
 * The only place that talks to Baileys. The tracker just listens: no history sync, never
 * marked online (the store keeps getting notifications on the phone), nothing is sent.
 */
export const createBaileysSocket: SocketFactory = async (auth: AuthenticationState, log) => {
  const logger = baileysLogger(log);
  // Falls back to the version bundled in Baileys when the lookup fails or is not the latest.
  const latest = await fetchLatestWaWebVersion().catch(() => undefined);
  return makeWASocket({
    auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.keys, logger) },
    ...(latest?.isLatest ? { version: latest.version } : {}),
    browser: Browsers.ubuntu('Tracker'),
    logger,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    markOnlineOnConnect: false,
    getMessage: async () => undefined,
  });
};
