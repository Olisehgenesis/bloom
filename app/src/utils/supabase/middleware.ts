import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { verifyWalletToken, WALLET_AUTH_COOKIE } from "@/lib/walletAuth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Routes under these prefixes require an authenticated session
// (either a Supabase session or a signed wallet session cookie).
const PROTECTED_PREFIXES = ["/dashboard", "/stream", "/compound", "/superadmin"];

export const createClient = async (request: NextRequest) => {
  let supabaseResponse = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // If Supabase env is not configured at runtime (e.g. edge middleware on Vercel
  // missing public vars), don't crash the whole site — just let the request through.
  if (!supabaseUrl || !supabaseKey) {
    return supabaseResponse;
  }

  try {
    const supabase = createServerClient(
      supabaseUrl,
      supabaseKey,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options: Record<string, unknown> }>) {
            cookiesToSet.forEach(({ name, value, options }) =>
              request.cookies.set({ name, value, ...options }),
            );
            supabaseResponse = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options),
            );
          },
        },
      },
    );

    // Refresh session + read user. Required on every request per @supabase/ssr docs.
    const { data: { user } } = await supabase.auth.getUser();

    const { pathname } = request.nextUrl;
    const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));

    if (isProtected && !user) {
      // Allow if the request carries a valid wallet-session cookie instead.
      const walletToken = request.cookies.get(WALLET_AUTH_COOKIE)?.value;
      let walletOk = false;
      try {
        walletOk = !!(await verifyWalletToken(walletToken));
      } catch (e) {
        console.error("[middleware] wallet token verify failed:", e);
        walletOk = false;
      }
      if (!walletOk) {
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("next", pathname);
        return NextResponse.redirect(url);
      }
    }

    return supabaseResponse;
  } catch (e) {
    console.error("[middleware] error:", e);
    // Fail open so we never 500 the entire site from middleware.
    return supabaseResponse;
  }
};
