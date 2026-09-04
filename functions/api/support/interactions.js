// OpenMouse-Support · Discord HTTP Interactions endpoint.
//
// Replaces the long-lived Discord bot process entirely. Discord sends signed
// HTTP POST webhooks here for every button click / modal submit / slash command,
// so the whole interactive ticketing flow now runs on Cloudflare Pages Functions
// — no persistent gateway, no separate process to host.
//
// The conversation itself stays in Discord (source of truth); this endpoint only
// handles the *creation* flow (create ticket + thread, post the initial embed).
// Points back to the Supabase schema + dashboard Functions for the rest.
//
// To wire up:
//   1. Set the Discord app's "Interactions Endpoint URL" to
//      <SUPPORT_BASE_URL>/api/support/interactions (Discord Developer Portal →
//      General Information).
//   2. Add DISCORD_PUBLIC_KEY (also from General Information) to Pages env.
//   3. Ensure DISCORD_BOT_TOKEN / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
//      DISCORD_CLIENT_ID / SUPPORT_CHANNEL_ID are set in Pages env.
//   4. Register the /om-support-panel slash command (this endpoint responds
//      generically to any command with that name).

import { verify } from "./_ed25519.js";
import { supabase } from "./_supabase.js";
import { discordRequest, createPublicThread, addThreadMember, interactionFollowUp } from "./_discord.js";

export const CREATE_TICKET_BUTTON_ID = "om_support_create_ticket";
export const TICKET_MODAL_ID = "om_support_ticket_modal";

// Interaction response types (v10).
const TYPE_PING = 1;
const TYPE_APPLICATION_COMMAND = 2;
const TYPE_MESSAGE_COMPONENT = 3;
const TYPE_MODAL_SUBMIT = 5;
// response types
const RESP_PONG = 1;
const RESP_CHANNEL_MESSAGE_WITH_SOURCE = 4;
const RESP_DEFERRED_CHANNEL_MESSAGE = 5;
const RESP_MODAL = 9;

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const bodyText = await request.text();
  const timestamp = request.headers.get("x-signature-timestamp") || "";
  const signatureHex = request.headers.get("x-signature-ed25519") || "";
  const publicKeyHex = env.DISCORD_PUBLIC_KEY;

  if (!publicKeyHex || !signatureHex || !timestamp) {
    return json({ error: "Invalid interaction request." }, 401);
  }

  // Verify it really came from Discord (Ed25519 over "<timestamp><rawBody>").
  const ok = await verifySignature(publicKeyHex, timestamp, bodyText, signatureHex);
  if (!ok) return json({ error: "Bad signature." }, 401);

  let interaction;
  try {
    interaction = JSON.parse(bodyText);
  } catch {
    return json({ error: "Bad payload." }, 400);
  }

  switch (interaction.type) {
    case TYPE_PING:
      return json({ type: RESP_PONG });
    case TYPE_APPLICATION_COMMAND:
      return handleCommand(interaction, env);
    case TYPE_MESSAGE_COMPONENT:
      return handleComponent(interaction, env);
    case TYPE_MODAL_SUBMIT:
      return handleModalSubmit(interaction, env);
    default:
      return json({ type: RESP_DEFERRED_CHANNEL_MESSAGE });
  }
}

/** Ed25519 verification using the vendored pure-JS verifier. */
async function verifySignature(publicKeyHex, timestamp, body, signatureHex) {
  const pk = hexToBytes(publicKeyHex);
  const sig = hexToBytes(signatureHex);
  if (pk.length !== 32) return false;
  const msg = new TextEncoder().encode(timestamp + body);
  return verify(pk, msg, sig);
}

/** Slash command handler. Currently supports /om-support-panel. */
async function handleCommand(interaction, env) {
  const name = interaction.data?.name;
  if (name === "om-support-panel") {
    // Ack immediately; do the (potentially slow) panel work async.
    const ack = json({ type: RESP_DEFERRED_CHANNEL_MESSAGE });
    void deployPanelBestEffort(interaction, env);
    return ack;
  }
  return json({
    type: RESP_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: "Unknown command.", flags: 64 }, // ephemeral
  });
}

/** Button click handler: "Create Ticket" opens the ticket creation modal. */
function handleComponent(interaction, env) {
  const customId = interaction.data?.custom_id;
  if (customId === CREATE_TICKET_BUTTON_ID) {
    return json(buildTicketModal());
  }
  return json({
    type: RESP_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: "Unknown button.", flags: 64 },
  });
}

