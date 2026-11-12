import { Cron } from 'croner';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { clients } from '../db/schema.js';
import { syncAdSpend } from './adSpend.js';
import { runBackup } from './backup.js';
import { clientGoogleAdsConfigured } from '../services/googleAdsSettings.js';
import { runJob } from './runs.js';

export function startJobs(db: Db, config: Config, log: FastifyBaseLogger): () => void {
  const opts = { timezone: config.jobsTimezone, protect: true };

  const backup = new Cron('0 3 * * *', opts, async () => {
    const r = await runJob(db, 'backup', null, () => runBackup(db, config));
    log[r.ok ? 'info' : 'error']({ job: 'backup' }, r.detail);
  });

  const spend = new Cron('0 6 * * *', opts, async () => {
    const list = await db.select().from(clients).where(and(isNotNull(clients.googleAdsCustomerId), eq(clients.active, true)));
    for (const client of list) {
      if (!clientGoogleAdsConfigured(config, client)) continue;
      const r = await runJob(db, 'ad_spend', client.id, () => syncAdSpend(db, config, client));
      log[r.ok ? 'info' : 'error']({ job: 'ad_spend', clientId: client.id }, r.detail);
    }
  });

  return () => {
    backup.stop();
    spend.stop();
  };
}
