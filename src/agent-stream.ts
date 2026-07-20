/**
 * Discord stream renderer — extends BlockRenderer with Discord-specific transport.
 *
 * Only implements sendText/sendBlock/editBlock + formatContent.
 * Everything else (block accumulation, notifications, chatId tracking)
 * is handled by BlockRenderer in the SDK.
 */

import {
  BlockRenderer,
  type BlockKind,
  type ChannelTarget,
  type RequestPermissionRequest,
  type VerboseConfig,
} from "@vibearound/plugin-channel-sdk";
import type { DiscordBot } from "./bot.js";

const DISCORD_MESSAGE_LIMIT = 2000;
type DiscordMessageRef = Array<{ id: string; content: string }>;

export class AgentStreamHandler extends BlockRenderer<DiscordMessageRef> {
  private discordBot: DiscordBot;

  constructor(discordBot: DiscordBot, verbose?: Partial<VerboseConfig>) {
    super({
      streaming: true,
      flushIntervalMs: 500,
      minEditIntervalMs: 1000,
      verbose,
    });
    this.discordBot = discordBot;
  }

  /** Render permission request as a button row. */
  protected async onRequestPermission(
    target: ChannelTarget,
    request: RequestPermissionRequest,
    callbackId: string,
  ): Promise<void> {
    const options = request.options ?? [];
    const toolTitle =
      (request.toolCall as { title?: string } | undefined)?.title ?? "the agent";

    const buttons = options.map((opt) => ({
      customId: `va_perm:${callbackId}:${opt.optionId}`,
      label: opt.name,
      style: discordButtonStyle(opt.kind),
    }));

    await this.discordBot.sendButtons(
      target.chatId,
      `🔐 Permission required — \`${toolTitle}\``,
      buttons,
    );
  }

  protected async sendText(target: ChannelTarget, text: string): Promise<void> {
    await this.sendContent(target, text);
  }

  protected async sendBlock(
    target: ChannelTarget,
    _kind: BlockKind,
    content: string,
  ): Promise<DiscordMessageRef | null> {
    return this.sendContent(target, content);
  }

  protected async editBlock(
    target: ChannelTarget,
    ref: DiscordMessageRef,
    _kind: BlockKind,
    content: string,
    _sealed: boolean,
  ): Promise<void> {
    const chunks = splitDiscordContent(content);
    const existingCount = Math.min(ref.length, chunks.length);

    for (let index = 0; index < existingCount; index += 1) {
      if (ref[index].content === chunks[index]) continue;
      await this.discordBot.editMessage(target.chatId, ref[index].id, chunks[index]);
      ref[index].content = chunks[index];
    }
    for (let index = ref.length; index < chunks.length; index += 1) {
      ref.push({
        id: await this.discordBot.sendMessage(target.chatId, chunks[index]),
        content: chunks[index],
      });
    }
  }

  private async sendContent(
    target: ChannelTarget,
    content: string,
  ): Promise<DiscordMessageRef> {
    const ref: DiscordMessageRef = [];
    for (const chunk of splitDiscordContent(content)) {
      ref.push({
        id: await this.discordBot.sendMessage(target.chatId, chunk),
        content: chunk,
      });
    }
    return ref;
  }
}

function splitDiscordContent(content: string): string[] {
  const chunks: string[] = [];
  let chunk = "";

  for (const character of content) {
    if (chunk.length + character.length > DISCORD_MESSAGE_LIMIT) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk += character;
    }
  }
  if (chunk.length > 0 || chunks.length === 0) {
    chunks.push(chunk);
  }
  return chunks;
}

/** Map permission option kinds to Discord button styles. */
function discordButtonStyle(kind: string): "primary" | "danger" | "secondary" {
  switch (kind) {
    case "allow_once":
    case "allow_always":
      return "primary";
    case "reject_once":
    case "reject_always":
      return "danger";
    default:
      return "secondary";
  }
}
