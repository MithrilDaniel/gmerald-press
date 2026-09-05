// Where the stash ranks among holders of tokenized gme. The explorer blocks automated reads, so the
// bot keeps its own watch list: the explorer's top 50 (seeded by hand) plus any wallet that receives
// 200 gme or more in one transfer. Every hour it reads every watched balance and counts how many
// wallets hold more than the stash. Pools and protocol contracts are not wallets: a contract with a
// protocol name, or an unnamed contract with real code (over 300 bytes), is left out. Smart wallets
// (7702 delegations, safes, small proxies) count as holders.
import { parseAbiItem, formatUnits } from 'viem';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cfg } from './env.js';
import { pub } from './chain.js';

type W = { name?: string; code?: number; gme?: number; out?: boolean };
type State = { seededAt?: string; seed?: string; lastBlock?: string; at?: string; watch: Record<string, W>; rank?: number; of?: number; above?: { address: string; gme: number; name?: string }[] };
const path = () => join(cfg.siteDir, 'gme-rank.json');
const PROTOCOL = /pool|manager|locker|hook|initializer|escrow|curve|core|reflections|router|permit|bridge|vault|dividend|factory|quoter|position/i;
const BIG_TRANSFER = 200; // gme
const FORGET_UNDER = 100; // gme: a watched wallet under this cannot be above the stash; drop it

export type Rank = { rank: number; of: number; at: string };
export function readRank(): Rank | undefined {
  try { const st = JSON.parse(readFileSync(path(), 'utf8')) as State; return st.rank && st.at ? { rank: st.rank, of: st.of ?? 0, at: st.at } : undefined; } catch { return undefined; }
}

export async function gmeRank(): Promise<Rank | undefined> {
  let st: State; try { st = JSON.parse(readFileSync(path(), 'utf8')); } catch { return undefined; }
  if (st.at && Date.now() - new Date(st.at).getTime() < 55 * 60_000) return readRank();
  const stashAddr = String(cfg.stash).toLowerCase(); st.watch[stashAddr] ??= { name: 'the stash' };
  const latest = await pub.getBlockNumber();
  const ev = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
  let from = st.lastBlock ? BigInt(st.lastBlock) + 1n : latest - 40000n, step = 10000n, calls = 0;
  while (from <= latest && calls < 400) {
    const to = from + step - 1n > latest ? latest : from + step - 1n;
    try {
      const logs = await pub.getLogs({ address: cfg.gme, event: ev, fromBlock: from, toBlock: to }); calls++;
      for (const l of logs) { const t = (l.args.to as string).toLowerCase(); if (Number(formatUnits(l.args.value as bigint, 18)) >= BIG_TRANSFER && !st.watch[t]) st.watch[t] = {}; }
      from = to + 1n; st.lastBlock = to.toString();
    } catch (e: any) { calls++; if (step > 500n) { step /= 2n; continue; } console.log(`[gme-rank] scan stopped at ${st.lastBlock}: ${e.shortMessage || e.message}`); break; }
  }
  const abi = [parseAbiItem('function balanceOf(address) view returns (uint256)')];
  for (const [a, w] of Object.entries(st.watch)) {
    w.gme = Number(formatUnits(await pub.readContract({ address: cfg.gme, abi, functionName: 'balanceOf', args: [a as `0x${string}`] }), 18));
    if (w.code == null) { const c = await pub.getCode({ address: a as `0x${string}` }); w.code = c ? (c.length - 2) / 2 : 0; }
    w.out = a !== stashAddr && ((!!w.name && PROTOCOL.test(w.name)) || (!w.name && (w.code ?? 0) > 300));
  }
  const stash = st.watch[stashAddr].gme ?? 0;
  const holders = Object.entries(st.watch).filter(([, w]) => !w.out && (w.gme ?? 0) > 0);
  const above = holders.filter(([a, w]) => a !== stashAddr && (w.gme ?? 0) > stash).sort((x, y) => (y[1].gme ?? 0) - (x[1].gme ?? 0));
  st.rank = above.length + 1; st.of = holders.length; st.at = new Date().toISOString();
  st.above = above.map(([a, w]) => ({ address: a, gme: Math.round(w.gme ?? 0), name: w.name || undefined }));
  for (const [a, w] of Object.entries(st.watch)) if (a !== stashAddr && (w.gme ?? 0) < FORGET_UNDER) delete st.watch[a];
  writeFileSync(path(), JSON.stringify(st, null, 1));
  console.log(`[gme-rank] the stash (${stash.toFixed(0)} gme) is #${st.rank} among wallets, ${above.length} above it, ${st.of} watched`);
  return readRank();
}
