import { ChannelType, Message } from "discord.js";
import type { BotConfig } from "../config.js";
import { getTicketByThreadId, touchTicketActivity, TicketRow } from "../repo.js";
import { getSupabase } from "../supabase.js";
import { isStaffMember } from "../staff.js";

/**
 * Discord is the source of truth for the ticket conversation, so this handler
 * no longer mirrors messages into Supabase. It only:
 *   - auto-reopens a RESOLVED/CLOSED ticket when the original user replies, and
 *   - touches the ticket's activity timestamps (metadata) so the dashboard's
 *     "recent activity" stays current without storing the message itself.
 *
 * Message content, edits, deletions and attachments all live in Discord and are
 * read directly from the Discord API by the dashboard.
 */
export async function handleMessageCreate(message: Message, cfg: BotConfig): Promise<void> {
  // Only care about text messages authored by people, in a guild thread that we
  // can identify as a ticket thread.
  if (message.author.bot) return;
  if (!message.guildId) return;
  if (!message.channel || message.channel.type !== ChannelType.PublicThread) return;

  // Fast path: only threads whose parent is the configured #support channel.
  const parentId = message.channel.parentId;
  if (!parentId || parentId !== cfg.supportChannelId) return;

  const db = getSupabase(cfg);
  const ticket = await getTicketByThreadId(db, message.channelId);
  if (!ticket) return; // not a known ticket thread; nothing to do

  // Auto-reopen when a user (not staff) replies to a resolved/closed ticket.
  const member = message.member;
  const isStaff = isStaffMember(member, cfg);
  if (ticket.status === "RESOLVED" || ticket.status === "CLOSED") {
    if (!isStaff && message.author.id === ticket.user_discord_id) {
      await reopenTicket(db, ticket, message).catch((err) =>
        console.error("[om-support] Failed to reopen ticket:", err),
      );
    }
  }

  // Keep metadata fresh; the message content itself stays in Discord.
  await touchTicketActivity(db, ticket.id).catch((err) =>
    console.error("[om-support] Failed to touch activity:", err),
  );
}

async function reopenTicket(db: ReturnType<typeof getSupabase>, ticket: TicketRow, message: Message) {
  const { error } = await db
    .from("support_tickets")
    .update({
      status: "OPEN",
      reopened_at: new Date().toISOString(),
      closed_at: null,
    })
    .eq("id", ticket.id);
  if (error) {
    console.error("[om-support] Failed to reopen ticket row:", error);
    return;
  }
  const thread = message.channel as import("discord.js").PublicThreadChannel;
  await thread
    .send("📥 This ticket was **reopened** because you replied. A staff member will get back to you.")
    .catch(() => undefined);
}
