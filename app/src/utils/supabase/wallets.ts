import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import { decryptPrivateKey, encryptPrivateKey, WalletAccount } from "@/utils/walletAccount";

// Supabase table schema suggestion:
// create table wallets (
//   id uuid default gen_random_uuid() primary key,
//   user_id uuid references auth.users(id),
//   address text unique not null,
//   encrypted_private_key text,
//   source text not null default 'internal',
//   created_at timestamptz default now()
// );

export interface WalletSavePayload {
  address: string;
  encryptedPrivateKey?: string;
  source?: string;
}

export async function saveWalletRecord(
  payload: WalletSavePayload,
  userId?: string,
): Promise<{ error: PostgrestError | null }> {
  const supabase = createClient();

  let finalUserId = userId;
  if (!finalUserId) {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      console.warn("Failed to get supabase user while saving wallet record:", userError.message);
    }

    finalUserId = user?.id ?? undefined;
  }

  const walletRecord = {
    address: payload.address,
    encrypted_private_key: payload.encryptedPrivateKey ?? null,
    user_id: finalUserId,
    source: payload.source ?? (payload.encryptedPrivateKey ? "internal" : "walletconnect"),
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("wallets")
    .upsert(walletRecord, { onConflict: "address" });

  return { error };
}

export async function getWalletRecord(userId?: string) {
  const supabase = createClient();
  const finalUserId = userId ?? (await supabase.auth.getUser()).data.user?.id;

  if (!finalUserId) {
    return { data: null, error: { message: "No authenticated user found.", details: "", hint: "", code: "" } as unknown as PostgrestError };
  }

  const { data, error } = await supabase
    .from("wallets")
    .select("address, encrypted_private_key, source, created_at")
    .eq("user_id", finalUserId)
    .single();

  return { data, error };
}

export async function reencryptWalletPin(oldPin: string, newPin: string, userId?: string) {
  const supabase = createClient();
  const { data, error } = await getWalletRecord(userId);

  if (error) {
    return { error };
  }
  if (!data?.encrypted_private_key) {
    return { error: { message: "No encrypted wallet found for this user.", details: "", hint: "", code: "" } as unknown as PostgrestError };
  }

  const privateKey = decryptPrivateKey(data.encrypted_private_key, oldPin);
  if (!privateKey) {
    return { error: { message: "Old PIN is incorrect.", details: "", hint: "", code: "" } as unknown as PostgrestError };
  }

  const newEncryptedKey = encryptPrivateKey(privateKey, newPin);
  const { error: updateError } = await supabase
    .from("wallets")
    .update({ encrypted_private_key: newEncryptedKey })
    .eq("address", data.address);

  return { error: updateError };
}
