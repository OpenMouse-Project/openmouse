import {
  ChannelType,
  EmbedBuilder,
  ModalSubmitInteraction,
  TextChannel,
} from "discord.js";
import { DEFAULT_PRIORITY, DEFAULT_STATUS, isTicketCategory, TICKET_PRIORITY_LABEL, TICKET_STATUS_LABEL } from "../catalog.js";
import type { BotConfig } from "../config.js";
import { createTicket, updateTicketThread } from "../repo.js";
import { getSupabase } from "../supabase.js";
import {
  CATEGORY_FIELD,
  DESCRIPTION_FIELD,
  DEVICE_FIELD,
  EXTRA_FIELD,
  SUBJECT_FIELD,
} from "./createTicket.js";

const PUBLIC_NUMBER_RE = /^OM-[0-9a-zA-Z\- ]+$/;

/**
 * Handles the ticket creation modal. Steps:
 *   1. Read + validate the form.
 *   2. Create the ticket row in Supabase (concurrency-safe OM-XXXX number).
 *   3. Create a thread inside #support (never a separate channel / Forum).
 *   4. Save the thread id against the ticket.
 *   5. Post the initial ticket information into the thread.
 *   6. Associate the Discord user with the ticket.
 */
export async function handleTicketModal(
  interaction: ModalSubmitInteraction,
  cfg: BotConfig,
): Promise<void> {
  const subject = (interaction.fields.getTextInputValue(SUBJECT_FIELD) ?? "").trim();
  const description = (interaction.fields.getTextInputValue(DESCRIPTION_FIELD) ?? "").trim();
  const categoryValue = (interaction.fields.getTextInputValue(CATEGORY_FIELD) ?? "").trim();
  const device = (interaction.fields.getTextInputValue(DEVICE_FIELD) ?? "").trim() || null;
  const extra = (interaction.fields.getTextInputValue(EXTRA_FIELD) ?? "").trim() || null;

  if (!subject) {
    await interaction.reply({ content: "A subject is required. Please try again.", ephemeral: true });
    return;
  }
  if (!description) {
    await interaction.reply({ content: "A description is required. Please try again.", ephemeral: true });
    return;
  }
  const category = isTicketCategory(categoryValue) ? categoryValue : "Other";

  // Best-effort parse of the optional "Versions / OS / firmware" text into the
  // three diagnostic fields. Only populated where something was given.
  let openmouseVersion: string | null = null;
  let operatingSystem: string | null = null;
  let firmwareVersion: string | null = null;
  if (extra) {
    const om = extra.match(/(?:OpenMouse|OM)\s*([0-9][0-9.a-zA-Z-]*)/i);
    if (om) openmouseVersion = om[1];
    const fw = extra.match(/(?:FW|firmware|firmware\s+version)[^\d-]{0,4}\s*([0-9][0-9.a-zA-Z-]*)/i);
    if (fw) firmwareVersion = fw[1];
    if (/windows/i.test(extra)) operatingSystem = "Windows";
    else if (/macos|mac os/i.test(extra)) operatingSystem = "macOS";
    else if (/linux/i.test(extra)) operatingSystem = "Linux";
  }

  const db = getSupabase(cfg);
  const authorUsername = interaction.user.username;
  const discordId = interaction.user.id;

  // 1 + 2: create ticket with a concurrency-safe number.
  let created;
  try {
    created = await createTicket(db, {
      subject,
      description,
      category,
      deviceModel: device,
      openmouseVersion,
      operatingSystem,
      firmwareVersion,
      userDiscordId: discordId,
      userDiscordUsername: authorUsername,
    });
  } catch (err) {
    console.error("[om-support] Failed to create ticket:", err);
    await interaction.reply({
      content:
        "There was a problem creating your ticket. Please try again in a moment — if this keeps happening, contact us and mention 'ticket creation failed'.",
      ephemeral: true,
    });
    return;
  }

  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    console.error("[om-support] Create-ticket interaction not in a text channel.");
    await interaction.followUp({ content: "Something went wrong setting up your thread.", ephemeral: true });
    return;
  }

  // 3: create a thread inside #support, named after the ticket.
  let thread;
  try {
    thread = await channel.threads.create({
      name: `${created.publicNumber} — ${subject.slice(0, 80)}`,
      autoArchiveDuration: 10080, // 7 days of inactivity before auto-archive
      type: ChannelType.PublicThread,
      reason: "OpenMouse-Support ticket",
    });
  } catch (err) {
    console.error("[om-support] Failed to create thread:", err);
    await interaction.reply({
      content:
        "Your ticket was created but I couldn't set up the thread. A staff member will contact you — mention your ticket is pending setup.",
      ephemeral: true,
    });
    return;
  }
  // Add the user to the thread so they own the conversation.
  try {
    await thread.members.add(discordId);
  } catch (err) {
    console.warn("[om-support] Could not add thread member:", err);
  }

  // 4: save the thread id against the ticket.
  try {
    await updateTicketThread(db, created.id, thread.id, thread.name);
  } catch (err) {
    console.error("[om-support] Failed to persist thread id:", err);
    // Continue — the thread still works; recovery can re-link later.
  }

  // 5: post the initial ticket information into the thread.
  const infoEmbed = new EmbedBuilder()
    .setColor(0x69d28d)
    .setTitle(`${created.publicNumber} — ${subject}`)
    .setDescription(description || "_No description provided._")
    .addFields(
      { name: "User", value: `<@${discordId}>`, inline: true },
      { name: "Category", value: category, inline: true },
      { name: "Status", value: TICKET_STATUS_LABEL[DEFAULT_STATUS], inline: true },
      { name: "Priority", value: TICKET_PRIORITY_LABEL[DEFAULT_PRIORITY], inline: true },
      ...(device ? [{ name: "Device", value: device, inline: true }] : []),
      ...(openmouseVersion ? [{ name: "OpenMouse Version", value: openmouseVersion, inline: true }] : []),
      ...(operatingSystem ? [{ name: "OS", value: operatingSystem, inline: true }] : []),
      ...(firmwareVersion ? [{ name: "Firmware", value: firmwareVersion, inline: true }] : []),
    )
    .addFields({
      name: "How to reply",
      value: "Keep the conversation in this thread so staff can see it. Thanks!",
    })
    .setFooter({ text: "OpenMouse-Support" });

  await thread.send({ embeds: [infoEmbed] }).catch((err) => {
    console.error("[om-support] Failed to post initial ticket embed:", err);
  });

  // 6: associate the user (done above by adding to thread + storing discord id).

  await interaction.reply({
    content: `Your ticket **${created.publicNumber}** has been created in <#${thread.id}>. A staff member will help you shortly.`,
    ephemeral: true,
  });
}
