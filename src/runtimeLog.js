import fs from 'fs/promises';
import path from 'path';
import { getRuntimeConfig } from './db.js';

export async function appendRuntimeLog(message) {
  const cfg = getRuntimeConfig();
  await fs.mkdir(cfg.logsDir, { recursive: true });
  const file = path.join(cfg.logsDir, `${new Date().toISOString().slice(0, 10)}.log`);
  await fs.appendFile(file, `${new Date().toISOString()} ${String(message || '')}\n`, 'utf8').catch(() => {});
}
