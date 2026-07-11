import test from "node:test";
import assert from "node:assert/strict";

import { createDiscordChannelContext } from "../dist/route-context.js";

test("Discord keeps the host instance stable and addresses the real bot", () => {
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
      channelInstanceId: "discord-primary",
      actorId: "BOT_123",
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
  const context = createDiscordChannelContext(
    { channelInstanceId: "discord-primary", actorId: "codex-reviewer" },
    { chatId: "DM_123", scope: "dm", addressedBy: "dm" },
  );
  assert.equal(context.channelInstanceId, "discord-primary");
  assert.equal(context.actorId, "codex-reviewer");
});
