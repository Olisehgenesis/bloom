import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { peekWalletToken, WALLET_AUTH_COOKIE } from "@/lib/walletAuth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Routes under these prefixes require an authenticated session
// (either a Supabase session or a signed wallet session cookie).
const PROTECTED_PREFIXES = ["/dashboard", "/stream", "/compound", "/superadmin", "/account", "/claim"];

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
      // Allow if the request carries a structurally-valid wallet-session
      // cookie. We deliberately do NOT verify the HMAC here: the signing
      // secret may not be available in the Edge runtime (e.g. when only
      // SUPABASE_SERVICE_ROLE_KEY is configured on Vercel), and a verify
      // failure here would loop the user back to /login even though every
      // API route (Node runtime) sees them as authenticated. The real MAC
      // check happens server-side in `/api/auth/me` and other Node routes,
      // which is the source of truth for protected data.
      const walletToken = request.cookies.get(WALLET_AUTH_COOKIE)?.value;
      const walletOk = !!peekWalletToken(walletToken);
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
