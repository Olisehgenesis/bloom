import CryptoJS from "crypto-js";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";

export interface WalletAccount {
  address: string;
  encryptedPrivateKey: string;
  createdAt: string;
}

export function createWalletAccount(pin: string): WalletAccount {
  const privateKey = generatePrivateKey();
  const address = privateKeyToAddress(privateKey);
  const encryptedPrivateKey = CryptoJS.AES.encrypt(privateKey, pin).toString();

  return {
    address,
    encryptedPrivateKey,
    createdAt: new Date().toISOString(),
  };
}

export function encryptPrivateKey(privateKey: string, pin: string): string {
  return CryptoJS.AES.encrypt(privateKey, pin).toString();
}

export function decryptPrivateKey(encryptedPrivateKey: string, pin: string): string | null {
  const bytes = CryptoJS.AES.decrypt(encryptedPrivateKey, pin);
  const value = bytes.toString(CryptoJS.enc.Utf8);
  return value || null;
}

export function verifyPin(encryptedPrivateKey: string, pin: string): boolean {
  const decrypted = decryptPrivateKey(encryptedPrivateKey, pin);
  return decrypted !== null;
}
