# gmerald-press

The keeper of [$GMERALD](https://gmerald.xyz): a memecoin on Robinhood Chain priced in tokenized GameStop.
This is the code that burns. It is public so anyone can read exactly what it does.

- **a press** is a claim: creator fees come out of the pons escrow in GME. Half goes to the stash
  (`0x259c3Fc3Dad6B8e418b44c238C7Be65284244e4A`, never sold, never distributed), half to the burn wallet
  (`0x3f6f2e902bE8736c0D59aBA82d5975F395b9B825`). The bot finds every press by scanning the stash wallet's transfers.
- **a snack** is a burn: every 15 minutes, while the burn wallet holds GME, 20 GME buys $GMERALD from the
  locked Uniswap v4 pool and the bot calls `burn()` on everything it holds. The GME stays in the pool forever.

`site/press-ledger.json` and `site/press-stats.json` are what [gmerald.xyz](https://gmerald.xyz) reads.
`site/press-ledger-all.json` is the full archive. Every row carries its transaction hash.

The bot's key can move only what is in the burn wallet. It has no path to the stash, the deployer, or the fee stream.
See `press/README.md` for the safety model and the environment.

token `0x3E4E7bbee9A7e5fBEdABeEa66313C8f636999458` · [explorer](https://robinhoodchain.blockscout.com/address/0x3E4E7bbee9A7e5fBEdABeEa66313C8f636999458)