/** Modal submit handler: create the ticket + thread + initial embed. */
async function handleModalSubmit(interaction, env) {
  const customId = interaction.data?.custom_id;
  if (customId !== TICKET_MODAL_ID) {
    return json({
      type: RESP_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: "Unknown modal.", flags: 64 },
    });
  }

  const fields = (interaction.data?.components ?? []).reduce((acc, row) => {
    for (const comp of row.components ?? []) {
      if (comp.type === 4) acc[comp.custom_id] = comp.value ?? "";
    }
    return acc;
  }, {});

  const subject = (fields.t_subject ?? "").trim();
  const description = (fields.t_description ?? "").trim();
  if (!subject || !description) {
    return json({
      type: RESP_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: "Subject and description are required.", flags: 64 },
    });
  }

  // Ack deferred, then do the work and follow up ephemerally.
  const ack = json({ type: RESP_DEFERRED_CHANNEL_MESSAGE });
  const token = interaction.token;
  const appId = interaction.application_id;
  void createTicketFlow(interaction, env, { subject, description, fields }).catch((err) => {
    console.error("[om-support] createTicketFlow error:", err);
    void interactionFollowUp(env, appId, token, {
      content: "There was a problem creating your ticket. Please try again in a moment.",
      flags: 64,
    }).catch(() => undefined);
  });
  return ack;
}

async function createTicketFlow(interaction, env, { subject, description, fields }) {
  const db = supabase(env);
  const discordId = interaction.member?.user?.id || interaction.user?.id;
  const username = interaction.member?.user?.username || interaction.user?.username || "unknown";
  const channelId = interaction.channel_id;

  const category = isTicketCategory(fields.t_category) ? fields.t_category : "Other";
  const device = (fields.t_device ?? "").trim() || null;
  // Parse optional "Versions / OS / firmware" text.
  const extra = (fields.t_extra ?? "").trim() || null;
  const parsed = parseExtra(extra);

  // 1+2: create ticket with a concurrency-safe OM-XXXX number.
  let created;
  try {
    created = await createTicket(db, {
      subject,
      description,
      category,
      deviceModel: device,
      openmouseVersion: parsed.openmouseVersion,
      operatingSystem: parsed.operatingSystem,
      firmwareVersion: parsed.firmwareVersion,
      userDiscordId: discordId,
      userDiscordUsername: username,
    });
  } catch (err) {
    console.error("[om-support] Failed to create ticket:", err);
    throw err;
  }

  // 3: create the thread inside #support.
  let threadId;
  let threadName;
  try {
    threadName = `${created.publicNumber} — ${subject.slice(0, 80)}`;
    threadId = await createPublicThread(env, channelId, { name: threadName });
  } catch (err) {
    console.error("[om-support] Failed to create thread:", err);
    await interactionFollowUp(env, interaction.application_id, interaction.token, {
      content: "Your ticket was created but I couldn't set up the thread. A staff member will contact you.",
      flags: 64,
    });
    return;
  }

  try {
    await addThreadMember(env, threadId, discordId);
  } catch (err) {
    console.warn("[om-support] Could not add thread member:", err);
  }

  // 4: save the thread id against the ticket.
  try {
    await db.update("support_tickets", "id", created.id, {
      discord_thread_id: threadId,
      discord_thread_name: threadName,
    });
  } catch (err) {
    console.error("[om-support] Failed to persist thread id:", err);
  }

  // 5: post the initial ticket information embed into the thread.
  const embed = buildInfoEmbed(created.publicNumber, subject, description, {
    discordId,
    category,
    device,
    openmouseVersion: parsed.openmouseVersion,
    operatingSystem: parsed.operatingSystem,
    firmwareVersion: parsed.firmwareVersion,
  });
  await discordRequest(env, "POST", `/channels/${threadId}/messages`, { embeds: [embed] }).catch((err) => {
    console.error("[om-support] Failed to post initial embed:", err);
  });

  // 6: confirm to the user (ephemeral).
  await interactionFollowUp(env, interaction.application_id, interaction.token, {
    content: `Your ticket **${created.publicNumber}** has been created in <#${threadId}>. A staff member will help you shortly.`,
    flags: 64,
  });
}

/** Best-effort: (re)post the support panel into #support. Runs after ack. */
async function deployPanelBestEffort(interaction, env) {
  try {
    const channelId = interaction.channel_id || env.SUPPORT_CHANNEL_ID;
    const embed = buildPanelEmbed();
    const row = { type: 1, components: [panelButton()] };
    await discordRequest(env, "POST", `/channels/${channelId}/messages`, { embeds: [embed], components: [row] });
    await interactionFollowUp(env, interaction.application_id, interaction.token, {
      content: `Support panel posted to <#${channelId}>.`,
      flags: 64,
    });
  } catch (err) {
    console.error("[om-support] deployPanel failed:", err);
  }
}

