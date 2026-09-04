import {
  ActionRowBuilder,
  ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { TICKET_CATEGORIES } from "../catalog.js";

export const TICKET_MODAL_ID = "om_support_ticket_modal";

export const SUBJECT_FIELD = "t_subject";
export const DESCRIPTION_FIELD = "t_description";
export const CATEGORY_FIELD = "t_category";
export const DEVICE_FIELD = "t_device";
export const EXTRA_FIELD = "t_extra";

export const CATEGORY_HINT = TICKET_CATEGORIES.join(", ");

/**
 * Opens the ticket creation modal. Collects subject, description, category and
 * optional device context. Discord modals currently expose only text inputs in
 * this client build, so category is a validated text input with the valid
 * choices listed in its placeholder.
 */
export async function handleCreateTicket(interaction: ButtonInteraction): Promise<void> {
  const modal = new ModalBuilder().setCustomId(TICKET_MODAL_ID).setTitle("Open a Support Ticket");

  const subject = new TextInputBuilder()
    .setCustomId(SUBJECT_FIELD)
    .setLabel("Subject")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. Mouse not detected")
    .setRequired(true)
    .setMaxLength(120);

  const description = new TextInputBuilder()
    .setCustomId(DESCRIPTION_FIELD)
    .setLabel("Description")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Describe the problem in as much detail as you can…")
    .setRequired(true)
    .setMaxLength(2000);

  const category = new TextInputBuilder()
    .setCustomId(CATEGORY_FIELD)
    .setLabel("Category")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(CATEGORY_HINT)
    .setRequired(true)
    .setMaxLength(40);

  const device = new TextInputBuilder()
    .setCustomId(DEVICE_FIELD)
    .setLabel("Device / model (optional)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. Logitech G Pro X Superlight 2")
    .setRequired(false)
    .setMaxLength(80);

  const extra = new TextInputBuilder()
    .setCustomId(EXTRA_FIELD)
    .setLabel("Versions / OS / firmware (optional)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. OpenMouse 1.2.0 · Windows 11 · FW 1.0.4")
    .setRequired(false)
    .setMaxLength(180);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(subject),
    new ActionRowBuilder<TextInputBuilder>().addComponents(description),
    new ActionRowBuilder<TextInputBuilder>().addComponents(category),
    new ActionRowBuilder<TextInputBuilder>().addComponents(device),
    new ActionRowBuilder<TextInputBuilder>().addComponents(extra),
  );

  await interaction.showModal(modal);
}
