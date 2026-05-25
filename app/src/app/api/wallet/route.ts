import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Server-only admin client — bypasses RLS. Only used AFTER we've verified
// the caller's identity from a valid JWT (cookie or Bearer), and we always
// scope reads/writes by the verified user.id.
function adminClient() {
  if (!supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured on the server.");
  }
  return createSupabaseClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, detectSessionInUrl: false, autoRefreshToken: false },
  });
}

async function getUserFromRequest(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient({ cookieStore });
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (user) {
    return { user, error: null };
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return { user: null, error: userError ?? new Error("No session or token provided.") };
  }

  const fallbackClient = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, detectSessionInUrl: false },
  });
  const { data, error } = await fallbackClient.auth.getUser(token);
  return { user: data?.user ?? null, error };
}

export async function GET(request: NextRequest) {
  const { user, error: userError } = await getUserFromRequest(request);

  if (userError || !user) {
    return NextResponse.json({ error: userError?.message ?? "No authenticated user." }, { status: 401 });
  }

  const db = adminClient();
  const { data: wallet, error } = await db
    .from("wallets")
    .select("id, user_id, address, encrypted_private_key, source, created_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const normalized = wallet
    ? {
        id: wallet.id,
        userId: wallet.user_id,
        address: wallet.address,
        encryptedPrivateKey: wallet.encrypted_private_key,
        source: wallet.source,
        createdAt: wallet.created_at,
      }
    : null;

  return NextResponse.json({ wallet: normalized });
}

export async function POST(request: NextRequest) {
  const { user, error: userError } = await getUserFromRequest(request);

  if (userError || !user) {
    return NextResponse.json({ error: userError?.message ?? "No authenticated user." }, { status: 401 });
  }

  const body = await request.json();
  const { address, encryptedPrivateKey, source } = body;

  if (!address || !source) {
    return NextResponse.json({ error: "Missing wallet address or source." }, { status: 400 });
  }

  const db = adminClient();
  const { data: wallet, error } = await db
    .from("wallets")
    .upsert(
      {
        user_id: user.id,
        address,
        encrypted_private_key: encryptedPrivateKey ?? null,
        source,
      },
      { onConflict: "address" },
    )
    .select("id, user_id, address, encrypted_private_key, source, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const normalized = {
    id: wallet.id,
    userId: wallet.user_id,
    address: wallet.address,
    encryptedPrivateKey: wallet.encrypted_private_key,
    source: wallet.source,
    createdAt: wallet.created_at,
  };

  return NextResponse.json({ wallet: normalized });
}
