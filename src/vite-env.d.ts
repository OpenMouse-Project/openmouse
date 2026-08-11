/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __BUILD_CHANNEL__: string;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
