// The Press. Every four hours: claim what is claimable, split what the
// wallet holds 45/45/10, burn, stash, and move ops only at fair value.
// Whatever the number is — large or embarrassing — the press posts.
import { formatUnits, parseUnits } from 'viem';
import { cfg, launched } from './env.js';
import { pub, wallet, account } from './chain.js';
import { erc20Abi, factoryAbi, escrowAbi, curveAbi } from './abis.js';
import { quoteBuy } from './quote.js';
import { quoteGmeToToken, swapGmeToToken } from './v4.js';
import { checkPeg } from './peg.js';
import { readMarket } from './market.js';
import { readHolders } from './holders.js';
import { keccak256, encodeAbiParameters } from 'viem';
import { poolKey } from './v4.js';
import { appendPress, readLedger, writeLedger, writeStats, burnGmeTotal, statsPath, countKind, hasTx, dailyRollup } from './ledger.js';
import { parseAbiItem } from 'viem';
import { readFileSync } from 'node:fs';
import { post } from './telegram.js';

const fmt = (v: bigint, dp = 2) => Number(formatUnits(v, 18)).toFixed(dp);
const TOTAL_SUPPLY = 10n ** 27n; // 1,000,000,000 * 1e18, verified on-chain

async function waitTx(hash: `0x${string}`) {
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== 'success') throw new Error(`tx reverted: ${hash}`);
  return hash;
}

function staleStats(): boolean {
  try {
    const at = JSON.parse(readFileSync(statsPath(), 'utf8')).checkedAt;
    return !at || Date.now() - new Date(at).getTime() > cfg.refreshMin * 60_000;
  } catch { return true; }
}

// The stash scanner: every GME transfer into the stash is a press (a claim landing),
// found by reading the chain, never by a human pasting a hash. Returns how many were new.
async function scanStash(fairUsd?: number): Promise<number> {
  if (!cfg.stash) return 0;
  const ledger = readLedger();
  const latest = await pub.getBlockNumber();
  const from = ledger.stashScanBlock ? BigInt(ledger.stashScanBlock) + 1n : latest - 200000n; // first run: ~5.5 hours back
  if (from > latest) return 0;
  const logs = await pub.getLogs({
    address: cfg.gme,
    event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
    args: { to: cfg.stash as `0x${string}` }, fromBlock: from, toBlock: latest,
  });
  // gme that landed in the burn wallet from the same sender in the same window is part of the press too
  // (the 45% for snacks, and whatever else the founder fed the machine); the row says how much, not why.
  const fed = cfg.pressWallet ? await pub.getLogs({
    address: cfg.gme, event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
    args: { to: cfg.pressWallet as `0x${string}` }, fromBlock: from, toBlock: latest,
  }) : [];
  let added = 0;
  for (const log of logs) {
    const tx = log.transactionHash; const amt = log.args.value as bigint;
    if (amt === 0n || hasTx(tx)) continue;
    const gme = Number(formatUnits(amt, 18));
    const sender = (log.args.from as string).toLowerCase();
    const toBurn = fed.filter((f) => (f.args.from as string).toLowerCase() === sender).reduce((t, f) => t + Number(formatUnits(f.args.value as bigint, 18)), 0);
    const fedNote = toBurn > 0 ? ` ${toBurn.toFixed(2)} gme went to the burn wallet in the same press, for snacks.` : '';
    const entry = appendPress({
      kind: 'press',
      note: `press: ${gme.toFixed(2)} gme claimed from fees and stashed. never sold, never distributed.${fedNote}`,
      burnedGmerald: '0', burnGmeSpent: '0', stashedGme: gme.toFixed(4), opsMovedGme: '0',
      pegStatus: 'n/a', stashTx: tx, gmeUsd: fairUsd && fairUsd > 0 ? fairUsd : undefined,
    });
    await post([`press #${entry.k} \u{1F439}`, `stashed ${gme.toFixed(2)} gme — ${cfg.explorer}/tx/${tx}`, `the stash: ${cfg.explorer}/address/${cfg.stash}`].join('\n'));
    added++;
  }
  const l2 = readLedger(); l2.stashScanBlock = latest.toString(); writeLedger(l2);
  return added;
}

