import {
  RouletteAccount,
  getCloseInstruction,
  getRouletteProgramAccounts,
  getRouletteProgramId,
  getDecrementInstruction,
  getIncrementInstruction,
  getInitializeInstruction,
  getSetInstruction,
} from '@project/anchor'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toast } from 'sonner'
import { generateKeyPairSigner } from 'gill'
import { useWalletUi } from '@wallet-ui/react'
import { useWalletTransactionSignAndSend } from '../solana/use-wallet-transaction-sign-and-send'
import { useClusterVersion } from '@/components/cluster/use-cluster-version'
import { toastTx } from '@/components/toast-tx'
import { useWalletUiSigner } from '@/components/solana/use-wallet-ui-signer'
import { install as installEd25519 } from '@solana/webcrypto-ed25519-polyfill'

// polyfill ed25519 for browsers (to allow `generateKeyPairSigner` to work)
installEd25519()

export function useRouletteProgramId() {
  const { cluster } = useWalletUi()
  return useMemo(() => getRouletteProgramId(cluster.id), [cluster])
}

export function useRouletteProgram() {
  const { client, cluster } = useWalletUi()
  const programId = useRouletteProgramId()
  const query = useClusterVersion()

  return useQuery({
    retry: false,
    queryKey: ['get-program-account', { cluster, clusterVersion: query.data }],
    queryFn: () => client.rpc.getAccountInfo(programId).send(),
  })
}

export function useRouletteInitializeMutation() {
  const { cluster } = useWalletUi()
  const queryClient = useQueryClient()
  const signer = useWalletUiSigner()
  const signAndSend = useWalletTransactionSignAndSend()

  return useMutation({
    mutationFn: async () => {
      const roulette = await generateKeyPairSigner()
      return await signAndSend(getInitializeInstruction({ payer: signer, roulette }), signer)
    },
    onSuccess: async (tx) => {
      toastTx(tx)
      await queryClient.invalidateQueries({ queryKey: ['roulette', 'accounts', { cluster }] })
    },
    onError: () => toast.error('Failed to run program'),
  })
}

export function useRouletteDecrementMutation({ roulette }: { roulette: RouletteAccount }) {
  const invalidateAccounts = useRouletteAccountsInvalidate()
  const signer = useWalletUiSigner()
  const signAndSend = useWalletTransactionSignAndSend()

  return useMutation({
    mutationFn: async () => await signAndSend(getDecrementInstruction({ roulette: roulette.address }), signer),
    onSuccess: async (tx) => {
      toastTx(tx)
      await invalidateAccounts()
    },
  })
}

export function useRouletteIncrementMutation({ roulette }: { roulette: RouletteAccount }) {
  const invalidateAccounts = useRouletteAccountsInvalidate()
  const signAndSend = useWalletTransactionSignAndSend()
  const signer = useWalletUiSigner()

  return useMutation({
    mutationFn: async () => await signAndSend(getIncrementInstruction({ roulette: roulette.address }), signer),
    onSuccess: async (tx) => {
      toastTx(tx)
      await invalidateAccounts()
    },
  })
}

export function useRouletteSetMutation({ roulette }: { roulette: RouletteAccount }) {
  const invalidateAccounts = useRouletteAccountsInvalidate()
  const signAndSend = useWalletTransactionSignAndSend()
  const signer = useWalletUiSigner()

  return useMutation({
    mutationFn: async (value: number) =>
      await signAndSend(
        getSetInstruction({
          roulette: roulette.address,
          value,
        }),
        signer,
      ),
    onSuccess: async (tx) => {
      toastTx(tx)
      await invalidateAccounts()
    },
  })
}

export function useRouletteCloseMutation({ roulette }: { roulette: RouletteAccount }) {
  const invalidateAccounts = useRouletteAccountsInvalidate()
  const signAndSend = useWalletTransactionSignAndSend()
  const signer = useWalletUiSigner()

  return useMutation({
    mutationFn: async () => {
      return await signAndSend(getCloseInstruction({ payer: signer, roulette: roulette.address }), signer)
    },
    onSuccess: async (tx) => {
      toastTx(tx)
      await invalidateAccounts()
    },
  })
}

export function useRouletteAccountsQuery() {
  const { client } = useWalletUi()

  return useQuery({
    queryKey: useRouletteAccountsQueryKey(),
    queryFn: async () => await getRouletteProgramAccounts(client.rpc),
  })
}

function useRouletteAccountsInvalidate() {
  const queryClient = useQueryClient()
  const queryKey = useRouletteAccountsQueryKey()

  return () => queryClient.invalidateQueries({ queryKey })
}

function useRouletteAccountsQueryKey() {
  const { cluster } = useWalletUi()

  return ['roulette', 'accounts', { cluster }]
}
