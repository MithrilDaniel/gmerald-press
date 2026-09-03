// The burn leg in pool phase: GME -> $GMERALD through Uniswap v4 on Robinhood
// Chain via the Universal Router (V4_SWAP), quoted first with the v4 Quoter.
// Addresses from developers.uniswap.org/contracts/v4/deployments (chain 4663).
import { encodeAbiParameters, parseAbi, maxUint160 } from 'viem';
const MAX_UINT48 = 281474976710655; // 2^48 - 1, a JS number because viem maps uint48 to number
import { cfg } from './env.js';
import { pub, wallet, account } from './chain.js';

export const V4 = {
  poolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
  universalRouter: '0x8876789976decbfcbbbe364623c63652db8c0904',
  quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  hook: '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044',
  tickSpacing: 200,
} as const;

const quoterAbi = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
]);
const routerAbi = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
const permit2Abi = parseAbi([
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
]);
const erc20 = parseAbi(['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']);

export function poolKey(token: `0x${string}`) {
  const a = cfg.gme.toLowerCase(), b = token.toLowerCase();
  const [currency0, currency1] = a < b ? [cfg.gme, token] : [token, cfg.gme];
  return { currency0, currency1, fee: 0, tickSpacing: V4.tickSpacing, hooks: V4.hook as `0x${string}`, zeroForOne: a < b };
}

export async function quoteGmeToToken(token: `0x${string}`, amountIn: bigint): Promise<bigint> {
  const k = poolKey(token);
  const { result } = await pub.simulateContract({
    address: V4.quoter, abi: quoterAbi, functionName: 'quoteExactInputSingle',
    args: [{ poolKey: { currency0: k.currency0, currency1: k.currency1, fee: k.fee, tickSpacing: k.tickSpacing, hooks: k.hooks }, zeroForOne: k.zeroForOne, exactAmount: amountIn, hookData: '0x' }],
  });
  return result[0];
}

// Universal Router: command 0x10 = V4_SWAP; v4 actions 0x07 SWAP_EXACT_IN, 0x0c SETTLE_ALL, 0x0f TAKE_ALL.
export async function swapGmeToToken(token: `0x${string}`, amountIn: bigint, minOut: bigint): Promise<`0x${string}`> {
  const w = wallet(); const me = account().address; const k = poolKey(token);
  // Permit2 is how the router pulls ERC-20 input: approve Permit2 once, then Permit2 -> router.
  const erc20Allow = await pub.readContract({ address: cfg.gme, abi: erc20, functionName: 'allowance', args: [me, V4.permit2] });
  if (erc20Allow < amountIn) {
    const h = await w.writeContract({ address: cfg.gme, abi: erc20, functionName: 'approve', args: [V4.permit2, 2n ** 256n - 1n] });
    await pub.waitForTransactionReceipt({ hash: h });
  }
  const [p2Amt, p2Exp] = await pub.readContract({ address: V4.permit2, abi: permit2Abi, functionName: 'allowance', args: [me, cfg.gme, V4.universalRouter] });
  if (p2Amt < amountIn || Number(p2Exp) < Math.floor(Date.now() / 1000) + 600) {
    const h = await w.writeContract({ address: V4.permit2, abi: permit2Abi, functionName: 'approve', args: [cfg.gme, V4.universalRouter, maxUint160, MAX_UINT48] });
    await pub.waitForTransactionReceipt({ hash: h });
  }
  // This chain's Universal Router carries a non-standard swap struct: an extra `bytes`
  // field sits between the path and the amounts (read off a live trade, tx 0x2ee2...c3a0).
  // The standard single-hop layout reverts inside the router's decoder, so we use the
  // path form with that field empty: SWAP_EXACT_IN (0x07), then SETTLE_ALL, TAKE_ALL.
  const swapParams = encodeAbiParameters(
    [{ type: 'tuple', components: [
      { type: 'address', name: 'currencyIn' },
      { type: 'tuple[]', name: 'path', components: [{ type: 'address', name: 'intermediateCurrency' }, { type: 'uint24', name: 'fee' }, { type: 'int24', name: 'tickSpacing' }, { type: 'address', name: 'hooks' }, { type: 'bytes', name: 'hookData' }] },
      { type: 'bytes', name: 'extra' }, { type: 'uint128', name: 'amountIn' }, { type: 'uint128', name: 'amountOutMinimum' } ] }],
    [{ currencyIn: cfg.gme, path: [{ intermediateCurrency: token, fee: k.fee, tickSpacing: k.tickSpacing, hooks: k.hooks, hookData: '0x' }], extra: '0x', amountIn, amountOutMinimum: minOut }],
  );
  const settle = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [cfg.gme, amountIn]);
  const take = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [token, minOut]);
  const actions = '0x070c0f' as `0x${string}`;
  const input = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [actions, [swapParams, settle, take]]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const hash = await w.writeContract({ address: V4.universalRouter, abi: routerAbi, functionName: 'execute', args: ['0x10', [input], deadline] });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== 'success') throw new Error(`v4 swap reverted: ${hash}`);
  return hash;
}
