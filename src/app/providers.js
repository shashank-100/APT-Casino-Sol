"use client";

import * as React from 'react';
import { RainbowKitProvider, getDefaultConfig } from '@rainbow-me/rainbowkit';
import { WagmiProvider, http } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletStatusProvider } from '@/hooks/useWalletStatus';
import { NotificationProvider } from '@/components/NotificationSystem';
import { ThemeProvider } from 'next-themes';
import '@rainbow-me/rainbowkit/styles.css';

// Custom Chains
const mantleSepolia = {
  id: 5003,
  name: "Mantle Sepolia",
  network: "mantle-sepolia",
  nativeCurrency: {
    decimals: 18,
    name: "Mantle",
    symbol: "MNT",
  },
  rpcUrls: {
    default: { http: ["https://rpc.sepolia.mantle.xyz"] },
    public: { http: ["https://rpc.sepolia.mantle.xyz"] },
  },
  blockExplorers: {
    default: { name: "Mantle Sepolia Explorer", url: "https://sepolia.mantlescan.xyz" },
  },
  testnet: true,
};

const pharosDevnet = {
  id: 50002,
  name: "Pharos Devnet",
  network: "pharos-devnet",
  nativeCurrency: {
    decimals: 18,
    name: "Pharos",
    symbol: "PHR",
  },
  rpcUrls: {
    default: { http: ["https://devnet.dplabs-internal.com"] },
    public: { http: ["https://devnet.dplabs-internal.com"] },
  },
  blockExplorers: {
    default: { name: "Pharos Explorer", url: "https://pharosscan.xyz" },
  },
  testnet: true,
};

// WalletConnect project ID
const fallbackProjectId = "3a8170812b534d0ff9d794f19a901d64";
const projectId = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || fallbackProjectId;

const config = getDefaultConfig({
  appName: 'APT Casino',
  projectId,
  chains: [mantleSepolia, pharosDevnet],
  transports: {
    [mantleSepolia.id]: http(mantleSepolia.rpcUrls.default.http[0]),
    [pharosDevnet.id]: http(pharosDevnet.rpcUrls.default.http[0]),
  },
  metadata: {
    name: 'APT Casino',
    description: 'Casino DApp',
    url: 'http://localhost:3000',
    icons: ['https://yourdomain.com/icon.png'],
  },
});

const queryClient = new QueryClient();

export default function Providers({ children }) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <NotificationProvider>
            <WalletStatusProvider>
              <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
                {children}
              </ThemeProvider>
            </WalletStatusProvider>
          </NotificationProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
