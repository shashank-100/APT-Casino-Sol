'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import {
  useAccount,
  useDisconnect,
  useChainId,
} from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';

const WalletStatusContext = createContext(null);

export function WalletStatusProvider({ children }) {
  const isDev = process.env.NODE_ENV === 'development';

  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();

  const getChainFromId = (id) => {
    if (!id) return null;
    switch (id) {
      case 1:
        return { id: 1, name: 'Ethereum' };
      case 137:
        return { id: 137, name: 'Polygon' };
      case 5003:
        return { id: 5003, name: 'Mantle Sepolia' };
      default:
        return { id, name: `Chain ${id}` };
    }
  };

  const [devWallet, setDevWallet] = useState({
    isConnected: false,
    address: null,
    chain: null,
  });

  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isDev) return;

    const savedState = localStorage.getItem('dev-wallet-state');
    if (savedState === 'connected') {
      setDevWallet({
        isConnected: true,
        address: '0x1234...dev',
        chain: { id: 5003, name: 'Mantle Sepolia' },
      });
    }

    const handleToggle = () => {
      setDevWallet((prev) => {
        const newState = !prev.isConnected;
        localStorage.setItem(
          'dev-wallet-state',
          newState ? 'connected' : 'disconnected'
        );

        return newState
          ? {
              isConnected: true,
              address: '0x1234...dev',
              chain: { id: 5003, name: 'Mantle Sepolia' },
            }
          : {
              isConnected: false,
              address: null,
              chain: null,
            };
      });
    };

    window.addEventListener('dev-wallet-toggle', handleToggle);
    return () => {
      window.removeEventListener('dev-wallet-toggle', handleToggle);
    };
  }, [isDev]);

  const connectWallet = useCallback(() => {
    if (isDev) {
      localStorage.setItem('dev-wallet-state', 'connected');
      setDevWallet({
        isConnected: true,
        address: '0x1234...dev',
        chain: { id: 5003, name: 'Mantle Sepolia' },
      });
      return;
    }

    if (openConnectModal) {
      openConnectModal();
    } else {
      setError('Wallet connection modal not available');
    }
  }, [openConnectModal, isDev]);

  const disconnectWallet = useCallback(() => {
    if (isDev) {
      localStorage.setItem('dev-wallet-state', 'disconnected');
      setDevWallet({
        isConnected: false,
        address: null,
        chain: null,
      });
      return;
    }

    disconnect();
  }, [disconnect, isDev]);

  const resetError = useCallback(() => {
    setError(null);
  }, []);

  const currentStatus = isDev
    ? devWallet
    : {
        isConnected,
        address,
        chain: getChainFromId(chainId),
      };

  useEffect(() => {
    console.log('🔌 Wallet connection changed:');
    console.log('Connected:', currentStatus.isConnected);
    console.log('Address:', currentStatus.address);
    console.log('Chain:', currentStatus.chain);
  }, [currentStatus]);

  return (
    <WalletStatusContext.Provider
      value={{
        ...currentStatus,
        isDev,
        connectWallet,
        disconnectWallet,
        resetError,
        error,
      }}
    >
      {children}
    </WalletStatusContext.Provider>
  );
}

export default function useWalletStatus() {
  const context = useContext(WalletStatusContext);
  if (!context) {
    throw new Error('useWalletStatus must be used within a WalletStatusProvider');
  }
  return context;
}
