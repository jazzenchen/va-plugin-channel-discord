/**
 * DiscordBot — discord.js bot wrapper.
 *
 * Handles:
 *   - Bot creation and WebSocket gateway connection
 *   - Inbound message parsing → ACP prompt() to Host
 *   - Message send/edit for streaming responses
 */

import fs from "node:fs/promises";
import path from "node:path";
import { readBoundedResponse } from "./bounded-response.js";
import {
  ActionRowBuilder,
  type Attachment,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  type Interaction,
  Partials,
  type Message,
  type TextBasedChannel,
} from "discord.js";
import {
  cancelChannelPrompt,
  channelTargetFromInboundContext,
  extractErrorMessage,
  isChannelStopCommand,
  sendChannelPrompt,
} from "@vibearound/plugin-channel-sdk";
import type {
  Agent,
  ChannelInboundContext,
  ContentBlock,
} from "@vibearound/plugin-channel-sdk";
import type { AgentStreamHandler } from "./agent-stream.js";
import { createDiscordChannelContext } from "./route-context.js";

type LogFn = (level: string, msg: string) => void;
const DISCORD_CONNECT_TIMEOUT_MS = 15_000;

export class DiscordBot {
  readonly client: Client;
  private agent: Agent;
  private log: LogFn;
  private cacheDir: string;
  private botToken: string;
  private channelInstanceId: string;
  private actorId: string;
  private streamHandler: AgentStreamHandler | null = null;
  /** Cache of sent messages so we can edit them later. */
  private messageCache = new Map<string, Message>();

