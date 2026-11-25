import { createClient } from "@supabase/supabase-js";

let client;

export function getSupabaseClient() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publicKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

  if (!url || !publicKey) {
    throw new Error("Cloud storage is not configured. Add the Supabase project URL and public anon key to your local environment.");
  }

  if (!client) {
    client = createClient(url, publicKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true
      }
    });
  }

  return client;
}
