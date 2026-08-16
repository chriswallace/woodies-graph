# woodies-graph

GraphQL endpoint for verifying [Woodies](https://opensea.io/collection/woodies-generative-characters) holders, built for Decentraland scene gating.

This replaces the old Hasura instance at `woodies-data-production.herokuapp.com/v1/graphql`, which died when Heroku shut down its free tier. The old stack (Hasura + Postgres + an indexer keeping a holders table in sync) is replaced by a single **Cloudflare Worker with no database**: holder checks are answered by calling `balanceOf()` on the Woodies contract directly over Ethereum JSON-RPC, so the data can never go stale and there is nothing to keep in sync.

- **Contract:** [`0x134460d32fc66a6d84487c20dcd9fdcf92316017`](https://etherscan.io/address/0x134460d32fc66a6d84487c20dcd9fdcf92316017) (Woodies Generative Characters, ERC-721, Ethereum mainnet)
- **Endpoint path:** `/v1/graphql` (same path shape as the old Hasura URL)
- **Hosting:** Cloudflare Workers free tier — 100k requests/day, no cold-start sleeping like Heroku free dynos had
- **CORS:** open (`*`), so Decentraland scenes can call it directly

## Deploy

```bash
npm install
npx wrangler login      # one-time, opens browser to your Cloudflare account
npm run deploy
```

That prints your endpoint, e.g. `https://woodies-graph.<your-subdomain>.workers.dev`. The GraphQL API (with a GraphiQL playground in the browser) lives at:

```
https://woodies-graph.<your-subdomain>.workers.dev/v1/graphql
```

Verify it works:

```bash
npm run smoke -- https://woodies-graph.<your-subdomain>.workers.dev/v1/graphql 0xSomeHolderWallet
```

### Optional: dedicated RPC

The Worker defaults to Cloudflare's public Ethereum RPC (`https://cloudflare-eth.com`), which is fine for scene-gating traffic. If you want a dedicated provider, grab a free [Alchemy](https://www.alchemy.com/) or [Infura](https://www.infura.io/) mainnet URL and set it as a secret (secrets override the `wrangler.jsonc` var):

```bash
npx wrangler secret put RPC_URL
```

Balances are cached in-memory for 60 seconds per address to keep RPC usage low.

## API

The main query — this is all Decentraland needs:

```graphql
query ($address: String!) {
  isHolder(address: $address)
}
```

More detail if you want it:

```graphql
query ($address: String!) {
  holder(address: $address) {
    address
    balance
    tokenIds   # via ERC721Enumerable; null if the contract doesn't support enumeration
  }
}
```

A Hasura-style query shape is also supported, in case existing scene code queried the old endpoint like this (returns only addresses holding at least one Woodie):

```graphql
query ($address: String!) {
  holders(where: { address: { _eq: $address } }) {
    address
    balance
  }
}
```

> **Note:** the exact table/field names from the old Hasura schema weren't recoverable, so if your old scene query used different names (e.g. `woodies` instead of `holders`, or `owner` instead of `address`), either rename them in the scene to match the above, or tweak the schema in `src/index.ts` to match the old names — it's one SDL block and one resolver.

There's no "list every holder" query: that would require an indexer (the thing that made the old stack heavy). For gating, per-wallet lookups are all you need.

## Using it from a Decentraland scene (SDK7)

```ts
import { getPlayer } from '@dcl/sdk/src/players'

const ENDPOINT = 'https://woodies-graph.<your-subdomain>.workers.dev/v1/graphql'

export async function playerHoldsWoodie(): Promise<boolean> {
  const player = getPlayer()
  if (!player?.userId) return false

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query ($address: String!) { isHolder(address: $address) }`,
      variables: { address: player.userId },
    }),
  })
  const { data } = await res.json()
  return data?.isHolder === true
}
```

Note: `player.userId` is the wallet address for connected-wallet users; guest accounts get an ephemeral address that will (correctly) fail the holder check.

## Development

```bash
npm run dev        # local server at http://localhost:8787/v1/graphql
npm run typecheck
```

## Layout

- `src/index.ts` — GraphQL schema + resolvers (graphql-yoga on a Worker)
- `src/eth.ts` — minimal ERC-721 reads over raw JSON-RPC (no web3 library)
- `wrangler.jsonc` — Worker config; contract address and default RPC live here
- `scripts/smoke.mjs` — post-deploy smoke test
