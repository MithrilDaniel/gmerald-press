// Record a MANUAL press so the site's ledger and status bar reflect it.
// Usage (from press/):
//   npx tsx src/index.ts log --burned 1234567 --stashed 12.5 --burn-tx 0x.. --stash-tx 0x.. [--gme-spent 12.5] [--ops 2.7] [--note "pressed by hand"]
// Then commit and push site/press-ledger.json + site/press-stats.json.
import { formatUnits } from 'viem';
import { cfg } from '../env.js';
import { pub } from '../chain.js';
import { erc20Abi } from '../abis.js';
import { appendPress, writeStats, burnGmeTotal, totals } from '../ledger.js';
import { checkPeg } from '../peg.js';

const arg = (k: string, d = '') => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? (process.argv[i + 1] ?? d) : d; };

export async function runLog(): Promise<void> {
  const burned = arg('burned', '0'), stashed = arg('stashed', '0'), spent = arg('gme-spent', stashed), ops = arg('ops', '0');
  const peg = await checkPeg();
  const entry = appendPress({
    kind: (arg('kind', 'press') as 'press' | 'snack'),
    note: arg('note', 'pressed by hand'),
    burnedGmerald: Number(burned).toFixed(0),
    burnGmeSpent: Number(spent).toFixed(4),
    stashedGme: Number(stashed).toFixed(4),
    opsMovedGme: Number(ops).toFixed(4),
    pegStatus: peg.status,
    burnTx: arg('burn-tx') || undefined,
    stashTx: arg('stash-tx') || undefined,
    gmeUsd: peg.fairUsd && peg.fairUsd > 0 ? peg.fairUsd : undefined,
  });
  let burnedPct = '0.00', stashGme = 0;
  if (cfg.token) {
    const supply = await pub.readContract({ address: cfg.token as `0x${string}`, abi: erc20Abi, functionName: 'totalSupply' });
    burnedPct = ((Number(10n ** 27n - supply) / 1e27) * 100).toFixed(2);
  }
  if (cfg.stash) {
    const bal = await pub.readContract({ address: cfg.gme, abi: erc20Abi, functionName: 'balanceOf', args: [cfg.stash as `0x${string}`] });
    stashGme = Number(formatUnits(bal, 18));
  } else {
    stashGme = totals().stashedGme;
  }
  const queued = await pub.readContract({ address: cfg.gme, abi: erc20Abi, functionName: 'balanceOf', args: [cfg.pressWallet] });
  const slice = Number(cfg.pressSliceGme) || 20, slicesLeft = Math.ceil(Number(formatUnits(queued, 18)) / slice);
  const status = Number(formatUnits(queued, 18)) >= Number(cfg.minPressGme) ? `snacking. ${slicesLeft} slice${slicesLeft === 1 ? '' : 's'} of ${slice} gme to go` : 'napping between claims';
  writeStats({
    presses: totals().press, snacks: totals().snack, burnedPct, stashGme: stashGme.toFixed(2),
    gmeSunk: (stashGme + burnGmeTotal() + Number(cfg.gradSeedGme)).toFixed(2),
    status, queuedGme: formatUnits(queued, 18), updatedAt: entry.ts, checkedAt: entry.ts,
    cadenceMin: cfg.cadenceMin,
    peg: { status: peg.status, premiumBps: peg.premiumBps, tokenUsd: peg.tokenUsd, fairUsd: peg.fairUsd, note: peg.note },
  });
  console.log(`[log] press #${entry.n} recorded. commit site/press-ledger.json + site/press-stats.json and push.`);
}
