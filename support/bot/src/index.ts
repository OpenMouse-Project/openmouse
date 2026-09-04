import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  ChannelType,
  TextChannel,
} from "discord.js";
import { loadConfig } from "./config.js";
import { CREATE_TICKET_BUTTON_ID, deployPanel } from "./handlers/panel.js";
import { TICKET_MODAL_ID, handleCreateTicket } from "./handlers/createTicket.js";
import { handleTicketModal } from "./handlers/ticketModal.js";
import { handleMessageCreate } from "./handlers/messageCreate.js";

const PANEL_COMMAND = "om-support-panel";

async function main() {
  const cfg = loadConfig();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent, // required to read thread message content
    ],
  });

  client.once(Events.ClientReady, async () => {
    console.log(`[om-support] Logged in as ${client.user?.tag}`);

    const guild = client.guilds.cache.get(cfg.guildId);
    if (!guild) {
      console.error(`[om-support] Guild ${cfg.guildId} not found. Is the bot invited to it?`);
      return;
    }

    // (Re)post the support panel in #support on startup so the "Create Ticket"
    // button is always present. The optional SUPPORT_PANEL_MESSAGE_ID tells the
    // bot to edit the existing panel instead of stacking a new one.
    const channel = (await guild.channels.fetch(cfg.supportChannelId).catch(() => null)) as TextChannel | null;
    if (channel && channel.type === ChannelType.GuildText) {
      const messageId = await deployPanel(channel, process.env.SUPPORT_PANEL_MESSAGE_ID ?? null);
      console.log(`[om-support] Support panel ready in #${channel.name} (message ${messageId}).`);
    } else {
      console.warn(`[om-support] #support channel ${cfg.supportChannelId} not available as a text channel.`);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton() && interaction.customId === CREATE_TICKET_BUTTON_ID) {
        await handleCreateTicket(interaction);
      } else if (interaction.isModalSubmit() && interaction.customId === TICKET_MODAL_ID) {
        await handleTicketModal(interaction, cfg);
      } else if (interaction.isChatInputCommand() && interaction.commandName === PANEL_COMMAND) {
        if (interaction.guild?.id !== cfg.guildId) {
          await interaction.reply({ content: "This command only works in the OpenMouse server.", ephemeral: true });
          return;
        }
        const channel = interaction.channel;
        if (!channel || channel.type !== ChannelType.GuildText) {
          await interaction.reply({ content: "Run this command in a text channel.", ephemeral: true });
          return;
        }
        await deployPanel(channel, process.env.SUPPORT_PANEL_MESSAGE_ID ?? null);
        await interaction.reply({ content: "Support panel is ready.", ephemeral: true });
      }
    } catch (err) {
      console.error("[om-support] Interaction error:", err);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Something went wrong. Please try again.", ephemeral: true }).catch(() => undefined);
      }
    }
  });

  client.on(Events.MessageCreate, (message) => handleMessageCreate(message, cfg));

  client.on(Events.Error, (err) => console.error("[om-support] Client error:", err));

  await registerCommands(cfg);

  await client.login(cfg.token);
}

async function registerCommands(cfg: ReturnType<typeof loadConfig>) {
  const rest = new REST({ version: "10" }).setToken(cfg.token);
  const commands = [
    {
      name: PANEL_COMMAND,
      description: "(Re)post the OpenMouse support panel in this channel.",
    },
  ];
  await rest.put(Routes.applicationGuildCommands(cfg.clientId, cfg.guildId), {
    body: commands,
  });
  console.log("[om-support] Registered guild commands.");
}

process.on("unhandledRejection", (err) => console.error("[om-support] Unhandled rejection:", err));
process.on("uncaughtException", (err) => console.error("[om-support] Uncaught exception:", err));

main().catch((err) => {
  console.error("[om-support] Fatal:", err);
  process.exit(1);
});
