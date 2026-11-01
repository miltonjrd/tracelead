import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db/client.js';
import { startJobs } from './jobs/scheduler.js';
import { createBaileysSocket } from './services/baileysSocket.js';
import { WhatsAppSessions } from './services/whatsappSessions.js';

const config = loadConfig();
const db = openDb(config.databasePath);
// The sessions log through the app's logger, which only exists once the app is built.
const sessionLog = {
  info: (obj: object, msg: string) => app.log.info(obj, msg),
  warn: (obj: object, msg: string) => app.log.warn(obj, msg),
  error: (obj: object, msg: string) => app.log.error(obj, msg),
};
const sessions = new WhatsAppSessions(db, {
  maxSessions: config.whatsapp.maxSessions,
  socketFactory: createBaileysSocket,
  log: sessionLog,
});
const app = await buildApp({ config, db, sessions, logger: { level: process.env.LOG_LEVEL ?? 'info' } });

const stopJobs = config.enableJobs ? startJobs(db, config, app.log) : () => {};

async function shutdown(signal: string) {
  app.log.info(`${signal} recebido, encerrando`);
  stopJobs();
  await app.close();
  db.$client.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.port, host: config.host });
