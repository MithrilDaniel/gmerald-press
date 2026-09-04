// The holder count, from the explorer (its API refuses browsers on other origins, so the
// bot reads it and writes it into the stats). Falls back to the last known value.
import { cfg } from './env.js';
import { readFileSync } from 'node:fs';
import { statsPath } from './ledger.js';

export async function readHolders(): Promise<number | undefined> {
  try {
    const res = await fetch(`https://robinhoodchain.blockscout.com/api/v2/tokens/${cfg.token}/counters`, {
      headers: { 'User-Agent': 'gmerald-press/1.0 (+https://gmerald.xyz)', Accept: 'application/json' },
    });
    if (res.ok) { const j = (await res.json()) as any; const n = Number(j.token_holders_count); if (n > 0) return n; }
    console.log(`[holders] explorer said ${res.status}`);
  } catch (e: any) { console.log(`[holders] ${e.message}`); }
  try { const prev = JSON.parse(readFileSync(statsPath(), 'utf8')).holders; if (prev) return Number(prev); } catch {}
  return undefined;
}
