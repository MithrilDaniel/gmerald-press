// The board giveaway draw. Anyone can rerun it: the inputs are a snapshot block, a draw block, the
// threshold, and the public holder state; the randomness is the draw block's hash.
//   npx tsx src/raffle/draw.mts --snapshot <block> --draw <block> [--n 3] [--threshold 250000] [--out ../design/raffle/board-1]
// The draw block must be later than the snapshot block and already mined. Winners are posted by
// address; a winner claims by sending 1 $gmerald from that wallet to the burn wallet (the machine
// burns it) and telling the burrow the tx and a shipping address.
import { createPublicClient, http, parseAbiItem, formatUnits, keccak256, encodePacked } from 'viem';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const arg = (k: string, d = '') => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? (process.argv[i + 1] ?? d) : d; };
const RPC = process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
const TOKEN = '0x3E4E7bbee9A7e5fBEdABeEa66313C8f636999458' as const;
const INFRA = new Set(['0x267444d099b10fb5ed7c3cc7b7c767adca574952', '0x8366a39cc670b4001a1121b8f6a443a643e40951', '0x259c3fc3dad6b8e418b44c238c7be65284244e4a', '0x3f6f2e902be8736c0d59aba82d5975f395b9b825', '0xded25195d733d7e4c6377250ad57d062da82bd53', '0x9a3ae500fcb5a5c5a596a6fb16bd2e441f7cbdbf', '0x278bbe133891bc4034de1ec3a1de5ebdc2913aca']); // locker, pool manager, stash, burn wallet, airdrop wallet, the founder's wallets
const snapshot = BigInt(arg('snapshot')), draw = BigInt(arg('draw')), n = Number(arg('n', '3')), threshold = Number(arg('threshold', '250000')), out = arg('out', '../design/raffle/board-1');
if (!snapshot || !draw || draw <= snapshot) throw new Error('need --snapshot and a later --draw block');
const pub = createPublicClient({ transport: http(RPC, { retryCount: 6, retryDelay: 1500 }) });
const latest = await pub.getBlockNumber(); if (draw > latest) throw new Error(`draw block ${draw} is not mined yet (latest ${latest})`);
// candidates: every wallet the public state knows, plus anyone who received tokens between the state's last block and the snapshot
const st = JSON.parse(readFileSync(arg('state', '../site/holders-state.json'), 'utf8')) as { lastBlock: string; balances: Record<string, string> };
const cands = new Set(Object.keys(st.balances));
const ev = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
let from = BigInt(st.lastBlock) + 1n, step = 20000n;
while (from <= snapshot) { const to = from + step - 1n > snapshot ? snapshot : from + step - 1n; try { for (const l of await pub.getLogs({ address: TOKEN, event: ev, fromBlock: from, toBlock: to })) cands.add((l.args.to as string).toLowerCase()); from = to + 1n; } catch (e) { if (step > 1000n) { step /= 2n; continue; } throw e; } }
// balances at the snapshot block, exactly
const abi = [parseAbiItem('function balanceOf(address) view returns (uint256)')];
const seats: { address: string; balance: number }[] = [];
for (const a of cands) { if (INFRA.has(a)) continue; const b = Number(formatUnits(await pub.readContract({ address: TOKEN, abi, functionName: 'balanceOf', args: [a as `0x${string}`], blockNumber: snapshot }), 18)); if (b >= threshold) seats.push({ address: a, balance: Math.round(b) }); }
seats.sort((x, y) => (x.address < y.address ? -1 : 1));
// the draw: seed = the draw block's hash; winner i = keccak(seed, i) mod remaining, without replacement
const block = await pub.getBlock({ blockNumber: draw }); const seed = block.hash!;
const pool = seats.map((s) => s.address); const winners: { seat: string; balance: number; index: number }[] = [];
for (let i = 0; i < n && pool.length; i++) { const h = keccak256(encodePacked(['bytes32', 'uint256'], [seed, BigInt(i)])); const idx = Number(BigInt(h) % BigInt(pool.length)); const w = pool.splice(idx, 1)[0]; winners.push({ seat: w, balance: seats.find((s) => s.address === w)!.balance, index: idx }); }
const result = { giveaway: 'board #1', rule: `hold ${threshold.toLocaleString()} $gmerald or more at the snapshot block; one seat, one ticket; infra and the founder's wallets excluded`, snapshotBlock: snapshot.toString(), snapshotTime: new Date(Number((await pub.getBlock({ blockNumber: snapshot })).timestamp) * 1000).toISOString(), drawBlock: draw.toString(), drawBlockHash: seed, seats: seats.length, winners, claim: 'send 1 $gmerald from the winning wallet to the burn wallet 0x3f6f2e902bE8736c0D59aBA82d5975F395b9B825 within 72 hours, then dm the burrow the tx and a shipping address. unclaimed prizes are redrawn from the same list with the next index.', script: 'press/src/raffle/draw.mts in MithrilDaniel/gmerald-press' };
mkdirSync(out, { recursive: true }); writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 1)); writeFileSync(`${out}/seats.json`, JSON.stringify(seats, null, 1));
console.log(`${seats.length} seats at block ${snapshot} · draw block ${draw} hash ${seed.slice(0, 18)}…`); for (const w of winners) console.log(`winner: ${w.seat} (${w.balance.toLocaleString()} $gmerald)`); console.log(`written to ${out}/`);
