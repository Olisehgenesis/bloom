import { prisma } from "@/lib/prisma";

export async function getWalletByUserId(userId: string) {
  return prisma.wallet.findFirst({ where: { userId } });
}

export async function getWalletByAddress(address: string) {
  return prisma.wallet.findUnique({ where: { address } });
}

export async function upsertWallet(payload: {
  userId?: string;
  address: string;
  encryptedPrivateKey?: string;
  source: string;
}) {
  return prisma.wallet.upsert({
    where: { address: payload.address },
    update: {
      userId: payload.userId,
      encryptedPrivateKey: payload.encryptedPrivateKey ?? undefined,
      source: payload.source,
    },
    create: {
      userId: payload.userId,
      address: payload.address,
      encryptedPrivateKey: payload.encryptedPrivateKey ?? null,
      source: payload.source,
    },
  });
}
