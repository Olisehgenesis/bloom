import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const isBrowser = typeof document !== "undefined" && typeof window !== "undefined";

export const createClient = () => {
  if (!isBrowser) {
    throw new Error("Supabase client can only be created in the browser environment.");
  }

  // @supabase/ssr >= 0.5 manages document.cookie automatically and uses the
  // getAll/setAll cookie protocol shared with the server client. We rely on
  // that default behavior here so session cookies are visible to middleware.
  return createBrowserClient(supabaseUrl!, supabaseKey!);
};

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