function buildTicketModal() {
  return {
    type: RESP_MODAL,
    data: {
      custom_id: TICKET_MODAL_ID,
      title: "Open a Support Ticket",
      components: [
        textRow("t_subject", "Subject", 1, "e.g. Mouse not detected", true, 120),
        textRow("t_description", "Description", 2, "Describe the problem in as much detail as you can…", true, 2000),
        textRow("t_category", "Category", 1, TICKET_CATEGORIES.join(", "), true, 40),
        textRow("t_device", "Device / model (optional)", 1, "e.g. Logitech G Pro X Superlight 2", false, 80),
        textRow("t_extra", "Versions / OS / firmware (optional)", 1, "e.g. OpenMouse 1.2.0 · Windows 11 · FW 1.0.4", false, 180),
      ],
    },
  };
}

function textRow(customId, label, style, placeholder, required, maxLength) {
  return {
    type: 1,
    components: [
      { type: 4, custom_id: customId, label, style, placeholder, required, max_length: maxLength },
    ],
  };
}

function panelButton() {
  return {
    type: 2,
    style: 1, // PRIMARY
    label: "Create Ticket",
    emoji: { name: "🎫" },
    custom_id: CREATE_TICKET_BUTTON_ID,
  };
}

function buildPanelEmbed() {
  return {
    color: 0x69d28d,
    title: "OpenMouse Support",
    description:
      "Need help with OpenMouse?\n\n" +
      "Click **Create Ticket** to open a support ticket. A staff member will reply " +
      "in a dedicated thread. Please include your device and firmware details to " +
      "help us diagnose faster.\n\nFor everything else, check the docs at docs.openmouse.app.",
    footer: { text: "OpenMouse-Support" },
  };
}

function buildInfoEmbed(publicNumber, subject, description, info) {
  const fields = [
    { name: "User", value: `<@${info.discordId}>`, inline: true },
    { name: "Category", value: info.category, inline: true },
    { name: "Status", value: "OPEN", inline: true },
    { name: "Priority", value: "NORMAL", inline: true },
    ...(info.device ? [{ name: "Device", value: info.device, inline: true }] : []),
    ...(info.openmouseVersion ? [{ name: "OpenMouse Version", value: info.openmouseVersion, inline: true }] : []),
    ...(info.operatingSystem ? [{ name: "OS", value: info.operatingSystem, inline: true }] : []),
    ...(info.firmwareVersion ? [{ name: "Firmware", value: info.firmwareVersion, inline: true }] : []),
    {
      name: "How to reply",
      value: "Keep the conversation in this thread so staff can see it. Thanks!",
    },
  ];
  return {
    color: 0x69d28d,
    title: `${publicNumber} — ${subject}`,
    description: description || "_No description provided._",
    fields,
    footer: { text: "OpenMouse-Support" },
  };
}

/** Best-effort parse of the optional "Versions / OS / firmware" text. */
function parseExtra(extra) {
  const out = { openmouseVersion: null, operatingSystem: null, firmwareVersion: null };
  if (!extra) return out;
  const om = extra.match(/(?:OpenMouse|OM)\s*([0-9][0-9.a-zA-Z-]*)/i);
  if (om) out.openmouseVersion = om[1];
  const fw = extra.match(/(?:FW|firmware|firmware\s+version)[^\d-]{0,4}\s*([0-9][0-9.a-zA-Z-]*)/i);
  if (fw) out.firmwareVersion = fw[1];
  if (/windows/i.test(extra)) out.operatingSystem = "Windows";
  else if (/macos|mac os/i.test(extra)) out.operatingSystem = "macOS";
  else if (/linux/i.test(extra)) out.operatingSystem = "Linux";
  return out;
}

const TICKET_CATEGORIES = [
  "Device Not Detected",
  "Firmware",
  "DPI",
  "Polling Rate",
  "Lighting",
  "Compatibility",
  "Crash",
  "Installation",
  "Wireless",
  "Performance",
  "Other",
];

function isTicketCategory(value) {
  return TICKET_CATEGORIES.includes((value ?? "").trim());
}

/**
 * Creates a ticket row, allocates a concurrency-safe OM-XXXX number via the
 * sequence RPC and returns {id, publicNumber}.
 */
async function createTicket(db, input) {
  const inserted = await db.insert("support_tickets", {
    subject: input.subject,
    description: input.description,
    category: input.category,
    device_model: input.deviceModel,
    openmouse_version: input.openmouseVersion,
    operating_system: input.operatingSystem,
    firmware_version: input.firmwareVersion,
    user_discord_id: input.userDiscordId,
    user_discord_username: input.userDiscordUsername,
    public_number: "OM-PENDING",
    number: 0,
  });
  const rows = Array.isArray(inserted.body) ? inserted.body : [];
  const ticketId = rows[0]?.id;
  if (!ticketId) throw new Error("Failed to create ticket row.");

  const rpc = await db.rpc("allocate_ticket_number", { p_ticket: ticketId });
  const result = Array.isArray(rpc.body) ? rpc.body[0] : rpc.body;
  return {
    id: ticketId,
    publicNumber: result?.public_number_out ?? "OM-????",
  };
}

function hexToBytes(hex) {
  const clean = hex.replace(/^0x/i, "");
  if (clean.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
