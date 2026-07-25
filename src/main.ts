#!/usr/bin/env node
/**
 * VibeAround Discord Plugin — ACP Client
 *
 * Spawned by the Rust host as a child process.
 * Communicates via ACP protocol (JSON-RPC 2.0 over stdio).
 */

import { createRequire } from "node:module";

import { runChannelPlugin } from "@vibearound/plugin-channel-sdk";

import { DiscordBot } from "./bot.js";
import { AgentStreamHandler } from "./agent-stream.js";

const packageVersion = (
  createRequire(import.meta.url)("../package.json") as { version: string }
).version;

runChannelPlugin({
  name: "vibearound-discord",
  version: packageVersion,
  requiredConfig: ["bot_token"],
  createBot: ({ config, agent, log, cacheDir, channelInstanceId, actorId }) =>
    new DiscordBot(
      config.bot_token as string,
      agent,
      log,
      cacheDir,
      channelInstanceId,
      actorId,
    ),
  createRenderer: (bot, _log, verbose) =>
    new AgentStreamHandler(bot, verbose),
  // Heartbeat health check — gateway ws ready + latency under 10s. Discord
  // keeps its own reconnect logic; we just confirm the socket's alive.
  healthCheck: async (bot) => {
    if (!bot.client.isReady()) return false;
    const ping = bot.client.ws.ping ?? -1;
    return ping >= 0 && ping < 10_000;
  },
});
