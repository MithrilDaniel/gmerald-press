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
  note: string;
};

export async function checkPeg(): Promise<PegStatus> {
  if (!cfg.pegFeed) return { status: 'unchecked', note: 'PEG_FEED_ADDRESS not set' };
  try {
    const [round, dec] = await Promise.all([
      pub.readContract({ address: cfg.pegFeed, abi: feedAbi, functionName: 'latestRoundData' }),
      pub.readContract({ address: cfg.pegFeed, abi: feedAbi, functionName: 'decimals' }),
    ]);
    const fairUsd = Number(round[1]) / 10 ** Number(dec);
    if (!(fairUsd > 0)) return { status: 'unchecked', note: 'feed returned no price' };

    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${cfg.gme}`);
    if (!res.ok) return { status: 'unchecked', note: `dexscreener ${res.status}`, fairUsd };
    const data = (await res.json()) as { pairs?: { priceUsd?: string; liquidity?: { usd?: number } }[] };
    const pairs = (data.pairs ?? []).filter((p) => p.priceUsd);
    if (!pairs.length) return { status: 'unchecked', note: 'no dex pairs found', fairUsd };
    pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const tokenUsd = Number(pairs[0].priceUsd);

    const premiumBps = Math.round((tokenUsd / fairUsd - 1) * 10000);
    const status = premiumBps >= -cfg.pegToleranceBps ? 'at-or-above' : 'below';
    return {
      status,
      fairUsd,
      tokenUsd,
      premiumBps,
      note: `token $${tokenUsd.toFixed(2)} vs fair $${fairUsd.toFixed(2)} (${premiumBps >= 0 ? '+' : ''}${(premiumBps / 100).toFixed(2)}%)`,
    };
  } catch (e) {
    return { status: 'unchecked', note: `peg check failed: ${(e as Error).message}` };
  }
}
