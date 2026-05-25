import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

// Handles the OAuth (PKCE) redirect from Supabase.
// Exchanges the `code` query param for a Supabase session cookie,
// then redirects the user to `next` (default: /dashboard).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/dashboard";

  // Compute a safe absolute redirect target on this same origin.
  const safeNext = next.startsWith("/") ? next : "/dashboard";

  if (!code) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", "missing_code");
    return NextResponse.redirect(url);
  }

  const cookieStore = await cookies();
  const supabase = createClient({ cookieStore });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("[auth/callback] exchangeCodeForSession failed:", error);
    const url = new URL("/login", origin);
    url.searchParams.set("error", "oauth_exchange_failed");
    return NextResponse.redirect(url);
  }

  return NextResponse.redirect(new URL(safeNext, origin));
}
