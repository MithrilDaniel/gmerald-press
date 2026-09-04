import { createPublicClient, createWalletClient, defineChain, fallback, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { cfg } from './env.js';

export const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpcUrl] } },
});

// the public rpc rate-limits shared runners ("Too Many Requests"): back off and retry for a couple of minutes
// before giving up, and use a second rpc if one is configured (RPC_URL_2).
const opts = { retryCount: 6, retryDelay: 1500, timeout: 20_000 };
const transport = () => (cfg.rpcUrl2 ? fallback([http(cfg.rpcUrl, opts), http(cfg.rpcUrl2, opts)]) : http(cfg.rpcUrl, opts));
export const pub = createPublicClient({ chain: robinhood, transport: transport() });

export const account = () => {
  if (!cfg.key) throw new Error('PRESS_WALLET_KEY not set');
  const k = cfg.key.startsWith('0x') ? cfg.key : `0x${cfg.key}`;
  return privateKeyToAccount(k as `0x${string}`);
};

export const wallet = () =>
  createWalletClient({ account: account(), chain: robinhood, transport: transport() });
