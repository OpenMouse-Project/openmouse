import type { SupabaseClient } from "@supabase/supabase-js";
import type { TicketPriority, TicketStatus } from "./catalog.js";

export interface CreateTicketInput {
  subject: string;
  description: string;
  category: string;
  deviceModel: string | null;
  openmouseVersion: string | null;
  operatingSystem: string | null;
  firmwareVersion: string | null;
  userDiscordId: string;
  userDiscordUsername: string;
}

export interface CreatedTicket {
  id: string;
  number: number;
  publicNumber: string;
  subject: string;
}

export interface TicketRow {
  id: string;
  number: number;
  public_number: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  user_discord_id: string;
  discord_thread_id: string | null;
  description: string;
  category: string;
  device_model: string | null;
  openmouse_version: string | null;
  operating_system: string | null;
  firmware_version: string | null;
}

/**
 * Creates an unnumbered ticket row, then allocates a unique OM-XXXX number via
 * the concurrency-safe sequence RPC and returns it. Two concurrent creations
 * can never receive the same number.
 */
export async function createTicket(
  db: SupabaseClient,
  input: CreateTicketInput,
): Promise<CreatedTicket> {
  const { data: inserted, error: insertError } = await db
    .from("support_tickets")
    .insert({
      subject: input.subject,
      description: input.description,
      category: input.category,
      device_model: input.deviceModel,
      openmouse_version: input.openmouseVersion,
      operating_system: input.operatingSystem,
      firmware_version: input.firmwareVersion,
      user_discord_id: input.userDiscordId,
      user_discord_username: input.userDiscordUsername,
      public_number: "OM-PENDING", // replaced below by allocate_ticket_number
      number: 0, // replaced below
    })
    .select("id")
    .single();

  if (insertError) throw new Error(`Failed to create ticket: ${insertError.message}`);
  const ticketId = (inserted as { id: string }).id;

  const { data, error } = await db.rpc("allocate_ticket_number", {
    p_ticket: ticketId,
  });
  if (error) {
    // Best effort: leave the row but rethrow so the caller can surface it.
    throw new Error(`Failed to allocate ticket number: ${error.message}`);
  }

  const result = Array.isArray(data) ? data[0] : data;
  return {
    id: ticketId,
    number: result?.number_out as number,
    publicNumber: result?.public_number_out as string,
    subject: input.subject,
  };
}

export async function updateTicketThread(
  db: SupabaseClient,
  ticketId: string,
  threadId: string,
  threadName: string,
): Promise<void> {
  const { error } = await db
    .from("support_tickets")
    .update({ discord_thread_id: threadId, discord_thread_name: threadName })
    .eq("id", ticketId);
  if (error) throw new Error(`Failed to save thread: ${error.message}`);
}

export async function getTicketByThreadId(
  db: SupabaseClient,
  threadId: string,
): Promise<TicketRow | null> {
  const { data } = await db
    .from("support_tickets")
    .select(
      "id, number, public_number, subject, status, priority, user_discord_id, discord_thread_id, description, category, device_model, openmouse_version, operating_system, firmware_version",
    )
    .eq("discord_thread_id", threadId)
    .maybeSingle();
  return (data as TicketRow | null) ?? null;
}

/**
 * Touches a ticket's activity timestamps. Called whenever a user message arrives
 * in a ticket thread so the "recent activity" metadata stays fresh, even though
 * the conversation itself now lives in Discord (never mirrored to Supabase).
 */
export async function touchTicketActivity(
  db: SupabaseClient,
  ticketId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db.rpc("touch_ticket_activity", { p_ticket: ticketId });
  if (error) {
    // Fall back to a direct, best-effort update if the RPC is unavailable.
    const { error: updateError } = await db
      .from("support_tickets")
      .update({ updated_at: now, last_activity_at: now })
      .eq("id", ticketId);
    if (updateError) {
      console.error("[om-support] Failed to touch ticket activity:", updateError.message);
    }
  }
}
