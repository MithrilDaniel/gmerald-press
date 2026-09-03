// The curve exposes no quote function — this is the curve's own integer
// arithmetic, in the same order, copied from the PONS.md appendix. Buys charge every
// fee off the input before the constant-product step.
import { cfg } from './env.js';
import { pub } from './chain.js';
import { curveAbi } from './abis.js';

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const amountOut = (inAmt: bigint, rIn: bigint, rOut: bigint) => (inAmt * rOut) / (rIn + inAmt);
const amountIn = (outAmt: bigint, rIn: bigint, rOut: bigint) => (outAmt * rIn) / (rOut - outAmt) + 1n;

export async function quoteBuy(curve: `0x${string}`, quoteIn: bigint, recipient: `0x${string}`) {
  const read = <T>(functionName: string, args: unknown[] = []) =>
    pub.readContract({ address: curve, abi: curveAbi, functionName, args } as never) as Promise<T>;

  const [reserves, sellable, feeBps, creatorTaxBps, rawSnipeBps] = await Promise.all([
    read<[bigint, bigint]>('getReserves'),
    read<bigint>('sellableTokens'),
    read<bigint>('feeBps'),
    read<bigint>('creatorTaxBps'),
    read<bigint>('currentSnipeTaxBps', [recipient]),
  ]);
  const [quoteReserve, tokenReserve] = reserves;

  // The snipe tax is capped so the buyer always nets at least 1% of spend.
  let snipeBps = rawSnipeBps;
  if (snipeBps > 0n) {
    const maxSnipeBps = cfg.BPS - feeBps - creatorTaxBps - 100n;
    if (snipeBps > maxSnipeBps) snipeBps = maxSnipeBps;
  }

  let spent = quoteIn;
  const fee = (spent * feeBps) / cfg.BPS;
  const tax = (spent * creatorTaxBps) / cfg.BPS;
  const snipe = (spent * snipeBps) / cfg.BPS;
  let tokensOut = amountOut(spent - fee - tax - snipe, quoteReserve, tokenReserve);

  // A buy that would cross the reserved allocation fills to the edge.
  if (tokensOut > sellable) {
    tokensOut = sellable;
    const net = amountIn(sellable, quoteReserve, tokenReserve);
    const grossed = ceilDiv(net * cfg.BPS, cfg.BPS - feeBps - creatorTaxBps - snipeBps);
    spent = grossed < quoteIn ? grossed : quoteIn;
  }

  return { tokensOut, spent, refund: quoteIn - spent, snipeBps };
}
