// The holder count, from the chain: a balance map kept from every Transfer event since launch,
// updated incrementally each run (site/holders-state.json). The explorer blocks automated reads.
import { parseAbiItem } from 'viem';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cfg } from './env.js';
import { pub } from './chain.js';

const LAUNCH_BLOCK = 52845715n;
const statePath = () => join(cfg.siteDir, 'holders-state.json');
type State = { lastBlock: string; balances: Record<string, string>; scannedAt?: string; count?: number };

export async function readHolders(): Promise<number | undefined> {
  let st: State = { lastBlock: (LAUNCH_BLOCK - 1n).toString(), balances: {} };
  try { st = JSON.parse(readFileSync(statePath(), 'utf8')); } catch {}
  // hourly is plenty for a holder count, and it keeps the state file's commits down
  if (st.scannedAt && st.count && Date.now() - new Date(st.scannedAt).getTime() < 55 * 60_000) return st.count;
  const bal = new Map<string, bigint>(Object.entries(st.balances).map(([a, v]) => [a, BigInt(v)]));
  const latest = await pub.getBlockNumber(); let from = BigInt(st.lastBlock) + 1n;
  const ev = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
  let step = 5000n, scanned = 0, calls = 0;
  while (from <= latest && calls < 3000) {
    const to = from + step - 1n > latest ? latest : from + step - 1n;
    try {
      const logs = await pub.getLogs({ address: cfg.token, event: ev, fromBlock: from, toBlock: to }); calls++;
      for (const l of logs) {
        const f = (l.args.from as string).toLowerCase(), t = (l.args.to as string).toLowerCase(), v = l.args.value as bigint;
        if (f !== '0x0000000000000000000000000000000000000000') bal.set(f, (bal.get(f) ?? 0n) - v);
        if (t !== '0x0000000000000000000000000000000000000000') bal.set(t, (bal.get(t) ?? 0n) + v);
      }
      scanned += logs.length; from = to + 1n; st.lastBlock = to.toString();
      if (logs.length < 1500 && step < 20000n) step *= 2n; // roomy: widen
    } catch (e: any) {
      calls++;
      if (step > 250n) { step /= 2n; continue; } // dense: narrow and retry the same span
      console.log(`[holders] scan stopped at block ${st.lastBlock}: ${e.shortMessage || e.message}`); break;
    }
  }
  for (const [a, v] of bal) if (v <= 0n) bal.delete(a);
  st.balances = Object.fromEntries([...bal].map(([a, v]) => [a, v.toString()]));
  const n = bal.size; st.count = n; st.scannedAt = new Date().toISOString();
  writeFileSync(statePath(), JSON.stringify(st)); console.log(`[holders] ${n} holders · ${scanned} transfers scanned · through block ${st.lastBlock}`);
  return n;
}
