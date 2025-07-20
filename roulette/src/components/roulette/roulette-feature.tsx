import { WalletButton } from '../solana/solana-provider'
import { RouletteButtonInitialize, RouletteList, RouletteProgramExplorerLink, RouletteProgramGuard } from './roulette-ui'
import { AppHero } from '../app-hero'
import { useWalletUi } from '@wallet-ui/react'

export default function RouletteFeature() {
  const { account } = useWalletUi()

  return (
    <RouletteProgramGuard>
      <AppHero
        title="Roulette"
        subtitle={
          account
            ? "Initialize a new roulette onchain by clicking the button. Use the program's methods (increment, decrement, set, and close) to change the state of the account."
            : 'Select a wallet to run the program.'
        }
      >
        <p className="mb-6">
          <RouletteProgramExplorerLink />
        </p>
        {account ? (
          <RouletteButtonInitialize />
        ) : (
          <div style={{ display: 'inline-block' }}>
            <WalletButton />
          </div>
        )}
      </AppHero>
      {account ? <RouletteList /> : null}
    </RouletteProgramGuard>
  )
}
