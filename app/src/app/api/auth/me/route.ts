import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { verifyWalletToken, WALLET_AUTH_COOKIE } from "@/lib/walletAuth";

export const runtime = "nodejs";

export async function GET() {
  const cookieStore = await cookies();

  // Wallet-session identity takes precedence (cheaper, no remote call).
  const walletToken = cookieStore.get(WALLET_AUTH_COOKIE)?.value;
  const walletSession = await verifyWalletToken(walletToken);
  if (walletSession) {
    return NextResponse.json({
      authenticated: true,
      method: "wallet",
      walletAddress: walletSession.address,
      supabaseUserId: null,
    });
  }

  // Fall back to Supabase session for email/password / Google users.
  const supabase = createClient({ cookieStore });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    return NextResponse.json({
      authenticated: false,
      method: null,
      walletAddress: null,
      supabaseUserId: null,
    });
  }
  return NextResponse.json({
    authenticated: true,
    method: "supabase",
    walletAddress: null,
    supabaseUserId: data.user.id,
  });
}
