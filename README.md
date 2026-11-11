# percolator-mint: mint the official Percolator agent (static, no server, no keys)

Live: https://mint.percolator.tech (Cloudflare Pages project `percolator-mint`, also https://percolator-mint.pages.dev)

One transaction, built in the browser and signed only by the connected wallet:
1. `mpl-core` `create` (program `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`): asset name `Percolator`, uri `https://arweave.net/4ZnXT2_B59DsyQzuV-SouhvhBqxeIVY1Rp6goUvwn78`, owner = wallet, no updateAuthority arg (so update authority = wallet), no collection.
2. `mpl-agent-registry` `registerIdentityV1` (program `1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p`): `agentRegistrationUri` = the same Arweave URI; creates the AgentIdentityV2 PDA `["agent_identity", asset]` and attaches the AgentIdentity plugin (Transfer/Update/Execute hooks).

The asset keypair is generated in the browser and signs only its own creation. The page simulates the exact tx (`sigVerify:false`), decodes the would-be asset from the simulated account data, and only enables signing when all checks pass (genesis matches cluster, owner = update authority = wallet, only the AgentIdentity plugin, URIs match, balance covers total) and the user ticks an approval box. Quotes expire after 60 s.

Build: `npm install && npm run build` (esbuild → `public/app.js`). Deploy: `npx wrangler pages deploy public --project-name percolator-mint --branch main`.
Tests (never sign): `node test/simulate-devnet.mjs [payer] [devnet|mainnet-beta]`, `python3 test/live-browser.py https://mint.percolator.tech/` (mock wallet that refuses to sign).
Default RPCs: devnet `https://api.devnet.solana.com`, mainnet `https://solana-rpc.publicnode.com` (the public mainnet-beta RPC returns 403 to browsers). An RPC override field is on the page.

## v2.1 (2026-11-11): $CLAWD `tokens` list + on-asset mirror
- Every agent minted here carries `tokens: [{ kind: "token2022", symbol: "CLAWD", mint: "8cHzQHUS2s2h8TzCmfqPKYiM4dSt4roa3n7MyRLApump", primary: true, pairing: "metadata", registry: null, … }]`:
  in `agentMetadata` (API mode) and in the default mint URI, now the v3 registration `https://arweave.net/WFt5WZJ8lE0AJ8wKcSc5LCtX70JhDI1VXe1a8cR47pw` (Turbo free tier). Art uploads also write `tokens`.
- Section 7 (optional): Core **Attributes** plugin mirror on the agent NFT (`agent_token`, `agent_token_symbol`, `agent_token_kind`, `agent_token_chain`, `agent_token_primary`).
  `addPlugin` (or `updatePlugin`, keeping other traits). The update authority's wallet signs after simulate + quote + tick. Only Core in the tx.
  Simulated (unsigned) on the devnet rehearsal asset `HnfZ…x1m4`: OK, 13,540 CU, **0.00121396 SOL** (0.00120396 rent for asset growth + 0.000005 fee). `test/attributes-devnet-sim.mjs`.
- Enforced on-chain pairing will come from `Solizardking/percolator-agent-registry` (test chains only today).
