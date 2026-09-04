// The ops-leg gate: "never a forced seller." Fair value comes from the
// Chainlink tokenized-equity feed; the on-chain token price comes from
// dexscreener (keyless). When either half is unavailable the answer is
// 'unchecked' and the caller HOLDS the ops slice — the conservative default.
import { cfg } from './env.js';
import { pub } from './chain.js';
import { feedAbi } from './abis.js';

export type PegStatus = {
  status: 'unchecked' | 'at-or-above' | 'below';
  fairUsd?: number;
  tokenUsd?: number;
  premiumBps?: number;
  feedAt?: number;   // unix seconds of the chainlink round the fair price comes from
  source?: string;   // where the token price came from
  note: string;
};
// the pools that can set the token price: the stock token as base, a dollar as quote, real depth
const USD = new Set(['USDG', 'USDC', 'USDT', 'USD1', 'DAI']);
type Pair = { priceUsd?: string; liquidity?: { usd?: number }; volume?: { h1?: number; h6?: number }; baseToken?: { address?: string }; quoteToken?: { symbol?: string } };

export async function checkPeg(): Promise<PegStatus> {
  if (!cfg.pegFeed) return { status: 'unchecked', note: 'PEG_FEED_ADDRESS not set' };
  try {
    const [round, dec] = await Promise.all([
      pub.readContract({ address: cfg.pegFeed, abi: feedAbi, functionName: 'latestRoundData' }),
      pub.readContract({ address: cfg.pegFeed, abi: feedAbi, functionName: 'decimals' }),
    ]);
    const fairUsd = Number(round[1]) / 10 ** Number(dec); const feedAt = Number(round[3]);
    if (!(fairUsd > 0)) return { status: 'unchecked', note: 'feed returned no price' };

    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${cfg.gme}`);
    if (!res.ok) return { status: 'unchecked', note: `dexscreener ${res.status}`, fairUsd };
    const data = (await res.json()) as { pairs?: Pair[] };
    const pairs = (data.pairs ?? []).filter((p) => p.priceUsd && p.baseToken?.address?.toLowerCase() === cfg.gme.toLowerCase()
      && USD.has((p.quoteToken?.symbol ?? '').toUpperCase()) && (p.liquidity?.usd ?? 0) >= 20000);
    if (!pairs.length) return { status: 'unchecked', note: 'no usd pools for the stock token', fairUsd, feedAt };
    // weighted by the hour's volume, so a pool nobody traded in cannot set the price; the deepest pool if nothing traded
    let num = 0, den = 0, n = 0; for (const p of pairs) { const w = p.volume?.h1 ?? 0; if (w > 0) { num += Number(p.priceUsd) * w; den += w; n++; } }
    pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const tokenUsd = den > 0 ? num / den : Number(pairs[0].priceUsd);
    const source = den > 0 ? `${n} pool${n === 1 ? '' : 's'}, weighted by the hour's volume` : 'deepest pool, no trades this hour';

    const premiumBps = Math.round((tokenUsd / fairUsd - 1) * 10000);
    const status = premiumBps >= -cfg.pegToleranceBps ? 'at-or-above' : 'below';
    return {
      status,
      fairUsd,
      tokenUsd,
      premiumBps, feedAt, source,
      note: `token $${tokenUsd.toFixed(2)} (${source}) vs fair $${fairUsd.toFixed(2)} (chainlink ${new Date(feedAt * 1000).toISOString().slice(11, 16)} utc): ${premiumBps >= 0 ? '+' : ''}${(premiumBps / 100).toFixed(2)}%`,
    };
  } catch (e) {
    return { status: 'unchecked', note: `peg check failed: ${(e as Error).message}` };
  }
}
