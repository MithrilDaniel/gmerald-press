// All configuration in one place. Addresses that only exist after launch are
// optional — the bot exits cleanly when they are unset, so the cron can be
// armed before the token exists.

// GitHub Actions passes unset repository variables as empty strings, so empty
// must mean unset or the defaults never apply in CI.
const opt = (k: string, d = ''): string => {
  const v = process.env[k];
  return v === undefined || v === '' ? d : v;
};

const addr = (k: string, d = ''): `0x${string}` | '' => {
  const v = opt(k, d);
  if (v === '') return '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error(`env ${k} is not an address: ${v}`);
  return v as `0x${string}`;
};

export const cfg = {
  rpcUrl: opt('RPC_URL', 'https://rpc.mainnet.chain.robinhood.com'),
  explorer: opt('EXPLORER_URL', 'https://robinhoodchain.blockscout.com'),

  factory: addr('FACTORY_ADDRESS', '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e') as `0x${string}`,
  // The GME *stock token* — pinned. An unaffiliated memecoin named "GME"
  // exists on this chain; the bot must never buy anything but this address.
  gme: addr('GME_ADDRESS', '0x1b0E319c6A659F002271B69dB8A7df2F911c153E') as `0x${string}`,

  // Set after launch.
  // Pinned: a changed repository variable must never point the float at another token.
  token: (() => { const KNOWN = '0x3E4E7bbee9A7e5fBEdABeEa66313C8f636999458'; const v = opt('TOKEN_ADDRESS', KNOWN);
    if (v.toLowerCase() !== KNOWN.toLowerCase()) throw new Error(`TOKEN_ADDRESS ${v} is not $GMERALD (${KNOWN}); refusing to run`); return KNOWN as `0x${string}`; })(),
  escrow: addr('ESCROW_ADDRESS'),
  // Pinned like the token: a changed variable must never point a stash transfer elsewhere.
  stash: (() => { const KNOWN = '0x259c3Fc3Dad6B8e418b44c238C7Be65284244e4A'; const v = opt('STASH_ADDRESS', KNOWN);
    if (v.toLowerCase() !== KNOWN.toLowerCase()) throw new Error(`STASH_ADDRESS ${v} is not the stash (${KNOWN}); refusing to run`); return KNOWN as `0x${string}`; })(),
  ops: addr('OPS_ADDRESS'),

  // The petty-cash key. NEVER the creator-fee-recipient wallet: if this key
  // leaked, transferCreatorFeeRecipient would let a thief take the whole fee
  // stream. The founder claims fees to their own wallet and tops up this one.
  key: opt('PRESS_WALLET_KEY'),

  dry: opt('PRESS_DRY_RUN') === '1',
  slippageBps: BigInt(opt('SLIPPAGE_BPS', '200')),
  minPressGme: opt('MIN_PRESS_GME', '0.05'),

  // The split the press applies to what it presses. Default: the full 45/45/10.
  // Burn-only wallet (the founder splits at claim time by hand): BURN_BPS=10000 STASH_BPS=0 OPS_BPS=0.
  burnBps: BigInt(opt('BURN_BPS', '4500')),
  stashBps: BigInt(opt('STASH_BPS', '4500')),
  opsBps: BigInt(opt('OPS_BPS', '1000')),
  BPS: 10000n,

  // Peg check (ops leg only): Chainlink tokenized-equity feed for fair value,
  // dexscreener for the on-chain token price. Both optional; when the check
  // can't run, the ops slice is HELD, never moved blind.
  // Chainlink 'Robinhood GME / USD' (8 dp, 24h heartbeat, 0.5% deviation) — verified on-chain.
  pegFeed: addr('PEG_FEED_ADDRESS', '0x27C71df6A64fB476468EdF256CF72c038baB5B67'),
  pegToleranceBps: Number(opt('PEG_TOLERANCE_BPS', '0')),
  opsForce: opt('OPS_FORCE') === '1',

  // Post-graduation swap path through Uniswap v4's Universal Router (v4.ts).
  // Set V4_SWAP_ENABLED=0 to hold the burn leg and swap by hand instead.
  v4SwapEnabled: opt('V4_SWAP_ENABLED', '1') === '1',
  pressFractionBps: BigInt(opt('PRESS_FRACTION_BPS', '1667')),
  // Slice mode: press a fixed amount of GME per run (the 15-minute TWAP). 0 = fraction mode above.
  pressSliceGme: opt('PRESS_SLICE_GME', '0'),
  // A dollar floor per slice, converted from the live GME price each run (0 = off).
  pressSliceUsd: Number(opt('PRESS_SLICE_USD', '0')),
  // Spread each batch over N hours: the slice is the remaining float divided by the ticks
  // left since the last press (0 = off; overrides the fixed slice and the dollar floor).
  pressSpreadHours: Number(opt('PRESS_SPREAD_HOURS', '0')),
  // A nap: no snacks until this ISO time (empty = awake). The stash scanner still runs.
  napUntil: opt('NAP_UNTIL', ''),
  // Dip mode: the slice doubles when price sits more than DIP_BAND_BPS under the day's
  // average, halves when it sits that far above. Coarse on purpose (see README).
  dipMode: opt('DIP_MODE', '1') === '1',
  dipBandBps: Number(opt('DIP_BAND_BPS', '1000')),
  // A quote that disagrees with the market by more than this is held, not executed.
  quoteSanityBps: Number(opt('QUOTE_SANITY_BPS', '1500')),
  // The burn wallet's address (public), so read-only jobs can report the queue without the key.
  pressWallet: opt('PRESS_WALLET_ADDRESS', '0x3f6f2e902bE8736c0D59aBA82d5975F395b9B825') as `0x${string}`,
  // How often the cron fires, for the site's copy and countdown.
  cadenceMin: Number(opt('CADENCE_MIN', '15')),
  // When nothing is pressed, refresh the site's numbers at most this often (every commit is a deploy).
  refreshMin: Number(opt('REFRESH_MIN', '55')),

  // The buy bot.
  minBuyUsd: opt('MIN_BUY_USD', '25'),
  buyStepUsd: opt('BUY_STEP_USD', '50'),

  tgToken: opt('TELEGRAM_BOT_TOKEN'),
  tgChat: opt('TELEGRAM_CHAT_ID'),

  gradSeedGme: opt('GRAD_SEED_GME', '0'),
  siteDir: opt('SITE_DIR', new URL('../../site', import.meta.url).pathname),
};

// Launched enough to press: the token exists, and the stash exists unless this wallet never stashes.
export const launched = (): boolean => true; // token and stash are pinned in code
