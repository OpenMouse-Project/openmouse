import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { BotConfig } from "./config.js";

// Singleton Supabase client. Always created from the *service-role* key so the
// bot can read/write the support tables (RLS is enabled and end-user roles are
// revoked — only the service-role key has access). Never expose this client or
// its key to a browser.
let client: SupabaseClient | null = null;

export function getSupabase(cfg: BotConfig): SupabaseClient {
  if (!client) {
    client = createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
