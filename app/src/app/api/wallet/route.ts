import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { prisma } from "@/lib/prisma";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

async function getUserFromRequest(request: NextRequest) {
  const supabase = createClient({ cookieStore: cookies() });
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

  if (!user) {
    return NextResponse.json({ error: "No authenticated user." }, { status: 401 });
  }

  const wallet = await prisma.wallet.findFirst({
    where: { userId: user.id },
  });

  return NextResponse.json({ wallet: wallet ?? null });
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

  const wallet = await prisma.wallet.upsert({
    where: { address },
    update: {
      userId: user.id,
      encryptedPrivateKey: encryptedPrivateKey ?? null,
      source,
    },
    create: {
      userId: user.id,
      address,
      encryptedPrivateKey: encryptedPrivateKey ?? null,
      source,
    },
  });

  return NextResponse.json({ wallet });
}