  constructor(
    botToken: string,
    agent: Agent,
    log: LogFn,
    cacheDir: string,
    channelInstanceId: string,
    actorId: string,
  ) {
    this.agent = agent;
    this.log = log;
    this.cacheDir = cacheDir;
    this.botToken = botToken;
    this.channelInstanceId = channelInstanceId;
    this.actorId = actorId;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      // DM channels are not cached on startup, so without Partials.Channel
      // discord.js silently drops MessageCreate events that arrive for a
      // DM we haven't seen before. Partials.Message covers the rare case
      // where the inbound message itself is a partial.
      partials: [Partials.Channel, Partials.Message],
    });

    this.registerHandlers();
  }

  setStreamHandler(handler: AgentStreamHandler): void {
    this.streamHandler = handler;
  }

  /**
   * Start the bot and surface login failures to the SDK lifecycle. Starting
   * login in the constructor leaves rejected promises detached, so the host
   * can report a dead Discord bot as Running until the watchdog fires.
   */
  async start(): Promise<void> {
    await withConnectTimeout(
      this.client.login(this.botToken).then(() => undefined),
      "Discord gateway connection timed out",
    );
  }

  /** Stop the bot. */
  stop(): void {
    this.client.destroy();
  }

  /** Send a message to a channel. Returns the message ID. */
  async sendMessage(chatId: string, content: string): Promise<string> {
    const channel = await this.client.channels.fetch(chatId) as TextBasedChannel | null;
    if (!channel || !("send" in channel)) {
      throw new Error(`Channel ${chatId} not found or not text-based`);
    }
    const msg = await channel.send(content);
    this.messageCache.set(msg.id, msg);
    return msg.id;
  }

  /** Send a message with a row of buttons. Used by permission UI. */
  async sendButtons(
    chatId: string,
    content: string,
    buttons: { customId: string; label: string; style: "primary" | "danger" | "secondary" }[],
  ): Promise<string> {
    const channel = await this.client.channels.fetch(chatId) as TextBasedChannel | null;
    if (!channel || !("send" in channel)) {
      throw new Error(`Channel ${chatId} not found or not text-based`);
    }
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      buttons.map((b) =>
        new ButtonBuilder()
          .setCustomId(b.customId.slice(0, 100))
          .setLabel(b.label.slice(0, 80))
          .setStyle(buttonStyleToEnum(b.style)),
      ),
    );
    const msg = await channel.send({ content, components: [row] });
    return msg.id;
  }

  /** Edit an existing message. */
  async editMessage(chatId: string, messageId: string, content: string): Promise<void> {
    const cached = this.messageCache.get(messageId);
    if (cached) {
      await cached.edit(content);
      return;
    }
    // Fallback: fetch channel and message
    const channel = await this.client.channels.fetch(chatId) as TextBasedChannel | null;
    if (!channel || !("messages" in channel)) return;
    const msg = await channel.messages.fetch(messageId);
    await msg.edit(content);
  }

  // --------------------------------------------------------------------------
  // Handlers
  // --------------------------------------------------------------------------

  private registerHandlers(): void {
    this.client.once(Events.ClientReady, (c) => {
      this.log("info", `bot ready: ${c.user.username} (${c.user.id})`);
    });

    this.client.on(Events.MessageCreate, (message) => {
      void this.handleMessage(message).catch((error: unknown) => {
        this.log("error", `message handler failed: ${extractErrorMessage(error)}`);
      });
    });

    this.client.on(Events.InteractionCreate, (interaction) => {
      void this.handleInteraction(interaction).catch((error: unknown) => {
        this.log("error", `interaction handler failed: ${extractErrorMessage(error)}`);
      });
    });

    this.client.on(Events.Error, (error) => {
      this.log("error", `client error: ${error.message}`);
    });
  }

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isButton()) return;
    const btn = interaction as ButtonInteraction;
    const id = btn.customId;
    if (!id.startsWith("va_perm:")) return;

    const rest = id.slice("va_perm:".length);
    const colon = rest.indexOf(":");
    if (colon <= 0) return;
    const callbackId = rest.slice(0, colon);
    const optionId = rest.slice(colon + 1);

    const ok =
      this.streamHandler?.resolvePermission(callbackId, optionId) ?? false;
    this.log(
      "info",
      `permission resolve cb=${callbackId} option=${optionId} ok=${ok}`,
    );
    // Recover the human label from the pressed button. Discord.js types include
    // SKU buttons which have no label — narrow with a defensive access.
    const optionName =
      (btn.component as { label?: string | null } | undefined)?.label ?? optionId;
    try {
      await btn.update({
        content: ok
          ? `🔐 Permission — selected: **${optionName}**`
          : `🔐 Permission — already handled`,
        components: [],
      });
    } catch (e) {
      this.log("error", `permission ack failed: ${e}`);
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    // Ignore bot's own messages
    if (message.author.id === this.client.user?.id) return;
    // Ignore other bots
    if (message.author.bot) return;

    // In guild channels, only respond when @mentioned. DMs always pass through.
    const isDM = !message.guild;
    const isMentioned = message.mentions.has(this.client.user!);
    if (!isDM && !isMentioned) return;

    const chatId = message.channelId;
    // Strip the @mention from the text so the agent sees clean input
    let text = message.content;
    if (isMentioned && this.client.user) {
      text = text.replace(new RegExp(`<@!?${this.client.user.id}>`, "g"), "").trim();
    }

    if (!text && message.attachments.size === 0) return;

    this.log(
      "debug",
      `message channel=${chatId} text=${Boolean(text)} attachments=${message.attachments.size}`,
    );

    const context = this.channelContext({
      chatId,
      topicId: message.channel.isThread() ? message.channelId : undefined,
      senderId: message.author.id,
      platformMessageId: message.id,
      scope: isDM ? "dm" : "group",
      addressedBy: isDM ? "dm" : "mention",
    });
    const target = channelTargetFromInboundContext(context);

    if (text && await this.cancelIfRequested(text, context)) return;

    // Build content blocks
    const contentBlocks: ContentBlock[] = [];

    if (text) {
      contentBlocks.push({ type: "text", text });
    }

    // Handle attachments (images, files).
    //
    // Discord CDN URLs (cdn.discordapp.com / media.discordapp.net) now ship
    // with signed, expiring query parameters. Claude Agent's fetch tool
    // can't reliably pull them — and for images we want them inlined as a
    // local file anyway so the ACPPod relocate step can drop them into the
    // workspace cache, matching how feishu handles media. Download here.
    for (const [, attachment] of message.attachments) {
      const localPath = await this.downloadAttachment(message.channelId, attachment).catch(
        (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.log("warn", `failed to download attachment ${attachment.id}: ${msg}`);
          return null;
        },
      );
      if (!localPath) continue;

      if (!text) {
        contentBlocks.push({
          type: "text",
          text: `The user sent a file: ${attachment.name ?? "unknown"}`,
        });
      }
      contentBlocks.push({
        type: "resource_link",
        uri: `file://${localPath}`,
        name: attachment.name ?? "attachment",
        mimeType: attachment.contentType ?? "application/octet-stream",
      });
    }

    if (contentBlocks.length === 0) return;

    // If a permission prompt is awaiting text, consume this message.
    if (text && this.streamHandler?.consumePendingText(target, text)) {
      return;
    }

    // Show typing indicator
    const channel = message.channel;
    if ("sendTyping" in channel) {
      await channel.sendTyping().catch(() => {});
    }
    const typingInterval = setInterval(() => {
      if ("sendTyping" in channel) {
        channel.sendTyping().catch(() => {});
      }
    }, 8000); // Discord typing expires after 10s

    // Notify stream handler before prompt
    this.streamHandler?.onPromptSent(target);

    try {
      const response = await sendChannelPrompt(this.agent, {
        context,
        prompt: contentBlocks,
      });
      if (!response) {
        await this.streamHandler?.onTurnEnd(target);
        return;
      }
      this.log("info", `prompt done channel=${chatId} stopReason=${response.stopReason}`);
      await this.streamHandler?.onTurnEnd(target);
    } catch (error: unknown) {
      const msg = extractErrorMessage(error);
      this.log("error", `prompt failed channel=${chatId}: ${msg}`);
      await this.streamHandler?.onTurnError(target, msg);
    } finally {
      clearInterval(typingInterval);
    }
  }

  private channelContext(
    route: Omit<ChannelInboundContext, "channelInstanceId" | "actorId">,
  ): ChannelInboundContext {
    return createDiscordChannelContext(
      {
        channelInstanceId: this.channelInstanceId,
        actorId: this.actorId,
        botUserId: this.client.user?.id,
      },
      route,
    );
  }

  private async cancelIfRequested(
    text: string,
    context: ChannelInboundContext,
  ): Promise<boolean> {
    if (!isChannelStopCommand(text)) return false;

    try {
      const cancelled = await cancelChannelPrompt(this.agent, { context });
      this.log("info", `cancel requested channel=${context.chatId} sent=${cancelled}`);
    } catch (error: unknown) {
      this.log(
        "error",
        `cancel failed channel=${context.chatId}: ${extractErrorMessage(error)}`,
      );
    }
    return true;
  }

  /**
   * Download a Discord attachment into the plugin cache directory and
   * return the local file path. Cached by attachment id so repeated
   * prompts referring to the same file don't re-download.
   */
  private async downloadAttachment(
    chatId: string,
    attachment: Attachment,
  ): Promise<string> {
    const ext = attachment.name && attachment.name.includes(".")
      ? `.${attachment.name.split(".").pop()}`
      : "";
    const dir = path.join(this.cacheDir, "discord", chatId);
    const localPath = path.join(dir, `${attachment.id}${ext}`);

    try {
      await fs.access(localPath);
      this.log("debug", `attachment cache hit: ${localPath}`);
      return localPath;
    } catch {
      // not cached, fall through to download
    }

    this.log(
      "debug",
      `downloading attachment id=${attachment.id}`,
    );
    const res = await fetch(attachment.url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching attachment`);
    }
    const buf = await readBoundedResponse(res);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(localPath, buf);
    this.log(
      "debug",
      `cached attachment ${buf.length} bytes → ${localPath}`,
    );
    return localPath;
  }
}

async function withConnectTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), DISCORD_CONNECT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buttonStyleToEnum(s: "primary" | "danger" | "secondary"): ButtonStyle {
  switch (s) {
    case "primary": return ButtonStyle.Primary;
    case "danger":  return ButtonStyle.Danger;
    default:        return ButtonStyle.Secondary;
  }
}
