import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export interface ControlAccess {
  allowed: boolean;
  expiresAt: string | null;
}

export async function getControlAccess(): Promise<ControlAccess> {
  if (!supabase) return { allowed: false, expiresAt: null };
  const { data, error } = await supabase.rpc("control_access_status");
  if (error) throw error;

  const result = data as { allowed?: boolean; expires_at?: string | null } | null;
  return {
    allowed: result?.allowed === true,
    expiresAt: result?.expires_at ?? null,
  };
}

export async function redeemLicenseKey(key: string): Promise<ControlAccess> {
  if (!supabase) return { allowed: false, expiresAt: null };
  const { data, error } = await supabase.rpc("redeem_license_key", {
    license_key: key.trim(),
  });
  if (error) throw error;

  const result = data as { allowed?: boolean; expires_at?: string | null } | null;
  return {
    allowed: result?.allowed === true,
    expiresAt: result?.expires_at ?? null,
  };
}
