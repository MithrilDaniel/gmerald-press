// Preflight that works BEFORE the token exists: connectivity, identity,
// config completeness, integrations. Run it after every secret change.
import { formatUnits } from 'viem';
import { cfg, launched } from '../env.js';
import { pub, account } from '../chain.js';
import { erc20Abi, factoryAbi } from '../abis.js';
import { checkPeg } from '../peg.js';

const ok = (label: string, detail = '') => console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
const warn = (label: string, detail = '') => console.log(`  ⚠ ${label}${detail ? ` — ${detail}` : ''}`);

export async function runDoctor(): Promise<void> {
  console.log('press doctor\n');

  const chainId = await pub.getChainId();
  chainId === 4663 ? ok('rpc', `robinhood chain (${chainId})`) : warn('rpc', `unexpected chain id ${chainId}`);

  const [sym, approved] = await Promise.all([
    pub.readContract({ address: cfg.gme, abi: erc20Abi, functionName: 'symbol' }),
    pub.readContract({ address: cfg.factory, abi: factoryAbi, functionName: 'approvedPairTokens', args: [cfg.gme] }),
  ]);
  sym === 'GME' ? ok('gme stock token', cfg.gme) : warn('gme token symbol', `read "${sym}" — verify the address`);
  approved ? ok('gme approved as pons pair') : warn('gme NOT approved as pons pair anymore — re-plan before launch');

  if (cfg.key) {
    const me = account().address;
    const [eth, gme] = await Promise.all([
      pub.getBalance({ address: me }),
      pub.readContract({ address: cfg.gme, abi: erc20Abi, functionName: 'balanceOf', args: [me] }),
    ]);
    ok('press wallet', me);
    Number(formatUnits(eth, 18)) > 0.002
      ? ok('gas', `${Number(formatUnits(eth, 18)).toFixed(4)} ETH`)
      : warn('gas low', `${formatUnits(eth, 18)} ETH — top up for ~6 tx/press`);
    ok('float', `${Number(formatUnits(gme, 18)).toFixed(4)} GME`);
  } else warn('PRESS_WALLET_KEY unset', 'reads only; press will fail');

  launched()
    ? ok('launch config', `token ${cfg.token}, stash ${cfg.stash}`)
    : warn('not launched', 'TOKEN_ADDRESS / STASH_ADDRESS unset — press exits cleanly');
  cfg.escrow ? ok('escrow', cfg.escrow) : warn('ESCROW_ADDRESS unset', 'claim step skipped');
  cfg.ops ? ok('ops wallet', cfg.ops) : warn('OPS_ADDRESS unset', 'ops slice will be held');

  const peg = await checkPeg();
  peg.status === 'unchecked' ? warn('peg check', peg.note) : ok('peg check', peg.note);

  if (cfg.tgToken) {
    const res = await fetch(`https://api.telegram.org/bot${cfg.tgToken}/getMe`);
    res.ok ? ok('telegram bot') : warn('telegram', `getMe ${res.status}`);
    cfg.tgChat ? ok('telegram chat', cfg.tgChat) : warn('TELEGRAM_CHAT_ID unset');
  } else warn('telegram unset', 'presses will only log to console');

  console.log('\ndone.');
}
