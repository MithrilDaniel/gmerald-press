// The holder count, from the chain: a balance map kept from every Transfer event since launch,
// updated incrementally each run (site/holders-state.json). The explorer blocks automated reads.
// v3 also remembers, per wallet, when it first received $gmerald and whether it has ever sold any
// (sent tokens into the pool; a transfer to another wallet is a move, not a sell). That is what "check your cheeks" on the site reads. Wallets that empty out are forgotten,
// so one that leaves and comes back starts over: "joined" is when the current position began.
import { parseAbiItem } from 'viem';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cfg } from './env.js';
import { pub } from './chain.js';

const LAUNCH_BLOCK = 52845715n;
const VERSION = 3;
const ZERO = '0x0000000000000000000000000000000000000000';
// a sell is a transfer into the pool: v4 settles swaps straight into the PoolManager, and the router and
// permit2 are the only other places a swap can route through. anything else sent out is a move, not a sell.
const SINKS = new Set(['0x8366a39cc670b4001a1121b8f6a443a643e40951', '0x8876789976decbfcbbbe364623c63652db8c0904', '0x000000000022d473030f116ddee9f6b43ac78ba3']);
const statePath = () => join(cfg.siteDir, 'holders-state.json');
type State = {
  v?: number; lastBlock: string; balances: Record<string, string>;
  first?: Record<string, number>; // wallet -> unix seconds of its first incoming transfer (to the minute or so)
  out?: Record<string, 1>;        // wallets that have sold at least once (sent tokens into the pool)
  scannedAt?: string; count?: number;
};
const fresh = (): State => ({ v: VERSION, lastBlock: (LAUNCH_BLOCK - 1n).toString(), balances: {}, first: {}, out: {} });

export async function readHolders(): Promise<number | undefined> {
  let st = fresh();
  try {
    const s = JSON.parse(readFileSync(statePath(), 'utf8')) as State;
    if (s.v === VERSION) st = s; else console.log('[holders] state format changed; rescanning from launch');
  } catch {}
  // hourly is plenty for a holder count, and it keeps the state file's commits down
  if (st.scannedAt && st.count && Date.now() - new Date(st.scannedAt).getTime() < 55 * 60_000) return st.count;
  const bal = new Map<string, bigint>(Object.entries(st.balances).map(([a, v]) => [a, BigInt(v)]));
  const first = st.first ?? {}, out = st.out ?? {};
  const latest = await pub.getBlockNumber(); let from = BigInt(st.lastBlock) + 1n;
  const ev = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
  let step = 5000n, scanned = 0, calls = 0;
  while (from <= latest && calls < 3000) {
    const to = from + step - 1n > latest ? latest : from + step - 1n;
    try {
      const logs = await pub.getLogs({ address: cfg.token, event: ev, fromBlock: from, toBlock: to }); calls++;
      // newcomers in this span, and the span's clock: the timestamps of its two ends, blocks between them on a straight line
      const newcomers = new Map<string, bigint>();
      for (const l of logs) { const t = (l.args.to as string).toLowerCase(); if (t !== ZERO && !(t in first) && !newcomers.has(t)) newcomers.set(t, l.blockNumber ?? from); }
      let t0 = 0, t1 = 0;
      if (newcomers.size) {
        const [b0, b1] = await Promise.all([pub.getBlock({ blockNumber: from }), pub.getBlock({ blockNumber: to })]); calls += 2;
        t0 = Number(b0.timestamp); t1 = Number(b1.timestamp);
      }
      // every read for this span succeeded; only now does the state change, so a failed span retries cleanly
      for (const l of logs) {
        const f = (l.args.from as string).toLowerCase(), t = (l.args.to as string).toLowerCase(), v = l.args.value as bigint;
        if (f !== ZERO) { bal.set(f, (bal.get(f) ?? 0n) - v); if (SINKS.has(t)) out[f] = 1; }
        if (t !== ZERO) bal.set(t, (bal.get(t) ?? 0n) + v);
      }
      for (const [a, b] of newcomers) first[a] = to === from ? t0 : Math.round(t0 + ((t1 - t0) * Number(b - from)) / Number(to - from));
      scanned += logs.length; from = to + 1n; st.lastBlock = to.toString();
      if (logs.length < 1500 && step < 20000n) step *= 2n; // roomy: widen
    } catch (e: any) {
      calls++;
      if (step > 250n) { step /= 2n; continue; } // dense: narrow and retry the same span
      console.log(`[holders] scan stopped at block ${st.lastBlock}: ${e.shortMessage || e.message}`); break;
    }
  }
  for (const [a, v] of bal) if (v <= 0n) bal.delete(a);
  for (const a of Object.keys(first)) if (!bal.has(a)) delete first[a];
  for (const a of Object.keys(out)) if (!bal.has(a)) delete out[a];
  st.v = VERSION; st.balances = Object.fromEntries([...bal].map(([a, v]) => [a, v.toString()])); st.first = first; st.out = out;
  const n = bal.size; st.count = n; st.scannedAt = new Date().toISOString();
  writeFileSync(statePath(), JSON.stringify(st)); console.log(`[holders] ${n} holders · ${scanned} transfers scanned · through block ${st.lastBlock}`);
  return n;
}

// The board: wallets holding the seat threshold or more, from the last scan. Infra is not a seat.
const SEAT = 250_000n * 10n ** 18n;
const NOT_SEATS = new Set(['0x267444d099b10fb5ed7c3cc7b7c767adca574952', '0x8366a39cc670b4001a1121b8f6a443a643e40951', '0x259c3fc3dad6b8e418b44c238c7be65284244e4a', '0x3f6f2e902be8736c0d59aba82d5975f395b9b825', '0xded25195d733d7e4c6377250ad57d062da82bd53']);
export function boardSeats(): number | undefined {
  try { const st = JSON.parse(readFileSync(statePath(), 'utf8')) as State; let n = 0; for (const [a, v] of Object.entries(st.balances)) if (!NOT_SEATS.has(a) && BigInt(v) >= SEAT) n++; return n; } catch { return undefined; }
}
