import { ellipsify } from '@wallet-ui/react'
import {
  useRouletteAccountsQuery,
  useRouletteCloseMutation,
  useRouletteDecrementMutation,
  useRouletteIncrementMutation,
  useRouletteInitializeMutation,
  useRouletteProgram,
  useRouletteProgramId,
  useRouletteSetMutation,
} from './roulette-data-access'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ExplorerLink } from '../cluster/cluster-ui'
import { RouletteAccount } from '@project/anchor'
import { ReactNode } from 'react'

export function RouletteProgramExplorerLink() {
  const programId = useRouletteProgramId()

  return <ExplorerLink address={programId.toString()} label={ellipsify(programId.toString())} />
}

export function RouletteList() {
  const rouletteAccountsQuery = useRouletteAccountsQuery()

  if (rouletteAccountsQuery.isLoading) {
    return <span className="loading loading-spinner loading-lg"></span>
  }

  if (!rouletteAccountsQuery.data?.length) {
    return (
      <div className="text-center">
        <h2 className={'text-2xl'}>No accounts</h2>
        No accounts found. Initialize one to get started.
      </div>
    )
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {rouletteAccountsQuery.data?.map((roulette) => (
        <RouletteCard key={roulette.address} roulette={roulette} />
      ))}
    </div>
  )
}

export function RouletteProgramGuard({ children }: { children: ReactNode }) {
  const programAccountQuery = useRouletteProgram()

  if (programAccountQuery.isLoading) {
    return <span className="loading loading-spinner loading-lg"></span>
  }

  if (!programAccountQuery.data?.value) {
    return (
      <div className="alert alert-info flex justify-center">
        <span>Program account not found. Make sure you have deployed the program and are on the correct cluster.</span>
      </div>
    )
  }

  return children
}

function RouletteCard({ roulette }: { roulette: RouletteAccount }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Roulette: {roulette.data.count}</CardTitle>
        <CardDescription>
          Account: <ExplorerLink address={roulette.address} label={ellipsify(roulette.address)} />
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4 justify-evenly">
          <RouletteButtonIncrement roulette={roulette} />
          <RouletteButtonSet roulette={roulette} />
          <RouletteButtonDecrement roulette={roulette} />
          <RouletteButtonClose roulette={roulette} />
        </div>
      </CardContent>
    </Card>
  )
}

export function RouletteButtonInitialize() {
  const mutationInitialize = useRouletteInitializeMutation()

  return (
    <Button onClick={() => mutationInitialize.mutateAsync()} disabled={mutationInitialize.isPending}>
      Initialize Roulette {mutationInitialize.isPending && '...'}
    </Button>
  )
}

export function RouletteButtonIncrement({ roulette }: { roulette: RouletteAccount }) {
  const incrementMutation = useRouletteIncrementMutation({ roulette })

  return (
    <Button variant="outline" onClick={() => incrementMutation.mutateAsync()} disabled={incrementMutation.isPending}>
      Increment
    </Button>
  )
}

export function RouletteButtonSet({ roulette }: { roulette: RouletteAccount }) {
  const setMutation = useRouletteSetMutation({ roulette })

  return (
    <Button
      variant="outline"
      onClick={() => {
        const value = window.prompt('Set value to:', roulette.data.count.toString() ?? '0')
        if (!value || parseInt(value) === roulette.data.count || isNaN(parseInt(value))) {
          return
        }
        return setMutation.mutateAsync(parseInt(value))
      }}
      disabled={setMutation.isPending}
    >
      Set
    </Button>
  )
}

export function RouletteButtonDecrement({ roulette }: { roulette: RouletteAccount }) {
  const decrementMutation = useRouletteDecrementMutation({ roulette })

  return (
    <Button variant="outline" onClick={() => decrementMutation.mutateAsync()} disabled={decrementMutation.isPending}>
      Decrement
    </Button>
  )
}

export function RouletteButtonClose({ roulette }: { roulette: RouletteAccount }) {
  const closeMutation = useRouletteCloseMutation({ roulette })

  return (
    <Button
      variant="destructive"
      onClick={() => {
        if (!window.confirm('Are you sure you want to close this account?')) {
          return
        }
        return closeMutation.mutateAsync()
      }}
      disabled={closeMutation.isPending}
    >
      Close
    </Button>
  )
}
