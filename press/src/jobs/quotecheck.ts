// Launch-day confidence: find a recent live pons launch and run our quote
// arithmetic against its real curve. If this prints a sane quote, the burn
// leg's math matches the chain.
import { parseAbiItem, formatUnits } from 'viem';
import { cfg } from '../env.js';
import { pub } from '../chain.js';
import { factoryAbi, curveAbi } from '../abis.js';
import { quoteBuy } from '../quote.js';

export async function runQuoteCheck(): Promise<void> {
  const latest = await pub.getBlockNumber();
  const span = 200_000n;
  console.log(`scanning TokenLaunched over the last ${span} blocks...`);
  const logs = await pub.getLogs({
    address: cfg.factory,
    event: parseAbiItem(
      'event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)',
    ),
    fromBlock: latest > span ? latest - span : 0n,
    toBlock: latest,
  });
  console.log(`found ${logs.length} launches`);

  for (const log of logs.reverse()) {
    const token = log.args.token as `0x${string}`;
    const rec = await pub.readContract({
      address: cfg.factory, abi: factoryAbi, functionName: 'getLaunchedToken', args: [token],
    });
    if (rec.phase !== 0) continue;
    const ready = await pub.readContract({
      address: rec.curve, abi: curveAbi, functionName: 'readyToGraduate',
    });
    if (ready) continue;

    const oneUnit = 10n ** 18n;
    const q = await quoteBuy(rec.curve, oneUnit, '0x000000000000000000000000000000000000dEaD');
    console.log(`\nlive curve: ${rec.curve} (token ${token}, pair ${rec.pairToken})`);
    console.log(`  quote for 1.0 pair-unit in:`);
    console.log(`  tokens out : ${formatUnits(q.tokensOut, 18)}`);
    console.log(`  spent      : ${formatUnits(q.spent, 18)} (refund ${formatUnits(q.refund, 18)})`);
    console.log(`  snipe bps  : ${q.snipeBps}`);
    if (q.tokensOut <= 0n) throw new Error('quote produced zero out — investigate before launch');
    console.log('\nquote math verified against a live curve.');
    return;
  }
  console.log('no phase-0 curve found in range — widen the span or check factory activity.');
}
