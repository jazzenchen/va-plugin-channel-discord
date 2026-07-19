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

export class AgentStreamHandler extends BlockRenderer<string> {
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
    await this.discordBot.sendMessage(target.chatId, text);
  }

  protected async sendBlock(target: ChannelTarget, _kind: BlockKind, content: string): Promise<string | null> {
    return this.discordBot.sendMessage(target.chatId, content);
  }

  protected async editBlock(
    target: ChannelTarget,
    ref: string,
    _kind: BlockKind,
    content: string,
    _sealed: boolean,
  ): Promise<void> {
    await this.discordBot.editMessage(target.chatId, ref, content);
  }
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
