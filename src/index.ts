import { createSchema, createYoga } from 'graphql-yoga'
import { GraphQLError } from 'graphql'
import { balanceOf, isAddress, tokenIdsOf, totalSupply } from './eth'

interface Env {
  RPC_URL: string
  CONTRACT_ADDRESS: string
}

// Bump when debugging deploys — `{ version }` on the live endpoint shows
// which build is actually running.
const VERSION = '1.1.0'

// Balances only change on transfer, so a short in-memory cache keeps repeat
// checks (e.g. a scene polling) from hammering the RPC endpoint. The promise
// itself is cached so concurrent fields in one query (isHolder + holder)
// share a single RPC call instead of racing.
const CACHE_TTL_MS = 60_000
const balanceCache = new Map<string, { promise: Promise<number>; expires: number }>()

function cachedBalance(env: Env, address: string): Promise<number> {
  const key = address.toLowerCase()
  const hit = balanceCache.get(key)
  if (hit && hit.expires > Date.now()) return hit.promise
  const promise = balanceOf(env.RPC_URL, env.CONTRACT_ADDRESS, key)
  balanceCache.set(key, { promise, expires: Date.now() + CACHE_TTL_MS })
  promise.catch(() => balanceCache.delete(key)) // never cache a failure
  return promise
}

function requireAddress(value: string): string {
  if (!isAddress(value)) {
    throw new GraphQLError(`Invalid Ethereum address: ${value}`)
  }
  return value.toLowerCase()
}

interface HolderParent {
  address: string
  balance: number
}

const schema = createSchema<Env & ExecutionContext>({
  typeDefs: /* GraphQL */ `
    type Holder {
      address: String!
      balance: Int!
      "Token ids owned, via ERC721Enumerable. Null if the contract does not support enumeration."
      tokenIds: [String!]
    }

    "Hasura-style comparison input, kept for compatibility with the old endpoint's query shape."
    input String_comparison_exp {
      _eq: String
      _in: [String!]
    }

    input holders_bool_exp {
      address: String_comparison_exp
    }

    type Query {
      "True if the address holds at least one Woodie. This is the one Decentraland needs."
      isHolder(address: String!): Boolean!
      "Balance details for a single address."
      holder(address: String!): Holder!
      "Hasura-style lookup: holders(where: { address: { _eq: \\"0x...\\" } }). Returns only addresses that hold at least one Woodie."
      holders(where: holders_bool_exp!): [Holder!]!
      totalSupply: Int!
      contractAddress: String!
      "Deployed build version — use to confirm a deploy actually shipped."
      version: String!
    }
  `,
  resolvers: {
    Query: {
      isHolder: async (_parent, args: { address: string }, ctx) => {
        const address = requireAddress(args.address)
        const holds = (await cachedBalance(ctx, address)) > 0
        console.log(`isHolder ${address} -> ${holds}`)
        return holds
      },
      holder: async (_parent, args: { address: string }, ctx): Promise<HolderParent> => {
        const address = requireAddress(args.address)
        const balance = await cachedBalance(ctx, address)
        console.log(`holder ${address} -> balance ${balance}`)
        return { address, balance }
      },
      holders: async (
        _parent,
        args: { where: { address?: { _eq?: string | null; _in?: string[] | null } | null } },
        ctx
      ): Promise<HolderParent[]> => {
        const addresses = [
          ...(args.where.address?._eq ? [args.where.address._eq] : []),
          ...(args.where.address?._in ?? []),
        ]
        if (addresses.length === 0) {
          throw new GraphQLError(
            'holders requires an address filter, e.g. holders(where: { address: { _eq: "0x..." } }). ' +
              'This endpoint reads the chain directly and cannot enumerate all holders.'
          )
        }
        const unique = [...new Set(addresses.map(requireAddress))]
        const results = await Promise.all(
          unique.map(async (address) => ({ address, balance: await cachedBalance(ctx, address) }))
        )
        console.log(`holders ${unique.join(',')} -> ${results.map((r) => r.balance).join(',')}`)
        return results.filter((holder) => holder.balance > 0)
      },
      totalSupply: (_parent, _args, ctx) => totalSupply(ctx.RPC_URL, ctx.CONTRACT_ADDRESS),
      contractAddress: (_parent, _args, ctx) => ctx.CONTRACT_ADDRESS,
      version: () => VERSION,
    },
    Holder: {
      tokenIds: (parent: HolderParent, _args, ctx) =>
        parent.balance === 0
          ? []
          : tokenIdsOf(ctx.RPC_URL, ctx.CONTRACT_ADDRESS, parent.address, parent.balance),
    },
  },
})

const yoga = createYoga<Env & ExecutionContext>({
  schema,
  // Same path as the old Hasura endpoint, so URLs keep the familiar shape.
  graphqlEndpoint: '/v1/graphql',
  landingPage: false,
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
  },
})

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return yoga.fetch(request, env, ctx)
  },
}
