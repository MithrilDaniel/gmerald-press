// The market as dexscreener sees it, independent of our RPC: price in GME per $GMERALD,
// and the day's average from the four points dexscreener publishes (now, 1h, 6h, 24h ago).
import { cfg } from './env.js';
export type Market = { priceGme: number; dayAvgGme: number; vsDayAvgBps: number };
export async function readMarket(poolId: `0x${string}`): Promise<Market | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/robinhood/${poolId}`);
    if (!res.ok) return null;
    const j = (await res.json()) as any; const p = (j.pairs ?? [j.pair])[0]; if (!p?.priceNative) return null;
    const now = Number(p.priceNative); const ch = p.priceChange ?? {};
    const at = (k: string) => (ch[k] == null ? now : now / (1 + Number(ch[k]) / 100));
    const dayAvg = (now + at('h1') + at('h6') + at('h24')) / 4;
    return { priceGme: now, dayAvgGme: dayAvg, vsDayAvgBps: Math.round((now / dayAvg - 1) * 10000) };
  } catch { return null; }
}
