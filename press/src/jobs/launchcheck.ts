// Launch morning, one command: every pre-launch read from GO.md phase 3, plus
// the exact launchAndBuy parameters printed ready to sign. This job only
// reads the chain and prints; the founder's wallet does the signing.
import { formatUnits, toHex } from 'viem';
import { parseAbi } from 'viem';
import { cfg } from '../env.js';
import { pub } from '../chain.js';

const launchAbi = parseAbi([
  'struct LaunchConfig { uint256 supply; uint256 curveFeeBps; uint256 phantomQuote; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; bool enabled; }',
  'function canLaunch(address) view returns (bool)',
  'function launchFee() view returns (uint256)',
  'function maxCreatorTaxBps() view returns (uint16)',
  'function launchConfigCount() view returns (uint256)',
  'function getLaunchConfig(uint256 id) view returns (LaunchConfig)',
  'function approvedPairTokens(address) view returns (bool)',
  'function pairTokenEconomics(address) view returns (uint256 phantomQuote, uint256 graduationThreshold, uint8 decimals)',
  'function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)',
]);

const ok = (l: string, d = '') => console.log(`  ✓ ${l}${d ? ` — ${d}` : ''}`);
const bad = (l: string, d = '') => console.log(`  ✗ ${l}${d ? ` — ${d}` : ''}`);

export async function runLaunchCheck(): Promise<void> {
  const founder = (process.env.FOUNDER_ADDRESS ?? '') as `0x${string}` | '';
  const read = <T>(functionName: string, args: unknown[] = []) =>
    pub.readContract({ address: cfg.factory, abi: launchAbi, functionName, args } as never) as Promise<T>;

  console.log('launch check — gmerald, paired with gme, config 0\n');
  let go = true;

  if (founder) {
    const can = await read<boolean>('canLaunch', [founder]);
    can ? ok('canLaunch(founder)') : ((go = false), bad('canLaunch(founder)', 'gate closed for this address'));
  } else {
    const can = await read<boolean>('canLaunch', ['0x000000000000000000000000000000000000dEaD']);
    can
      ? ok('public launch gate open', 'set FOUNDER_ADDRESS to check your wallet specifically')
      : ((go = false), bad('public gate closed', 'whitelist only right now — set FOUNDER_ADDRESS and re-run'));
  }

  const config = await read<{ enabled: boolean; curveFeeBps: bigint }>('getLaunchConfig', [0n]);
  config.enabled ? ok('config 0 enabled', `curve fee ${config.curveFeeBps} bps`) : ((go = false), bad('config 0 DISABLED'));

  const approved = await read<boolean>('approvedPairTokens', [cfg.gme]);
  approved ? ok('gme approved as pair') : ((go = false), bad('gme pair approval REVOKED'));

  const econ = await read<[bigint, bigint, number]>('pairTokenEconomics', [cfg.gme]);
  econ[1] > 0n
    ? ok('gme pair economics', `phantom ${formatUnits(econ[0], 18)} gme, graduation ${formatUnits(econ[1], 18)} gme`)
    : ((go = false), bad('gme pair economics empty'));

  const maxTax = await read<number>('maxCreatorTaxBps');
  Number(maxTax) >= 200 ? ok('2% creator tax under cap', `cap ${maxTax} bps`) : ((go = false), bad('cap below 200 bps'));

  const [fee, pin] = await Promise.all([
    read<bigint>('launchFee'),
    read<`0x${string}`>('previewLaunchEconomics', [0n, cfg.gme]),
  ]);
  ok('launch fee', `${formatUnits(fee, 18)} ETH (sent as value)`);
  ok('economics pin (read NOW, use NOW)', pin);

  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));

  console.log(`\n${go ? 'ALL CLEAR.' : 'BLOCKED — fix the ✗ lines first.'} launchAndBuy args, ready to sign:\n`);
  console.log(JSON.stringify({
    params: {
      name: 'Gmerald',
      symbol: 'GMERALD',
      logo: 'ipfs://<pin the head mark first>',
      description: 'He buys GameStop and burns himself. Every 4 hours. Forever.',
      socials: { twitter: 'https://x.com/gmeraldexe', telegram: 'https://t.me/GMERALDportal', discord: '', website: 'https://gmerald.xyz', farcaster: '' },
      creatorFeeRecipient: founder || '<FOUNDER WALLET — never the press wallet>',
      creatorTaxBps: 200,
      buybackEnabled: false,
      expectedEconomics: pin,
      salt,
    },
    launchConfigId: 0,
    pairToken: cfg.gme,
    quoteIn: '<opening buy, in gme wei — the pre-announced size>',
    minTokensOut: '<from the quoted rate, slippage-adjusted>',
    recipient: founder || '<FOUNDER WALLET>',
    snipeTaxExemptions: [],
  }, null, 2));
  console.log('\nremember: ERC-20 pair, so approve the launchAndBuy router for quoteIn first,');
  console.log('and send ONLY the launch fee as value. the pin above goes stale if pons edits');
  console.log('the config — re-run this check immediately before signing.');
}
