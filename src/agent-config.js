// Single source of truth for the official Percolator agent. $CLAWD branding only; no new tickers.
export const NAME = 'Percolator';
export const URI_V1 = 'https://arweave.net/4ZnXT2_B59DsyQzuV-SouhvhBqxeIVY1Rp6goUvwn78';
// v2 registration: adds x402m + $CLAWD token service and token field (uploaded 2026-11-11 via Turbo free tier, throwaway signer)
export const URI_V2 = 'https://arweave.net/v9XDBEfoRlQCIKLolsjJm-ywC8VB0hGVNCyf4Pgtgns';
export const DESCRIPTION = 'Official Percolator agent for $CLAWD perpetuals. Reads and quotes markets on Solana devnet (program Anw121Fk3gKvUHXk938cY2xVb9Eq46WX3k15WESS49PA) and clawd chain through the read-only Percolator MCP, and offers Phoenix perps paper trading at trade.percolator.tech. Unaudited; devnet first; the user\'s wallet signs every transaction. Chat with it at https://x.ai/bot/9x8L2b2K8GSlEILhIXt53.';
// $CLAWD is the ONLY token ever paired with any Percolator agent. Never launch or bind another token.
export const CLAWD = Object.freeze({ symbol: 'CLAWD', name: 'solanaclawd', mint: '8cHzQHUS2s2h8TzCmfqPKYiM4dSt4roa3n7MyRLApump',
  chain: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', standard: 'spl-token-2022', launchpad: 'pump.fun',
  url: 'https://pump.fun/coin/8cHzQHUS2s2h8TzCmfqPKYiM4dSt4roa3n7MyRLApump',
  onchainAgentTokenSlot: 'unset: setAgentTokenV1 only accepts a Genesis mint-funded launch account, which $CLAWD can never have' });
export const X402M_DISCOVERY = 'https://musebook.trade/api/x402m/discovery';
export const SERVICES = [
  { name: 'MCP', endpoint: 'https://percolator.tech/mcp' },
  { name: 'web', endpoint: 'https://percolator.tech' },
  { name: 'trading', endpoint: 'https://trade.percolator.tech' },
  { name: 'install', endpoint: 'https://install.percolator.tech' },
  { name: 'chat', endpoint: 'https://x.ai/bot/9x8L2b2K8GSlEILhIXt53' },
  { name: 'x402m', endpoint: X402M_DISCOVERY },
  { name: 'token', endpoint: CLAWD.url },
];
export function agentMetadata() {
  return { type: 'agent', name: NAME, description: DESCRIPTION, services: SERVICES, registrations: [], supportedTrust: ['reputation'], token: { ...CLAWD } };
}
export const PROGRAMS = {
  core: 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d',
  agentIdentity: '1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p',
  agentTools: 'TLREGni9ZEyGC3vnPZtqUh95xQ8oPqJSvNjvB7FGK8S',
  system: '11111111111111111111111111111111',
  computeBudget: 'ComputeBudget111111111111111111111111111111',
};
export const CLUSTERS = {
  'mainnet-beta': { rpc: 'https://solana-rpc.publicnode.com', explorer: '', genesis: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    network: 'solana-mainnet', usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', chain: 'solana:mainnet' },
  devnet: { rpc: 'https://api.devnet.solana.com', explorer: '?cluster=devnet', genesis: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    network: 'solana-devnet', usdc: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', chain: 'solana:devnet' },
};
export const DEVNET_REHEARSAL_ASSET = 'HnfZet9JoK8h3KH4GM24od4oWVBvwYjfC5noByzLx1m4';
