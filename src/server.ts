import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db/client.js';
import { startJobs } from './jobs/scheduler.js';

const config = loadConfig();
const db = openDb(config.databasePath);
const app = await buildApp({ config, db, logger: { level: process.env.LOG_LEVEL ?? 'info' } });

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