export async function runPress(): Promise<void> {
  // The peg reading is free (feed + dexscreener) and worth publishing before
  // launch: the site shows the machine's sensor is real while gerald naps.
  const peg = await checkPeg();
  console.log(`[press] peg: ${peg.status} — ${peg.note}`);
  const pegOut = { status: peg.status, premiumBps: peg.premiumBps, tokenUsd: peg.tokenUsd, fairUsd: peg.fairUsd, note: peg.note };
  const holders = await readHolders(); if (holders) console.log(`[holders] ${holders}`);

  if (!launched()) {
    if (!cfg.dry) {
      writeStats({ presses: 0, burnedPct: '0.00', stashGme: '0', gmeSunk: '0', status: 'napping til launch', updatedAt: null, checkedAt: new Date().toISOString(), peg: pegOut });
    }
    console.log('[press] not launched yet — wrote the peg check only. exiting cleanly.');
    return;
  }
  const token = cfg.token as `0x${string}`;
  const stash = (cfg.stash || '0x0000000000000000000000000000000000000000') as `0x${string}`;

  const bal = (holder: `0x${string}`, asset: `0x${string}`) =>
    pub.readContract({ address: asset, abi: erc20Abi, functionName: 'balanceOf', args: [holder] });

  const newPresses = cfg.dry ? 0 : await scanStash(peg.fairUsd);
  if (newPresses) console.log(`[press] stash scan: ${newPresses} new press(es) logged from the chain`);
  const mustWrite = () => newPresses > 0 || staleStats();

  if (!cfg.key) {
    // Launched, but the bot has no key yet: the founder presses by hand. Refresh
    // what the site reads (supply, stash, peg) and leave without signing anything.
    const [supply, stashBal] = await Promise.all([
      pub.readContract({ address: token, abi: erc20Abi, functionName: 'totalSupply' }),
      cfg.stash ? bal(stash, cfg.gme) : Promise.resolve(0n),
    ]);
    const stashGme = Number(formatUnits(stashBal, 18));
    if (!cfg.dry && mustWrite()) {
      writeStats({
        presses: countKind('press'), snacks: countKind('snack'),
        burnedPct: ((Number(TOTAL_SUPPLY - supply) / Number(TOTAL_SUPPLY)) * 100).toFixed(2),
        stashGme: stashGme.toFixed(2),
        gmeSunk: (stashGme + burnGmeTotal() + Number(cfg.gradSeedGme)).toFixed(2),
        status: 'pressing by hand until the bot wakes',
        updatedAt: readLedger().presses.at(-1)?.ts ?? null,
        checkedAt: new Date().toISOString(),
        peg: pegOut,
        cadenceMin: cfg.cadenceMin, days: dailyRollup(), holders,
      });
    }
    console.log(`[press] no PRESS_WALLET_KEY — refreshed the numbers (stash ${stashGme.toFixed(2)} GME) and left. the founder presses by hand.`);
    return;
  }

  const me = account().address;
  const w = wallet();

  // 0. Where is the launch — curve or pool?
  const launch = await pub.readContract({
    address: cfg.factory, abi: factoryAbi, functionName: 'getLaunchedToken', args: [token],
  });
  const phase = launch.phase; // 0 curve, 1 swept, 2 pool, 3 rescued
  const curve = launch.curve;

  // 1. Claim anything the escrow owes this wallet (a no-op unless this wallet
  //    is the fee recipient — by design it usually is not; see README).
  if (cfg.escrow) {
    const owed = await pub.readContract({
      address: cfg.escrow as `0x${string}`, abi: escrowAbi,
      functionName: 'balanceOfToken', args: [me, cfg.gme],
    });
    if (owed > 0n && !cfg.dry) {
      await waitTx(await w.writeContract({
        address: cfg.escrow as `0x${string}`, abi: escrowAbi,
        functionName: 'claimToken', args: [cfg.gme],
      }));
      console.log(`[press] claimed ${fmt(owed)} GME from escrow`);
    }
  }

  // 2. The float. Everything the wallet holds is pressed; held-back ops
  //    slices from earlier presses roll in naturally.
  const floatBal = await bal(me, cfg.gme);
  if (cfg.napUntil && Date.now() < new Date(cfg.napUntil).getTime()) {
    // Napping: no slice, no post. Presses are still logged above; the numbers refresh hourly.
    if (!cfg.dry && mustWrite()) {
      const [supply, stashBal] = await Promise.all([
        pub.readContract({ address: token, abi: erc20Abi, functionName: 'totalSupply' }),
        cfg.stash ? bal(stash, cfg.gme) : Promise.resolve(0n),
      ]);
      const stashGme = Number(formatUnits(stashBal, 18));
      writeStats({
        presses: countKind('press'), snacks: countKind('snack'), queuedGme: formatUnits(floatBal, 18), sliceGme: '0', slicesLeft: 0,
        burnedPct: ((Number(TOTAL_SUPPLY - supply) / Number(TOTAL_SUPPLY)) * 100).toFixed(2),
        stashGme: stashGme.toFixed(2), gmeSunk: (stashGme + burnGmeTotal() + Number(cfg.gradSeedGme)).toFixed(2),
        status: `napping until ${cfg.napUntil.slice(11, 16)} utc`, updatedAt: readLedger().presses.at(-1)?.ts ?? null,
        checkedAt: new Date().toISOString(), peg: pegOut, cadenceMin: cfg.cadenceMin, days: dailyRollup(), holders,
      });
    }
    console.log(`[press] napping until ${cfg.napUntil} — ${fmt(floatBal, 2)} GME waits in the burn wallet.`);
    return;
  }
  // The TWAP: each press works a fixed fraction of the float (default 1/6), so a
  // weekly top-up drips into the pool over days instead of landing in one fill.
  // Slice mode (the 15-minute TWAP): a fixed amount per run, and the tail is
  // folded into the last slice rather than left as dust.
  // Dip mode: read the market once (independent of our RPC) and scale the slice.
  const pk = poolKey(token);
  const poolId = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }], [pk.currency0, pk.currency1, pk.fee, pk.tickSpacing, pk.hooks]));
  const market = await readMarket(poolId);
  let mult = 1n, why = '';
  if (cfg.dipMode && market) {
    // vsHighBps is 0 at a fresh high and negative below it. A dip: 10%+ under the recent
    // high → double. Hot: a fresh high with the last hour up 10%+ → half.
    const h1 = market.h1;
    if (market.vsHighBps <= -cfg.dipBandBps) { mult = 2n; why = `double: price ${(-market.vsHighBps / 100).toFixed(1)}% under its recent high`; }
    else if (market.vsHighBps === 0 && h1 >= cfg.dipBandBps / 100) { mult = 0n; why = `half: a fresh high, up ${h1.toFixed(1)}% in the hour`; }
  }
  if (market) console.log(`[press] market: ${market.priceGme.toExponential(3)} gme per token, ${(market.vsHighBps / 100).toFixed(1)}% vs its recent high${why ? ` → ${why}` : ''}`);
  let base = parseUnits(cfg.pressSliceGme, 18);
  if (cfg.pressSliceUsd > 0 && peg.tokenUsd && peg.tokenUsd > 0) {
    const floor = parseUnits((cfg.pressSliceUsd / peg.tokenUsd).toFixed(6), 18);
    if (floor > base) { base = floor; console.log(`[press] slice floor: $${cfg.pressSliceUsd} = ${fmt(floor, 2)} GME at $${peg.tokenUsd.toFixed(2)}`); }
  }
  let slice = mult === 2n ? base * 2n : mult === 0n ? base / 2n : base;
  if (cfg.pressSpreadHours > 0 && floatBal > 0n) {
    // Batch = everything since the last press. Ticks in the window minus snacks already done.
    const all = readLedger().presses;
    const lastPressIdx = all.map((p) => p.kind ?? 'press').lastIndexOf('press');
    const lastPress = lastPressIdx >= 0 ? all[lastPressIdx] : undefined;
    const done = lastPress ? all.slice(lastPressIdx + 1).filter((p) => p.kind === 'snack').length : 0;
    const total = Math.max(1, Math.round((cfg.pressSpreadHours * 60) / cfg.cadenceMin));
    // A batch that already used its window (or a press the scanner has not seen yet) is treated
    // as a fresh batch, never as "one tick left".
    const left = done >= total ? total : total - done;
    slice = floatBal / BigInt(left);
    console.log(`[press] spread: ${cfg.pressSpreadHours}h = ${total} ticks, ${done} snacks done since the last press, ${left} left → ${fmt(slice, 2)} GME each`);
  }
  let gmeBal = slice > 0n ? (floatBal < slice ? floatBal : slice) : (floatBal * cfg.pressFractionBps) / cfg.BPS;
  if (slice > 0n && floatBal > gmeBal && floatBal - gmeBal < slice / 2n) gmeBal = floatBal;
  const minPress = parseUnits(cfg.minPressGme, 18);
  console.log(`[press] float: ${fmt(floatBal, 4)} GME, pressing ${fmt(gmeBal, 4)} (phase ${phase}, dry=${cfg.dry})`);

  // Rule: nothing $GMERALD ever sits in this wallet. Whatever is here gets burned
  // on this run, whether or not there is GME to press (a slice burns its own buy
  // plus anything left over; a sweep burns leftovers alone).
  const heldTok = await bal(me, token);
  const sweepOnly = gmeBal < minPress && heldTok > 0n;

  if (gmeBal < minPress && !sweepOnly) {
    // Nothing to press: no ledger row, no post. Between claims gerald naps quietly,
    // and the site's numbers get a refresh about once an hour.
    if (!cfg.dry && mustWrite()) {
      const [supply, stashBal] = await Promise.all([
        pub.readContract({ address: token, abi: erc20Abi, functionName: 'totalSupply' }),
        cfg.stash ? bal(stash, cfg.gme) : Promise.resolve(0n),
      ]);
      const stashGme = Number(formatUnits(stashBal, 18));
      writeStats({
        presses: countKind('press'), snacks: countKind('snack'), queuedGme: '0',
        burnedPct: ((Number(TOTAL_SUPPLY - supply) / Number(TOTAL_SUPPLY)) * 100).toFixed(2),
        stashGme: stashGme.toFixed(2),
        gmeSunk: (stashGme + burnGmeTotal() + Number(cfg.gradSeedGme)).toFixed(2),
        status: 'napping between claims',
        updatedAt: readLedger().presses.at(-1)?.ts ?? null,
        checkedAt: new Date().toISOString(),
        peg: pegOut,
        cadenceMin: cfg.cadenceMin, days: dailyRollup(), holders,
      });
    }
    console.log('[press] nothing to press — gerald napped (no row, no post).');
    return;
  }

  let note = why ? `pressed · ${why}` : 'pressed';
  let burnedGmerald = '0';
  let burnGmeSpent = '0';
  let stashedGme = '0';
  let opsMovedGme = '0';
  let burnTx: string | undefined;
  let stashTx: string | undefined;
  let opsTx: string | undefined;

  if (sweepOnly) {
    note = 'burned what was waiting in the burn wallet';
    if (cfg.dry) {
      console.log(`[press] dry: would burn ${fmt(heldTok, 0)} $GMERALD already held`);
    } else {
      burnTx = await waitTx(await w.writeContract({ address: token, abi: erc20Abi, functionName: 'burn', args: [heldTok] }));
      burnedGmerald = fmt(heldTok, 0);
    }
  } else {
    const burnAmt = (gmeBal * cfg.burnBps) / cfg.BPS;
    const stashAmt = (gmeBal * cfg.stashBps) / cfg.BPS;
    const opsAmt = gmeBal - burnAmt - stashAmt;

    // 3. Burn leg: GME -> $GMERALD in our own venue, then burn. On the curve
    //    this is a direct buy; in the pool it needs the v4 route, which stays
    //    off until tested — the leg is held, never guessed.
    if (phase === 0) {
      const q = await quoteBuy(curve, burnAmt, me);
      const minOut = (q.tokensOut * (cfg.BPS - cfg.slippageBps)) / cfg.BPS;
      if (cfg.dry) {
        console.log(`[press] dry: would buy ~${fmt(q.tokensOut)} $GMERALD with ${fmt(q.spent, 4)} GME and burn it`);
      } else {
        await waitTx(await w.writeContract({
          address: cfg.gme, abi: erc20Abi, functionName: 'approve', args: [curve, burnAmt],
        }));
        burnTx = await waitTx(await w.writeContract({
          address: curve, abi: curveAbi, functionName: 'buy', args: [burnAmt, minOut, me],
        }));
        const bought = await bal(me, token);
        if (bought > 0n) {
          await waitTx(await w.writeContract({
            address: token, abi: erc20Abi, functionName: 'burn', args: [bought],
          }));
          burnedGmerald = fmt(bought, 0);
        }
        burnGmeSpent = formatUnits(burnAmt, 18);
      }
    } else if (phase === 2 && cfg.v4SwapEnabled) {
      const quoted = await quoteGmeToToken(token, burnAmt);
      const minOut = (quoted * (cfg.BPS - cfg.slippageBps)) / cfg.BPS;
      // Sanity: the quote comes from our RPC; the market read comes from dexscreener. If they
      // disagree by more than QUOTE_SANITY_BPS, something is lying and the slice is held.
      if (market && market.priceGme > 0) {
        const expected = Number(formatUnits(burnAmt, 18)) / market.priceGme;
        const gapBps = Math.round((Number(formatUnits(quoted, 18)) / expected - 1) * 10000);
        if (Math.abs(gapBps) > cfg.quoteSanityBps) throw new Error(`quote ${fmt(quoted, 0)} vs market ${expected.toFixed(0)} $GMERALD (${gapBps} bps apart); holding this slice`);
      }
      if (cfg.dry) {
        console.log(`[press] dry: would swap ${fmt(burnAmt, 4)} GME -> ~${fmt(quoted, 0)} $GMERALD on the v4 pool and burn it`);
      } else {
        const swapTx = await swapGmeToToken(token, burnAmt, minOut);
        console.log(`[press] swapped: ${cfg.explorer}/tx/${swapTx}`);
        const bought = await bal(me, token);
        if (bought > 0n) {
          burnTx = await waitTx(await w.writeContract({ address: token, abi: erc20Abi, functionName: 'burn', args: [bought] }));
          burnedGmerald = fmt(bought, 0);
          // Tokens that were already waiting in the wallet (a manual buy, a top-up) go into the
          // same burn; say so, so the row does not read like a miracle fill.
          if (heldTok > 0n) note = `${note} · plus ${fmt(heldTok, 0)} that was already waiting in the burn wallet`;
        }
        burnGmeSpent = formatUnits(burnAmt, 18);
      }
    } else if (phase === 2) {
      note = 'pressed — burn leg held (pool phase, V4_SWAP_ENABLED=0: swap+burn manually)';
    } else {
      note = `pressed — burn leg held (launch in transient phase ${phase})`;
    }

    // 4. Stash leg: already GME. One transfer, nothing to convert.
    if (stashAmt === 0n) {
      // burn-only wallet: nothing to stash here
    } else if (cfg.dry) {
      console.log(`[press] dry: would stash ${fmt(stashAmt, 4)} GME`);
    } else {
      stashTx = await waitTx(await w.writeContract({
        address: cfg.gme, abi: erc20Abi, functionName: 'transfer', args: [stash, stashAmt],
      }));
      stashedGme = formatUnits(stashAmt, 18);
    }

    // 5. Ops leg: moves only at or above fair value. Unchecked = held.
    const opsOk = peg.status === 'at-or-above' || cfg.opsForce;
    if (opsOk && cfg.ops && opsAmt > 0n) {
      if (cfg.dry) {
        console.log(`[press] dry: would move ${fmt(opsAmt, 4)} GME to ops`);
      } else {
        opsTx = await waitTx(await w.writeContract({
          address: cfg.gme, abi: erc20Abi, functionName: 'transfer', args: [cfg.ops as `0x${string}`, opsAmt],
        }));
        opsMovedGme = formatUnits(opsAmt, 18);
      }
    } else if (opsAmt > 0n) {
      console.log(`[press] ops slice held (${fmt(opsAmt, 4)} GME): peg ${peg.status}${cfg.ops ? '' : ', OPS_ADDRESS unset'}`);
    }
  }

  if (cfg.dry) {
    console.log('[press] dry run complete — no ledger, no stats, no post.');
    return;
  }

  // 6. Write the record the site reads.
  const remaining = await bal(me, cfg.gme);
  // Slices left: on the spread, the ticks left in the window; otherwise remaining / slice.
  let slicesLeft = slice > 0n ? Number((remaining + slice - 1n) / slice) : 0;
  let nextSlice = slice;
  if (cfg.pressSpreadHours > 0) {
    const all = readLedger().presses; const idx = all.map((p) => p.kind ?? 'press').lastIndexOf('press');
    const done = idx >= 0 ? all.slice(idx + 1).filter((p) => p.kind === 'snack').length : 0;
    const total = Math.max(1, Math.round((cfg.pressSpreadHours * 60) / cfg.cadenceMin));
    slicesLeft = remaining >= minPress ? Math.max(1, total - done) : 0;
    nextSlice = slicesLeft > 0 ? remaining / BigInt(slicesLeft) : 0n;
  }
  const entry = appendPress({
    kind: 'snack',
    note,
    burnedGmerald,
    burnGmeSpent: Number(burnGmeSpent).toFixed(4),
    stashedGme: Number(stashedGme).toFixed(4),
    opsMovedGme: Number(opsMovedGme).toFixed(4),
    pegStatus: `${peg.status}${peg.premiumBps != null ? ` (${peg.premiumBps >= 0 ? '+' : ''}${(peg.premiumBps / 100).toFixed(2)}%)` : ''}`,
    burnTx,
    stashTx,
    opsTx,
    gmeUsd: peg.fairUsd && peg.fairUsd > 0 ? peg.fairUsd : undefined,
  });

  const [supply, stashBal] = await Promise.all([
    pub.readContract({ address: token, abi: erc20Abi, functionName: 'totalSupply' }),
    cfg.stash ? bal(stash, cfg.gme) : Promise.resolve(0n),
  ]);
  const burnedPct = (Number(TOTAL_SUPPLY - supply) / Number(TOTAL_SUPPLY)) * 100;
  const stashGme = Number(formatUnits(stashBal, 18));
  const gmeSunk = stashGme + burnGmeTotal() + Number(cfg.gradSeedGme);

  let curveOut: { raisedGme: string; thresholdGme: string; pct: number } | undefined;
  if (phase === 0) {
    const [raised, threshold] = await Promise.all([
      pub.readContract({ address: curve, abi: curveAbi, functionName: 'realQuoteReserve' }),
      pub.readContract({ address: curve, abi: curveAbi, functionName: 'graduationThreshold' }),
    ]);
    curveOut = { raisedGme: fmt(raised, 2), thresholdGme: fmt(threshold, 0), pct: threshold > 0n ? Math.min(100, Number((raised * 10000n) / threshold) / 100) : 0 };
  }
  writeStats({
    presses: countKind('press'), snacks: countKind('snack'), queuedGme: formatUnits(remaining, 18), sliceGme: fmt(nextSlice, 2), slicesLeft,
    burnedPct: burnedPct.toFixed(2),
    stashGme: stashGme.toFixed(2),
    gmeSunk: gmeSunk.toFixed(2),
    status: remaining >= minPress ? `snacking. ${slicesLeft} slice${slicesLeft === 1 ? '' : 's'} of ~${fmt(nextSlice, 0)} gme to go` : 'napping between claims',
    updatedAt: entry.ts,
    checkedAt: entry.ts,
    peg: pegOut,
    curve: curveOut,
    cadenceMin: cfg.cadenceMin, days: dailyRollup(), holders,
  });

  // 7. Say it happened. Both hashes or it didn't.
  const lines = [
    `snack #${entry.k} \u{1F439}`,
    burnTx ? `burned ${burnedGmerald} $GMERALD${Number(burnGmeSpent) > 0 ? ` with ${Number(burnGmeSpent).toFixed(2)} gme` : ''} — ${cfg.explorer}/tx/${burnTx}` : null,
    stashTx ? `stashed ${entry.stashedGme} GME — ${cfg.explorer}/tx/${stashTx}` : null,
    opsTx ? `ops moved ${entry.opsMovedGme} GME (peg ${entry.pegStatus})` : null,
    note !== 'pressed' ? note.replace('pressed · ', '') : null,
    `burned: ${burnedPct.toFixed(2)}% of supply · gme sunk: ${gmeSunk.toFixed(2)} · ${remaining >= minPress ? `${slicesLeft} more to go, one every ${cfg.cadenceMin} min` : 'that was the last one until the next claim'}`,
  ].filter(Boolean);
  await post(lines.join('\n'));
  console.log(`[press] snack #${entry.k} complete.`);
}
