// The site's live data: press-ledger.json (every press, forever) and
// press-stats.json (the status-bar numbers). The workflow commits both after
// a press, Vercel redeploys, and the terminal reads them — nothing is
// reported, it is read.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cfg } from './env.js';
import { boardSeats } from './holders.js';
import { readRank, type Rank } from './gmerank.js';

export type Kind = 'press' | 'snack';
export type PressEntry = {
  kind?: Kind; // press = a claim landing in the stash; snack = one burn slice
  k?: number;  // index within its kind
  n: number;
  ts: string;
  note: string;
  burnedGmerald: string;
  burnGmeSpent: string;
  stashedGme: string;
  opsMovedGme: string;
  pegStatus: string;
  gmeUsd?: number;   // the stock's fair price (chainlink) when this row was written; cost basis for the stash and the pool
  burnTx?: string;
  stashTx?: string;
  opsTx?: string;
  explorer: string;
};

export type Stats = {
  presses: number;
  burnedPct: string;
  stashGme: string;
  gmeSunk: string;
  status: string;
  updatedAt: string | null;
  checkedAt?: string;
  peg?: { status: string; premiumBps?: number; tokenUsd?: number; fairUsd?: number; note: string };
  curve?: { raisedGme: string; thresholdGme: string; pct: number };
  cadenceMin?: number;
  snacks?: number;
  queuedGme?: string;
  sliceGme?: string;
  slicesLeft?: number;
  days?: Record<string, { snacks: number; gme: number; burned: number }>;
  holders?: number;
  seats?: number;   // board seats: wallets at 250,000 $gmerald or more, infra excluded
  gmeRank?: Rank;   // where the stash ranks among holders of tokenized gme, pools and protocol contracts excluded
  basis?: Basis;
};

// What the stash and the pool's gme were worth when they arrived, from each row's gmeUsd.
export type Basis = { stashCostUsd: number; stashAvgUsd: number; fedCostUsd: number; pricedGme: number; totalGme: number };
export function costBasis(): Basis {
  let sc = 0, sg = 0, fc = 0, tg = 0;
  for (const p of readArchive()) { const st = Number(p.stashedGme || 0), fed = Number(p.burnGmeSpent || 0), px = Number(p.gmeUsd || 0); tg += st; if (px > 0) { sc += st * px; sg += st; fc += fed * px; } }
  const r = (x: number) => Math.round(x * 100) / 100;
  return { stashCostUsd: r(sc), stashAvgUsd: sg > 0 ? r(sc / sg) : 0, fedCostUsd: r(fc), pricedGme: r(sg), totalGme: r(tg) };
}

const ledgerPath = () => join(cfg.siteDir, 'press-ledger.json');
export const statsPath = () => join(cfg.siteDir, "press-stats.json");

export type Totals = { press: number; snack: number; burnGme: number; stashedGme: number; burnedGmerald: number };
// The page reads press-ledger.json: every press plus the latest snacks, and all-time totals.
// press-ledger-all.json is the full archive, appended forever, never fetched by the page.
export type Ledger = { presses: PressEntry[]; totals?: Totals; stashScanBlock?: string };
const archivePath = () => join(cfg.siteDir, 'press-ledger-all.json');
function readArchive(): PressEntry[] {
  try { return JSON.parse(readFileSync(archivePath(), 'utf8')).presses; } catch { return readLedger().presses; }
}
function sumTotals(all: PressEntry[]): Totals {
  const t: Totals = { press: 0, snack: 0, burnGme: 0, stashedGme: 0, burnedGmerald: 0 };
  for (const p of all) { t[(p.kind ?? 'press')]++; t.burnGme += Number(p.burnGmeSpent || 0); t.stashedGme += Number(p.stashedGme || 0); t.burnedGmerald += Number(p.burnedGmerald || 0); }
  return t;
}
export const totals = (): Totals => readLedger().totals ?? sumTotals(readArchive());
// Per-day rollup of snacks (utc days), last 7 days, for the site's today/yesterday lines.
export function dailyRollup(): Record<string, { snacks: number; gme: number; burned: number }> {
  const out: Record<string, { snacks: number; gme: number; burned: number }> = {};
  for (const p of readArchive()) {
    if (p.kind !== 'snack') continue; const d = p.ts.slice(0, 10);
    out[d] ??= { snacks: 0, gme: 0, burned: 0 }; out[d].snacks++; out[d].gme += Number(p.burnGmeSpent || 0); out[d].burned += Number(p.burnedGmerald || 0);
  }
  return Object.fromEntries(Object.entries(out).sort().slice(-7));
}
const RECENT_SNACKS = 48, RECENT_PRESSES = 12;
export function readLedger(): Ledger {
  try {
    return JSON.parse(readFileSync(ledgerPath(), 'utf8'));
  } catch {
    return { presses: [] };
  }
}
export function writeLedger(ledger: Ledger): void { writeFileSync(ledgerPath(), JSON.stringify(ledger, null, 1)); }
export const countKind = (kind: Kind) => totals()[kind];
export const hasTx = (tx: string) => readArchive().some((p) => p.stashTx === tx || p.burnTx === tx);

export function appendPress(entry: Omit<PressEntry, 'n' | 'ts' | 'explorer'>): PressEntry {
  const all = readArchive();
  const kind: Kind = entry.kind ?? 'press';
  const full: PressEntry = {
    n: all.length + 1,
    ts: new Date().toISOString(),
    explorer: cfg.explorer,
    ...entry,
    kind,
    k: all.filter((p) => (p.kind ?? 'press') === kind).length + 1,
  };
  all.push(full);
  writeFileSync(archivePath(), JSON.stringify({ presses: all }, null, 1));
  const ledger = readLedger();
  const presses = all.filter((p) => (p.kind ?? 'press') === 'press').slice(-RECENT_PRESSES);
  const snacks = all.filter((p) => p.kind === 'snack').slice(-RECENT_SNACKS);
  ledger.presses = [...presses, ...snacks].sort((a, b) => a.n - b.n);
  ledger.totals = sumTotals(all);
  writeFileSync(ledgerPath(), JSON.stringify(ledger, null, 1));
  return full;
}

export function writeStats(stats: Stats): void {
  writeFileSync(statsPath(), JSON.stringify({ ...stats, seats: boardSeats(), gmeRank: readRank(), basis: costBasis() }, null, 1));
}

// Cumulative GME the burns pushed into the curve/pool — part of "GME sunk".
export function burnGmeTotal(): number { return totals().burnGme; }
