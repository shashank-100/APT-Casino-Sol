// Here we export some useful types and functions for interacting with the Anchor program.
import { Account, address, getBase58Decoder, SolanaClient } from 'gill'
import { SolanaClusterId } from '@wallet-ui/react'
import { getProgramAccountsDecoded } from './helpers/get-program-accounts-decoded'
import { Roulette, ROULETTE_DISCRIMINATOR, ROULETTE_PROGRAM_ADDRESS, getRouletteDecoder } from './client/js'
import RouletteIDL from '../target/idl/roulette.json'

export type RouletteAccount = Account<Roulette, string>

// Re-export the generated IDL and type
export { RouletteIDL }

// This is a helper function to get the program ID for the Roulette program depending on the cluster.
export function getRouletteProgramId(cluster: SolanaClusterId) {
  switch (cluster) {
    case 'solana:devnet':
    case 'solana:testnet':
      // This is the program ID for the Roulette program on devnet and testnet.
      return address('6z68wfurCMYkZG51s1Et9BJEd9nJGUusjHXNt4dGbNNF')
    case 'solana:mainnet':
    default:
      return ROULETTE_PROGRAM_ADDRESS
  }
}

export * from './client/js'

export function getRouletteProgramAccounts(rpc: SolanaClient['rpc']) {
  return getProgramAccountsDecoded(rpc, {
    decoder: getRouletteDecoder(),
    filter: getBase58Decoder().decode(ROULETTE_DISCRIMINATOR),
    programAddress: ROULETTE_PROGRAM_ADDRESS,
  })
}
