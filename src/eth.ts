// Minimal ERC-721 read helpers over raw JSON-RPC — no web3 library needed.

// keccak-256 4-byte selectors for the functions we call
const SELECTORS = {
  balanceOf: '0x70a08231', // balanceOf(address)
  tokenOfOwnerByIndex: '0x2f745c59', // tokenOfOwnerByIndex(address,uint256)
  totalSupply: '0x18160ddd', // totalSupply()
} as const

export function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value)
}

function padUint(value: bigint | string): string {
  const hex = typeof value === 'bigint' ? value.toString(16) : value.replace(/^0x/, '')
  return hex.padStart(64, '0')
}

async function ethCall(rpcUrl: string, to: string, data: string): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to, data }, 'latest'],
    }),
  })
  if (!res.ok) {
    throw new Error(`RPC HTTP ${res.status}`)
  }
  const body = (await res.json()) as { result?: string; error?: { message?: string } }
  if (body.error) {
    throw new Error(`RPC error: ${body.error.message ?? 'unknown'}`)
  }
  if (typeof body.result !== 'string') {
    throw new Error('RPC returned no result')
  }
  return body.result
}

export async function balanceOf(rpcUrl: string, contract: string, owner: string): Promise<number> {
  const data = SELECTORS.balanceOf + padUint(owner.toLowerCase())
  const result = await ethCall(rpcUrl, contract, data)
  return Number(BigInt(result))
}

export async function totalSupply(rpcUrl: string, contract: string): Promise<number> {
  const result = await ethCall(rpcUrl, contract, SELECTORS.totalSupply)
  return Number(BigInt(result))
}

// Returns the owner's token ids via ERC721Enumerable, or null if the contract
// doesn't implement it (the call reverts).
export async function tokenIdsOf(
  rpcUrl: string,
  contract: string,
  owner: string,
  balance: number,
  cap = 100
): Promise<string[] | null> {
  const count = Math.min(balance, cap)
  try {
    const calls = Array.from({ length: count }, (_, i) => {
      const data =
        SELECTORS.tokenOfOwnerByIndex + padUint(owner.toLowerCase()) + padUint(BigInt(i))
      return ethCall(rpcUrl, contract, data)
    })
    const results = await Promise.all(calls)
    return results.map((r) => BigInt(r).toString())
  } catch {
    return null
  }
}
