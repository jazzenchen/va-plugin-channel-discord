import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedResponse } from "../dist/bounded-response.js";

test("bounds declared and chunked attachment bodies", async () => {
  const declared = new Response(new Uint8Array([1]), { headers: { "content-length": "11" } });
  await assert.rejects(() => readBoundedResponse(declared, 10), /exceeds 10 bytes/);
  await assert.rejects(
    () => readBoundedResponse(new Response(new Uint8Array([1, 2, 3, 4])), 3),
    /exceeds 3 bytes/,
  );
});
