import type { Guild, GuildMember, GuildMemberResolvable } from "discord.js";
import type { BotConfig } from "./config.js";

/**
 * Staff authorization for the bot side. A member is treated as staff if they
 * are on the DISCORD_STAFF_WHITELIST (primary) or hold STAFF_ROLE_ID
 * (optional). The dashboard enforces its own independent server-side
 * authorization via Discord OAuth2 — this is only for bot-side convenience
 * (e.g. marking dashboard-originated messages, future slash commands).
 */
export function isStaffMember(member: GuildMember | null | undefined, cfg: BotConfig): boolean {
  if (!member) return false;
  if (cfg.staffWhitelist.has(member.id)) return true;
  if (cfg.staffRoleId && member.roles.cache.has(cfg.staffRoleId)) return true;
  return false;
}

export async function resolveMember(guild: Guild, resolvable: GuildMemberResolvable): Promise<GuildMember | null> {
  try {
    return await guild.members.fetch(resolvable);
  } catch {
    return null;
  }
}
