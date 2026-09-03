// The buy bot. Scans the pool's Swap events since the last run, posts each buy
// to telegram with hamster sizing. Runs on a 5-minute cron (or by hand). State
// is the last scanned block, kept in press/buys-state.json and committed.
import { readFileSync, writeFileSync } from 'node:fs';
import { encodeAbiParameters, formatUnits, keccak256, parseAbiItem } from 'viem';
import { cfg } from '../env.js';
import { pub } from '../chain.js';
import { post } from '../telegram.js';
import { checkPeg } from '../peg.js';
import { V4, poolKey } from '../v4.js';

const STATE = new URL('../../buys-state.json', import.meta.url).pathname;
const short = (a: string) => a.slice(0, 6) + '…' + a.slice(-4);

export async function runBuys(): Promise<void> {
  if (!cfg.token) { console.log('[buys] TOKEN_ADDRESS not set'); return; }
  const token = cfg.token as `0x${string}`;
  const k = poolKey(token);
  const poolId = keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
    [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));
  const latest = await pub.getBlockNumber();
  let from: bigint;
  try { from = BigInt(JSON.parse(readFileSync(STATE, 'utf8')).lastBlock) + 1n; } catch { from = latest - 200n; }
  if (from > latest) { console.log('[buys] nothing new'); return; }
  // Blocks are ~0.1s here. If the state is stale (first run, or the cron slept), only
  // look back ~10 minutes: nobody wants an hour of buys dumped into the chat at once.
  const MAX_BACK = 6000n;
  if (latest - from > MAX_BACK) { console.log(`[buys] state is ${latest - from} blocks behind; skipping ahead to the last ${MAX_BACK}`); from = latest - MAX_BACK; }
  const logs = await pub.getLogs({
    address: V4.poolManager,
    event: parseAbiItem('event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)'),
    args: { id: poolId }, fromBlock: from, toBlock: latest,
  });
  const peg = await checkPeg(); const gmeUsd = peg.tokenUsd ?? 0;
  const gmeIs0 = k.zeroForOne; // GME is currency0 when GME sorts first
  let posted = 0;
  for (const log of logs) {
    const a0 = log.args.amount0 as bigint, a1 = log.args.amount1 as bigint;
    const gmeDelta = gmeIs0 ? a0 : a1, tokDelta = gmeIs0 ? a1 : a0;
    // From the swapper's view: negative = paid in, positive = received. A buy pays GME and receives $GMERALD.
    if (!(gmeDelta < 0n && tokDelta > 0n)) continue;
    const gme = Number(formatUnits(-gmeDelta, 18)), got = Number(formatUnits(tokDelta, 18));
    const usd = gme * gmeUsd;
    if (usd < Number(cfg.minBuyUsd)) continue;
    const tx = await pub.getTransaction({ hash: log.transactionHash });
    const hamsters = '\u{1F439}'.repeat(Math.max(1, Math.min(40, Math.floor(usd / Number(cfg.buyStepUsd)))));
    const text = [
      `${hamsters}`,
      `new buy: ${gme.toFixed(3)} gme${gmeUsd ? ` ($${usd.toFixed(0)})` : ''} → ${got.toLocaleString('en-US', { maximumFractionDigits: 0 })} $gmerald`,
      `buyer ${short(tx.from)} · ${cfg.explorer}/tx/${log.transactionHash}`,
      `chart: https://dexscreener.com/robinhood/${poolId}`,
    ].join('\n');
    await post(text); posted++;
  }
  writeFileSync(STATE, JSON.stringify({ lastBlock: latest.toString(), scannedAt: new Date().toISOString() }));
  console.log(`[buys] ${logs.length} swaps scanned, ${posted} buys posted, up to block ${latest}`);
}
