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
  let nextMessageId = 1;
  const bot = {
    async sendMessage(...args) {
      if (overrides.sendMessage) return overrides.sendMessage(...args);
      return `sent-${nextMessageId++}`;
    },
    async editMessage(...args) {
      if (overrides.editMessage) return overrides.editMessage(...args);
    },
    async sendButtons() {
      return "permission-1";
    },
    async sendFile(...args) {
      if (overrides.sendFile) return overrides.sendFile(...args);
    },
  };
  return new AgentStreamHandler(bot);
}

test("Discord delegates file delivery to the active channel", async () => {
  const sent = [];
  const renderer = createRenderer({
    sendFile: async (...args) => sent.push(args),
  });

  await renderer.sendFile(target, {
    path: "/workspace/report.pdf",
    name: "report.pdf",
  });

  assert.deepEqual(sent, [["channel-1", "/workspace/report.pdf", "report.pdf"]]);
});

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
    editRenderer.editBlock(
      target,
      [{ id: "sent-1", content: "answer" }],
      "text",
      "updated",
      true,
    ),
    editFailure,
  );
});

test("Discord preserves long block content across messages", async () => {
  const sent = [];
  const renderer = createRenderer({
    sendMessage: async (_chatId, content) => {
      sent.push(content);
      return `sent-${sent.length}`;
    },
  });
  const content = `${"a".repeat(1999)}🙂${"b".repeat(2001)}`;

  const ref = await renderer.sendBlock(target, "text", content);

  assert.deepEqual(ref.map(({ id }) => id), ["sent-1", "sent-2", "sent-3"]);
  assert.equal(sent.join(""), content);
  assert.ok(sent.every((chunk) => chunk.length <= 2000));
});

test("Discord streaming grows one block from one message to three", async () => {
  const messages = new Map();
  let nextMessageId = 1;
  const renderer = createRenderer({
    sendMessage: async (_chatId, content) => {
      const id = `sent-${nextMessageId++}`;
      messages.set(id, content);
      return id;
    },
    editMessage: async (_chatId, id, content) => {
      messages.set(id, content);
    },
  });
  const ref = await renderer.sendBlock(target, "text", "initial");
  const twoParts = "x".repeat(3000);
  const threeParts = `${"y".repeat(3999)}🙂`;

  await renderer.editBlock(target, ref, "text", twoParts, false);
  assert.equal(ref.length, 2);
  assert.equal(ref.map(({ id }) => messages.get(id)).join(""), twoParts);

  await renderer.editBlock(target, ref, "text", threeParts, true);
  const rendered = ref.map(({ id }) => messages.get(id));
  assert.equal(ref.length, 3);
  assert.equal(rendered.join(""), threeParts);
  assert.ok(rendered.every((chunk) => chunk.length <= 2000));
});

test("Discord streaming skips unchanged existing chunks", async () => {
  const edits = [];
  const renderer = createRenderer({
    editMessage: async (...args) => {
      edits.push(args);
    },
  });
  const initial = `${"a".repeat(2000)}tail`;
  const ref = await renderer.sendBlock(target, "text", initial);

  await renderer.editBlock(target, ref, "text", `${initial} extended`, false);

  assert.deepEqual(edits, [["channel-1", "sent-2", "tail extended"]]);
});

test("Discord sendText preserves long content across messages", async () => {
  const sent = [];
  const renderer = createRenderer({
    sendMessage: async (_chatId, content) => {
      sent.push(content);
      return `sent-${sent.length}`;
    },
  });
  const content = "z".repeat(4500);

  await renderer.sendText(target, content);

  assert.equal(sent.join(""), content);
  assert.ok(sent.every((chunk) => chunk.length <= 2000));
});
