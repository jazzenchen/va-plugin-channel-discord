import assert from "node:assert/strict";
import test from "node:test";

import { AgentStreamHandler } from "../dist/agent-stream.js";

const target = {
  channelInstanceId: "discord-primary",
  actorId: "discord-bot",
  chatId: "channel-1",
  topicId: "thread-1",
  replyTo: "message-1",
};

function createRenderer(overrides = {}) {
  const bot = {
    async sendMessage(...args) {
      if (overrides.sendMessage) return overrides.sendMessage(...args);
      return "sent-1";
    },
    async editMessage(...args) {
      if (overrides.editMessage) return overrides.editMessage(...args);
    },
    async sendButtons() {
      return "permission-1";
    },
  };
  return new AgentStreamHandler(bot);
}

test("Discord transport failures reject block delivery", async () => {
  const sendFailure = new Error("Discord send failed");
  const editFailure = new Error("Discord edit failed");
  const sendRenderer = createRenderer({
    sendMessage: async () => { throw sendFailure; },
  });
  const editRenderer = createRenderer({
    editMessage: async () => { throw editFailure; },
  });

  await assert.rejects(
    sendRenderer.sendBlock(target, "text", "answer"),
    sendFailure,
  );
  await assert.rejects(
    editRenderer.editBlock(target, "sent-1", "text", "updated", true),
    editFailure,
  );
});

test("Discord turn completion exposes final delivery failure", async () => {
  const renderer = createRenderer({
    sendMessage: async () => { throw new Error("Discord final delivery failed"); },
  });

  renderer.onPromptSent(target);
  renderer.onSessionUpdate(target, {
    sessionId: "session",
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "final response" },
      messageId: "message-final",
    },
  });

  await assert.rejects(
    renderer.onTurnEnd(target),
    /Discord final delivery failed/,
  );
});
