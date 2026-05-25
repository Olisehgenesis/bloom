import { createConnector } from "wagmi";
import { createWalletClient, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const PRIVATE_KEY_CONNECTOR_ID = "bloom-internal-pin";

/**
 * Wagmi connector backed by an in-memory private key derived from a
 * PIN-decrypted blob stored in Supabase. The private key never persists
 * outside the current browser tab — refresh requires the PIN again.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function privateKeyConnector(params: { privateKey: Hex; chainId: number }): any {
  const account = privateKeyToAccount(params.privateKey);
  let connected = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createConnector<any>((config) => ({
    id: PRIVATE_KEY_CONNECTOR_ID,
    name: "Bloom Wallet",
    type: "bloomInternal",
    async setup() {},
    // @ts-expect-error wagmi v2 connect overload generic is too strict for a custom static connector
    async connect() {
      connected = true;
      return { accounts: [account.address as Address], chainId: params.chainId };
    },
    async disconnect() {
      connected = false;
    },
    async getAccounts() {
      return [account.address as Address];
    },
    async getChainId() {
      return params.chainId;
    },
    async getProvider() {
      const chain = config.chains.find((c) => c.id === params.chainId) ?? config.chains[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const transport = (config.transports as any)?.[chain.id];
      if (!transport) {
        throw new Error("No transport configured for chain " + chain.id);
      }
      const wallet = createWalletClient({
        account,
        chain,
        transport: transport as never,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return wallet as any;
    },
    // wagmi v2 reads signing through getClient() — without this, signMessage /
    // signTypedData fall through to provider.request which forwards to the
    // HTTP RPC and fails ("personal_sign not available"). Returning a viem
    // WalletClient with the local LocalAccount makes signing happen in-memory.
    async getClient({ chainId }: { chainId?: number } = {}) {
      const targetId = chainId ?? params.chainId;
      const chain = config.chains.find((c) => c.id === targetId) ?? config.chains[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const transport = (config.transports as any)?.[chain.id];
      if (!transport) {
        throw new Error("No transport configured for chain " + chain.id);
      }
      return createWalletClient({
        account,
        chain,
        transport: transport as never,
      });
    },
    async isAuthorized() {
      return connected;
    },
    onAccountsChanged() {},
    onChainChanged() {},
    onDisconnect() {
      connected = false;
      config.emitter.emit("disconnect");
    },
  }));
}
