// The market as dexscreener sees it, independent of our RPC: price in GME per $GMERALD now,
// and the recent high reconstructed from the change points it publishes (1h, 6h, 24h ago).
// A dip is measured against that high, not an average: on a launch day the average is the
// launch price and says nothing.
import { cfg } from './env.js';
export type Market = { priceGme: number; recentHighGme: number; vsHighBps: number; h1: number };
export async function readMarket(poolId: `0x${string}`): Promise<Market | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/robinhood/${poolId}`);
    if (!res.ok) return null;
    const j = (await res.json()) as any; const p = (j.pairs ?? [j.pair])[0]; if (!p?.priceNative) return null;
    const now = Number(p.priceNative); const ch = p.priceChange ?? {};
    const at = (k: string) => (ch[k] == null ? now : now / (1 + Number(ch[k]) / 100));
    const high = Math.max(now, at('h1'), at('h6'), at('h24'));
    return { priceGme: now, recentHighGme: high, vsHighBps: Math.round((now / high - 1) * 10000), h1: Number(ch.h1 ?? 0) };
  } catch { return null; }
}
