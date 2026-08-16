// Post-deploy smoke test.
// Usage: node scripts/smoke.mjs <endpoint-url> [address]
// e.g.   node scripts/smoke.mjs https://woodies-graph.YOUR-SUBDOMAIN.workers.dev/v1/graphql 0xYourWallet

const [endpoint, address = '0x0000000000000000000000000000000000000001'] = process.argv.slice(2)

if (!endpoint) {
  console.error('Usage: node scripts/smoke.mjs <endpoint-url> [address]')
  process.exit(1)
}

const query = /* GraphQL */ `
  query Smoke($address: String!) {
    contractAddress
    totalSupply
    isHolder(address: $address)
    holder(address: $address) {
      address
      balance
      tokenIds
    }
    holders(where: { address: { _eq: $address } }) {
      address
      balance
    }
  }
`

const res = await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query, variables: { address } }),
})

const body = await res.json()
console.log(JSON.stringify(body, null, 2))

if (body.errors) {
  console.error('\nSmoke test FAILED (errors above)')
  process.exit(1)
}
console.log('\nSmoke test passed.')
