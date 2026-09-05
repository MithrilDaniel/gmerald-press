// The buy bot. Scans the pool's Swap events since the last run and posts each buy above the floor
// to the burrow: size in gme and dollars, new holder or not, market cap at that moment, the buyer,
// the hash. Runs at the end of every press run (the reliable clock); state is the last scanned
// block in site/buys-state.json, committed with the terminal's numbers.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeAbiParameters, formatUnits, keccak256, parseAbiItem } from 'viem';
import { cfg } from '../env.js';
import { pub } from '../chain.js';
import { postMedia, ART } from '../telegram.js';
import { checkPeg } from '../peg.js';
import { V4, poolKey } from '../v4.js';

const statePath = () => join(cfg.siteDir, 'buys-state.json');
const short = (a: string) => a.slice(0, 6) + '…' + a.slice(-4);
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const SEAT = 250_000;
// tokens that land here are in transit, not bought: the pool, the routers, permit2, the hook
const NOT_BUYERS = new Set(['0x8366a39cc670b4001a1121b8f6a443a643e40951', '0x8876789976decbfcbbbe364623c63652db8c0904', '0x000000000022d473030f116ddee9f6b43ac78ba3', '0xe5e702641ea86f4ae6cc3cdaed2b886f976be044', '0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f', '0x39b38686a19836ac10162c490e4558e120cbbe5f', '0x8f10b468b06c6fd214b65f87778827f7d113f996']);
const erc20 = [parseAbiItem('function balanceOf(address) view returns (uint256)'), parseAbiItem('function totalSupply() view returns (uint256)')];
const money = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}m` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`;

// the wallet the bought tokens ended up in: the biggest token transfer in the tx that is not to infra
async function buyerOf(hash: `0x${string}`, token: string, fallback: string): Promise<string> {
  try {
    const rc = await pub.getTransactionReceipt({ hash }); let best = 0n, who = '';
    for (const l of rc.logs) {
      if (l.address.toLowerCase() !== token.toLowerCase() || l.topics[0] !== TRANSFER || l.topics.length < 3) continue;
      const to = '0x' + (l.topics[2] as string).slice(26); const v = BigInt(l.data);
      if (!NOT_BUYERS.has(to.toLowerCase()) && v > best) { best = v; who = to; }
    }
    return who || fallback;
  } catch { return fallback; }
}

export async function runBuys(): Promise<void> {
  if (!cfg.token) { console.log('[buys] TOKEN_ADDRESS not set'); return; }
  const token = cfg.token as `0x${string}`;
  const k = poolKey(token);
  const poolId = keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
    [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));
  const latest = await pub.getBlockNumber();
  let from: bigint;
  try { from = BigInt(JSON.parse(readFileSync(statePath(), 'utf8')).lastBlock) + 1n; } catch { from = latest - 200n; }
  if (from > latest) { console.log('[buys] nothing new'); return; }
  // blocks are ~0.1s apart. if the state is stale (first run, or the clock slept), only look back ~15 minutes:
  // nobody wants an hour of buys dumped into the chat at once.
  const MAX_BACK = 10000n;
  if (latest - from > MAX_BACK) { console.log(`[buys] state is ${latest - from} blocks behind; skipping ahead to the last ${MAX_BACK}`); from = latest - MAX_BACK; }
  const logs = await pub.getLogs({
    address: V4.poolManager,
    event: parseAbiItem('event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)'),
    args: { id: poolId }, fromBlock: from, toBlock: latest,
  });
  const peg = await checkPeg(); const gmeUsd = peg.tokenUsd ?? 0;
  const supply = Number(formatUnits(await pub.readContract({ address: token, abi: erc20, functionName: 'totalSupply' }), 18));
  const gmeIs0 = k.zeroForOne; // GME is currency0 when GME sorts first
  let posted = 0;
  for (const log of logs) {
    const a0 = log.args.amount0 as bigint, a1 = log.args.amount1 as bigint;
    const gmeDelta = gmeIs0 ? a0 : a1, tokDelta = gmeIs0 ? a1 : a0;
    // from the swapper's view: negative = paid in, positive = received. a buy pays gme and receives $gmerald.
    if (!(gmeDelta < 0n && tokDelta > 0n)) continue;
    const gme = Number(formatUnits(-gmeDelta, 18)), got = Number(formatUnits(tokDelta, 18));
    const usd = gme * gmeUsd;
    if (usd < Number(cfg.minBuyUsd)) continue;
    const tx = await pub.getTransaction({ hash: log.transactionHash });
    const buyer = await buyerOf(log.transactionHash, token, tx.from);
    if (buyer.toLowerCase() === String(cfg.pressWallet).toLowerCase()) continue; // the machine's own snacks are posted as snacks
    let before = 0; try { before = Number(formatUnits(await pub.readContract({ address: token, abi: erc20, functionName: 'balanceOf', args: [buyer as `0x${string}`], blockNumber: (log.blockNumber ?? latest) - 1n }), 18)); } catch {}
    const after = before + got, fresh = before < 1;
    const mcap = got > 0 && usd > 0 ? (usd / got) * supply : 0;
    const hamsters = '\u{1F439}'.repeat(Math.max(1, Math.min(40, Math.floor(usd / Number(cfg.buyStepUsd)))));
    const who = fresh ? 'new holder · welcome to the burrow' : `holder since before · now ${after.toLocaleString('en-US', { maximumFractionDigits: 0 })} $gmerald`;
    const seat = after >= SEAT ? (fresh || before < SEAT ? ' · takes a seat on the board' : ' · a seat on the board') : '';
    const text = [
      hamsters,
      `buy: ${gme.toFixed(3)} gme${gmeUsd ? ` ($${usd.toFixed(0)})` : ''} → ${got.toLocaleString('en-US', { maximumFractionDigits: 0 })} $gmerald`,
      who + seat,
      mcap > 0 ? `market cap at the time: ${money(mcap)}` : null,
      `buyer ${short(buyer)} · ${cfg.explorer}/tx/${log.transactionHash}`,
      `chart: https://dexscreener.com/robinhood/${poolId}`,
    ].filter(Boolean).join('\n');
    await postMedia(fresh ? ART.newHolder : ART.buy, text); posted++;
  }
  writeFileSync(statePath(), JSON.stringify({ lastBlock: latest.toString(), scannedAt: new Date().toISOString() }));
  console.log(`[buys] ${logs.length} swaps scanned, ${posted} buys posted, up to block ${latest}`);
}
