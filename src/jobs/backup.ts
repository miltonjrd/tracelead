import { execFile } from 'node:child_process';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';

const execFileAsync = promisify(execFile);

export async function runBackup(db: Db, config: Config, now = Date.now()): Promise<string> {
  await mkdir(config.backupDir, { recursive: true });
  const file = join(config.backupDir, `tracker-${new Date(now).toISOString().replace(/[:.]/g, '-')}.db`);
  await db.$client.backup(file);

  const old = (await readdir(config.backupDir)).filter((f) => /^tracker-.+\.db$/.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - config.backupKeep))) await rm(join(config.backupDir, f));

  let remote = '';
  if (config.rcloneRemote) {
    await execFileAsync('rclone', ['copy', file, config.rcloneRemote], { timeout: 10 * 60 * 1000 });
    remote = ` e copiado para ${config.rcloneRemote}`;
  }
  const kb = Math.ceil((await stat(file)).size / 1024);
  return `${basename(file)} (${kb} KB)${remote}`;
}
