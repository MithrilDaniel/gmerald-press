# press/ — Gmerald's keeper

Every 15 minutes: press a fixed slice of the burn wallet's GME (`PRESS_SLICE_GME`, default 20)
into the pool and burn what it buys, post the hash, and commit the numbers the terminal reads
(`site/press-ledger.json`, `site/press-stats.json`).

One deliberate deviation from `archive/registrar/`'s zero-dep rule: this bot **signs
transactions**, so it uses `viem`. Nothing else.

## The safety model (read this before wiring secrets)

**The press wallet is petty cash, and it is NOT the creator fee recipient.** If the fee
recipient's key ever leaked from CI, `transferCreatorFeeRecipient` would hand a thief the
entire future fee stream. So:

- the founder's own wallet is the fee recipient, claims from the escrow on their own
  cadence, and tops up the press wallet's float
- the press wallet holds only that float plus gas — its published address IS the audit
- the escrow claim step in the bot is a harmless no-op unless the press wallet happens to
  be owed something directly
- v1.1 replaces this with a permissionless `claimAndSplit()` splitter contract; until
  then the top-up is the one manual touch per week

Other guards: the ops slice moves **only at or above fair value** (Chainlink feed vs
dexscreener; unchecked = held, never moved blind). **The press is the TWAP**: each run
works `PRESS_FRACTION_BPS` (default 1/6) of the wallet's float, so a weekly top-up drips
into the pool over days. The burn leg in pool phase goes through Uniswap v4's Universal
Router on this chain (`v4.ts`, quoted first by the v4 Quoter; `V4_SWAP_ENABLED=0` holds
it). `MIN_PRESS_GME` skips dust presses (they still post — the habit is the product).

**The buy bot** is the `buys` job (`.github/workflows/buys.yml`, every 5 minutes): it scans
the pool's Swap events since the last block and posts each buy above `MIN_BUY_USD` with one
hamster per `BUY_STEP_USD`. Safeguard's buy bot does not support Robinhood Chain.

## The two-wallet shape (recommended)

The founder claims from the escrow and splits **by hand**: 45% to the stash (cold, new
seed, never signs), 45% to the **burn wallet**, 10% stays as ops. The bot's key is the burn
wallet's, and the burn wallet's whole history is buys and burns. Configure the bot for it:
`BURN_BPS=10000 STASH_BPS=0 OPS_BPS=0`, and it drips one-sixth of the burn wallet's float
into the pool every four hours. No automated key can ever touch the stash.

## Setup

```
cd press && npm install
cp ../.env .env.press  # or export directly
npm run doctor         # works before the token exists
npm run dry            # full press logic, no transactions
```

## Environment

| Var | When | What |
|---|---|---|
| `PRESS_WALLET_KEY` | now | petty-cash wallet private key (NEVER the fee recipient) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | now | @BotFather token + channel id |
| `TOKEN_ADDRESS` | launch day | $GMERALD |
| `STASH_ADDRESS` / `OPS_ADDRESS` | launch day | published wallets |
| `ESCROW_ADDRESS` | now | pons fee escrow, verified on-chain: `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e` |
| `PEG_FEED_ADDRESS` | default set | Chainlink "Robinhood GME / USD" `0x27C71df6A64fB476468EdF256CF72c038baB5B67` (8 dp, 24h heartbeat, 0.5% deviation) |
| `GRAD_SEED_GME` | after graduation | GME seeded into the pool, counted in "GME sunk" |
| `PRESS_SLICE_GME` (0 = fraction mode) / `CADENCE_MIN` (15) / `REFRESH_MIN` (55) | set | the 15-minute TWAP: slice per run, cadence for the site, how often idle runs refresh the numbers (every commit is a deploy) |
| `SLIPPAGE_BPS` (200) / `MIN_PRESS_GME` (0.05) / `PEG_TOLERANCE_BPS` (0) | optional | tuning |

GitHub Actions: secrets `PRESS_WALLET_KEY`, `TELEGRAM_BOT_TOKEN`; everything else as
repository **variables** (they're public addresses — that's the point). Set with
`gh secret set` / `gh variable set`. The workflow exits cleanly until `TOKEN_ADDRESS`
exists, so arm the cron whenever.

## The manual press (fallback, forever)

After a manual press, record it so the site shows it:
`npx tsx src/index.ts log --burned <gmerald burned> --stashed <gme> --burn-tx 0x.. --stash-tx 0x..`
then commit and push the two json files in `site/`.

Wallet app on the phone: (1) top up / claim GME, (2) send 45% to the stash address,
(3) swap 45% GME -> $GMERALD on pons and burn it (send to the token's `burn`, or
transfer to `0x...dEaD` if the UI has no burn), (4) 10% to ops if the peg reads at/above
fair, (5) paste both hashes into the telegram template. Ten minutes.

## Dip mode

Every run reads the pool from dexscreener (independent of our RPC): the price now, and the
recent high reconstructed from the change points it publishes (1h, 6h, 24h ago). Price
10%+ (`DIP_BAND_BPS`) **under** that high: the slice doubles. A fresh high with the last hour
up 10%+: the slice halves. Otherwise the normal `PRESS_SLICE_GME`. Coarse on purpose: a rule
that reacts to every candle gets front-run the moment someone reads this file. `DIP_MODE=0`
turns it off. The reason is written into the ledger row and the post.

The same market read guards the swap: if our RPC's quote disagrees with the market by more
than `QUOTE_SANITY_BPS` (15%), the slice is held rather than executed against a bad number.

## What the key can and cannot do

The token and the stash address are pinned in code; a changed repository variable makes the
bot refuse to run. In burn-only mode the bot makes four kinds of calls: `approve`, a swap on
Uniswap's canonical router, and `burn`. There is no transfer to any address in the code path.
