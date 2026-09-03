import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { cfg } from './env.js';

export const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpcUrl] } },
});

export const pub = createPublicClient({ chain: robinhood, transport: http(cfg.rpcUrl) });

export const account = () => {
  if (!cfg.key) throw new Error('PRESS_WALLET_KEY not set');
  const k = cfg.key.startsWith('0x') ? cfg.key : `0x${cfg.key}`;
  return privateKeyToAccount(k as `0x${string}`);
};

export const wallet = () =>
  createWalletClient({ account: account(), chain: robinhood, transport: http(cfg.rpcUrl) });
