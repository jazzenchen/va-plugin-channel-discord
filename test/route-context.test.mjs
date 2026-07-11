import test from "node:test";
import assert from "node:assert/strict";

import { createDiscordChannelContext } from "../dist/route-context.js";

test("Discord route metadata prefers the real bot identity and preserves threads", () => {
  assert.deepEqual(
    createDiscordChannelContext(
      {
        channelInstanceId: "discord-primary",
        actorId: "codex-reviewer",
        botUserId: "BOT_123",
      },
      {
        chatId: "THREAD_456",
        topicId: "THREAD_456",
        senderId: "USER_789",
        platformMessageId: "MESSAGE_012",
        scope: "group",
        addressedBy: "mention",
      },
    ),
    {
      channelInstanceId: "BOT_123",
      actorId: "codex-reviewer",
      chatId: "THREAD_456",
      topicId: "THREAD_456",
      senderId: "USER_789",
      platformMessageId: "MESSAGE_012",
      scope: "group",
      addressedBy: "mention",
    },
  );
});

test("Discord route metadata falls back to the configured instance identity", () => {
  assert.equal(
    createDiscordChannelContext(
      { channelInstanceId: "discord-primary", actorId: "codex-reviewer" },
      { chatId: "DM_123", scope: "dm", addressedBy: "dm" },
    ).channelInstanceId,
    "discord-primary",
  );
});
