---
name: supabase-nextjs
description: Help with Supabase auth, session persistence, and API route integration for a Next.js App Router project. Use when debugging Supabase auth flows, cookie-based server-side routes, or wallet persistence via Supabase.
argument-hint: [task description]
user-invocable: true
---

# Supabase + Next.js App Router

This skill helps with:

- Fixing Supabase auth session propagation in Next.js App Router routes and APIs.
- Ensuring browser session cookies are available to server-side handlers.
- Persisting user data and wallet state through Supabase or Prisma.
- Building or debugging `/api/*` routes that require authenticated Supabase access.
- Handling sign in, sign out, and server-side user lookup.

## When to use

- The app logs `Auth session missing!` or `401 Unauthorized` from `/api/wallet`.
- The client successfully signs in but server routes still fail to identify the user.
- You need to persist wallet state using Supabase auth session instead of local storage.
- You want to update Next.js `middleware.ts`, Supabase helpers, or API route logic.

## Behavior

When invoked, follow these steps:

1. Inspect project files under `src/` and `app/` for Supabase client creation and auth usage.
2. Check whether the browser is using `createBrowserClient` with proper cookie storage.
3. Verify server routes use `createServerClient({ cookieStore: cookies() })` when running in Next.js route handlers.
4. If API routes still fail, add a fallback auth path using the request `Authorization` header.
5. Look for `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and cookie configuration in `middleware.ts`.
6. If needed, suggest a wallet persistence flow that saves encrypted private keys only after auth.

## Examples

- "Create a Next.js API route that reads the Supabase auth user from cookies and returns the saved wallet."
- "Fix the login flow so that `/api/wallet` works after Supabase auth redirect."
- "Add a logout button to the dashboard and clear Supabase session properly."

## Notes

- This skill is specific to local repo setup and App Router conventions.
- Use this skill when you want targeted fixes for Supabase auth and route-level session handling.
