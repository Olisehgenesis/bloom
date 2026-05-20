import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const cookieMethods = {
  get: (key: string) => {
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${encodeURIComponent(key)}=([^;]*)`),
    );
    return match ? decodeURIComponent(match[1]) : null;
  },
  set: (key: string, value: string, options: Record<string, unknown> = {}) => {
    let cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    if (options.maxAge) cookie += `; Max-Age=${options.maxAge}`;
    if (options.expires) cookie += `; Expires=${options.expires}`;
    if (options.path) cookie += `; Path=${options.path}`;
    if (options.domain) cookie += `; Domain=${options.domain}`;
    if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;
    if (options.secure) cookie += `; Secure`;
    document.cookie = cookie;
  },
  remove: (key: string, options: Record<string, unknown> = {}) => {
    document.cookie = `${encodeURIComponent(key)}=; Max-Age=0; Path=${options.path ?? '/'};`;
  },
  delete: (key: string, options: Record<string, unknown> = {}) => {
    document.cookie = `${encodeURIComponent(key)}=; Max-Age=0; Path=${options.path ?? '/'};`;
  },
};

export const createClient = () =>
  createBrowserClient(
    supabaseUrl!,
    supabaseKey!,
    {
      cookies: cookieMethods,
      cookieOptions: {
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
    },
  );

export const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) {
    return {};
  }

  return {
    Authorization: `Bearer ${data.session.access_token}`,
  };
};

export const authFetch = async (
  input: RequestInfo,
  init: RequestInit = {},
): Promise<Response> => {
  const authHeaders = await getAuthHeaders();
  const headers = new Headers(init.headers);

  Object.entries(authHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });

  return fetch(input, {
    ...init,
    credentials: "include",
    headers,
  });
};
