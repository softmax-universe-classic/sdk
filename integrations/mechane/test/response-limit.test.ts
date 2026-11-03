import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createMechanePolicy, MechanePolicyError } from "../src/index.js";

test("an oversized runtime response is interrupted before its full body is buffered", async (context) => {
  const chunks = 256;
  let sent = 0;
  let stopped = false;
  const server = createServer(async (_request, response) => {
    response.on("close", () => {
      stopped = true;
    });
    response.setHeader("Content-Type", "application/json");
    response.write('{"name":"');
    while (!stopped && sent < chunks) {
      response.write("x".repeat(65_536));
      sent += 1;
      await delay(2);
    }
    response.end('"}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const participant = {
    id: "player",
    label: "Player",
    kind: "bot",
    policy: "remote",
    model: "model",
  } as const;
  const policy = createMechanePolicy({
    endpoint: `http://127.0.0.1:${address.port}`,
    apiKey: "fixture-credential",
    workspaceId: "b1544098-d9f3-4009-90c4-f572412b7d0b",
    model: "model",
  });
  await assert.rejects(
    Promise.resolve(
      policy.open({
        participant,
        trial: { id: "trial", seed: 1, participants: [participant] },
        episodeId: "bounded-response",
        signal: AbortSignal.timeout(5000),
      }),
    ),
    MechanePolicyError,
  );
  assert.ok(sent < chunks, "The response must fail while the server is still streaming");
});
