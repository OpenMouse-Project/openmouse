import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export interface BotConfig {
  token: string;
  clientId: string;
  clientSecret: string;
  guildId: string;
  supportChannelId: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  staffWhitelist: Set<string>;
  staffRoleId: string | null;
  supportInviteUrl: string;
}

export function loadConfig(): BotConfig {
  const staffWhitelist = new Set(
    (process.env.STAFF_WHITELIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  return {
    token: required("DISCORD_TOKEN"),
    clientId: required("DISCORD_CLIENT_ID"),
    clientSecret: required("DISCORD_CLIENT_SECRET"),
    guildId: required("DISCORD_GUILD_ID"),
    supportChannelId: required("SUPPORT_CHANNEL_ID"),
    supabaseUrl: required("SUPABASE_URL"),
    supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    staffWhitelist,
    staffRoleId: process.env.STAFF_ROLE_ID ?? null,
    supportInviteUrl: process.env.SUPPORT_INVITE_URL ?? "",
  };
}
