import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readRunDirectory, runBenchmark } from "@softmax-universe/runner";
import type { Run } from "@softmax-universe/sdk";
import { createMechanePolicy } from "../src/index.js";

const scenarios = {
  answered: "a remote policy records every dispatch and tool before releasing unused budget",
  disconnected: "a lost submission response keeps its reservation and cancels remote work",
  refused: "refused dispatches release unused budget without inventing paid calls",
};

for (const scenario of ["answered", "disconnected", "refused"] as const) {
  test(scenarios[scenario], async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "universe-mechane-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const apiKey = "fixture-mechane-secret";
    let submitted = 0;
    let cancelled = false;
    let archived = false;
    let requestId = "";
    let deadlineAt = "";
    const started = new Date().toISOString();
    const server = createServer(async (request, response) => {
      assert.equal(request.headers.authorization, `Bearer ${apiKey}`);
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      response.setHeader("Content-Type", "application/json");
      if (request.url?.endsWith("/mechs")) {
        response.end(JSON.stringify({ id: "06dc1a52-fb67-437c-a018-b8458f44bc01", revision: 1 }));
        return;
      }
      if (request.url?.endsWith("/definition")) {
        archived = body.status === "archived";
        response.end(JSON.stringify({ id: "06dc1a52-fb67-437c-a018-b8458f44bc01", revision: 2 }));
        return;
      }
      if (request.url?.endsWith("/cancel")) {
        cancelled = true;
      } else if (request.method === "POST") {
        submitted += 1;
        requestId = request.url!.split("/").at(-1)!;
        deadlineAt = body.deadline_at;
        if (scenario === "disconnected") {
          response.destroy();
          return;
        }
      }
      const completed = request.method === "GET";
      const turn = {
        request_id: requestId,
        status: completed ? "answered" : "queued",
        received_at: started,
        deadline_at: deadlineAt,
        max_model_dispatches: 3,
        max_output_tokens: 64,
        dispatched_count: completed ? 2 : 0,
        evidence_complete: completed,
        dispatches: completed
          ? ["64e30162-1742-4102-be90-1d112c5a1274", "217a8547-a7d8-47fc-aeae-61a076e7f71b"].map(
              (id) => ({
                id,
                model: "model",
                status: "settled",
                decided_at: started,
                settled_at: started,
                basis: "usage",
                input_tokens: 10,
                output_tokens: 5,
                cache_read_tokens: 2,
                cache_write_tokens: 0,
              }),
            )
          : [],
        dispatch_evidence: completed
          ? ["64e30162-1742-4102-be90-1d112c5a1274", "217a8547-a7d8-47fc-aeae-61a076e7f71b"].map(
              (id) => ({
                id,
                model: "model",
                status: "completed",
                started_at: started,
                ended_at: started,
                request: { messages: [{ role: "user", content: "game observation" }] },
                response: {
                  provider: "fixture",
                  model: "model",
                  responseModel: "actual-model",
                  content: [{ type: "text", text: "answer" }],
                },
              }),
            )
          : [],
        tool_calls: completed
          ? [
              {
                id: "tool-1",
                name: "read",
                input: { file: "strategy" },
                output: apiKey,
                status: "completed",
              },
            ]
          : [],
        unknowns: [],
      };
      if (scenario === "refused" && completed) {
        response.end(
          JSON.stringify({
            ...turn,
            status: "unanswered",
            reason: "dispatch_refused",
            dispatched_count: 1,
            dispatches: [
              {
                id: "7cfa080c-4bd6-4f8a-9ebd-92b131993ee6",
                model: "model",
                status: "refused",
                decided_at: started,
              },
            ],
            dispatch_evidence: [],
            tool_calls: [],
            turn_id: "4278b031-062b-498f-8a8a-f9c8c5e059aa",
          }),
        );
        return;
      }
      response.end(
        JSON.stringify({
          ...turn,
          ...(completed
            ? { turn_id: "4278b031-062b-498f-8a8a-f9c8c5e059aa", reply: '{"actionIndex":0}' }
            : {}),
        }),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    context.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const policy = createMechanePolicy({
      endpoint: `http://127.0.0.1:${address.port}`,
      apiKey,
      workspaceId: "b1544098-d9f3-4009-90c4-f572412b7d0b",
      model: "model",
      pollIntervalMs: 10,
    });
    const run: Run = {
      schemaVersion: 2,
      id: "remote-test",
      name: "Remote test",
      kind: "benchmark",
      createdAt: started,
      game: { id: "fixture", version: "1" },
      configuration: {},
      trials: [
        {
          id: "trial",
          seed: 1,
          participants: [
            { id: "player", label: "Player", kind: "bot", policy: "remote", model: "model" },
          ],
        },
      ],
    };
    let applied = false;
    await runBenchmark({
      run,
      directory,
      policies: { remote: policy },
      limits: {
        maxDecisionsPerEpisode: 1,
        maxModelCalls: 3,
        maxModelCallsPerDecision: 3,
        maxOutputTokens: 64,
        decisionTimeoutMs: 5000,
        episodeTimeoutMs: 10000,
        runTimeoutMs: 12000,
      },
      createGame: () => ({
        getTurn: () => ({ participantId: "player", observation: {}, legalActions: ["move"] }),
        apply: (action) => {
          applied = true;
          return { accepted: true, action, nextObservation: "done" };
        },
        getOutcome: () => (applied ? { scores: { player: 1 } } : null),
      }),
    });
    const saved = await readRunDirectory(directory);
    const decision = saved.episodes[0]!.decisions[0]!;
    assert.equal(submitted, 1);
    assert.equal(archived, true);
    assert.equal(decision.runtime?.requestId, requestId);
    if (scenario === "disconnected") {
      assert.equal(cancelled, true);
      assert.equal(applied, false);
      assert.equal(decision.reservedModelCalls, 3);
      assert.equal(saved.episodes[0]!.outcome.kind, "failed");
    } else if (scenario === "refused") {
      assert.equal(applied, false);
      assert.equal(decision.reservedModelCalls, 0);
      assert.equal(decision.modelCalls.length, 0);
      assert.equal(saved.episodes[0]!.outcome.kind, "failed");
    } else {
      assert.equal(saved.episodes[0]!.outcome.kind, "terminated");
      assert.equal(decision.reservedModelCalls, 0);
      assert.equal(decision.modelCalls.length, 2);
      assert.equal(decision.modelCalls[0]?.inputTokens, 12);
      assert.equal(decision.modelCalls[0]?.model, "actual-model");
      assert.equal(decision.modelCalls[0]?.costUsd, undefined);
      assert.equal(decision.toolCalls[0]?.output, "[redacted]");
    }
  });
}
