import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
import type { BotConfig } from "../config.js";

/**
 * Posts (or refreshes) the persistent "OpenMouse Support" panel in #support.
 * Idempotent-ish: if SUPPORT_PANEL_MESSAGE_ID is provided it edits that message
 * instead of sending another one. Designed to be run on bot startup.
 *
 * This keeps #support a normal text channel — the panel is just a message with
 * a button. One ticket = one thread created from this channel, not a Forum.
 */
export const SUPPORT_PANEL_EMOJI = "🎫";
export const CREATE_TICKET_BUTTON_ID = "om_support_create_ticket";

export function buildPanelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x69d28d)
    .setTitle("OpenMouse Support")
    .setDescription(
      "Need help with OpenMouse?\n\n" +
        "Click **Create Ticket** to open a support ticket. A staff member " +
        "will reply in a dedicated thread. Please include your device and " +
        "firmware details to help us diagnose faster.\n\n" +
        "For everything else, check the docs at docs.openmouse.app.",
    )
    .setFooter({ text: "OpenMouse-Support" });
}

export function buildPanelRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CREATE_TICKET_BUTTON_ID)
      .setStyle(ButtonStyle.Primary)
      .setLabel("Create Ticket")
      .setEmoji(SUPPORT_PANEL_EMOJI),
  );
}

export async function deployPanel(channel: TextChannel, existingMessageId: string | null): Promise<string> {
  const embed = buildPanelEmbed();
  const row = buildPanelRow();

  if (existingMessageId) {
    try {
      const existing = await channel.messages.fetch(existingMessageId);
      await existing.edit({ embeds: [embed], components: [row] });
      return existingMessageId;
    } catch {
      // Fall through and send a fresh panel if the old one is gone.
    }
  }

  const message = await channel.send({ embeds: [embed], components: [row] });
  return message.id;
}

export function panelConfigMessage(cfg: BotConfig): string {
  return "OpenMouse-Support panel lives in <#" + cfg.supportChannelId + ">. " +
    "Run `npx tsx src/deploy.ts` (or the `/om-support-panel` handling at startup) to (re)post it.";
}
