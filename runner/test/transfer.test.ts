import { limits, baseline } from "./support/index.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runBenchmark } from "../src/index.js";
import { directory, runDefinition, game, server } from "./support/index.js";

test("CLI upload and dataset export use only saved files and preserve them on delivery failure", async (t) => {
  const path = await directory(t);
  const { run, episodes } = await runBenchmark({
    run: runDefinition(),
    directory: path,
    limits,
    createGame: () => game(),
    policies: { baseline },
  });
  const episodePath = join(path, "episodes", `${episodes[0]!.id}.json`);
  const original = await readFile(episodePath, "utf8");
  let fail = false;
  const methods: string[] = [];
  const endpoint = await server(t, async (request, response) => {
    methods.push(`${request.method} ${request.url}`);
    assert.equal(request.headers.authorization, "Bearer fixture-upload-secret");
    for await (const _chunk of request) {
      /* Drain the request before replying. */
    }
    response.setHeader("Content-Type", "application/json");
    if (fail) {
      response.statusCode = 503;
      response.end(JSON.stringify({ error: { message: "fixture-upload-secret" } }));
    } else if (request.url?.endsWith("/export")) {
      response.end(
        JSON.stringify({ schemaVersion: 2, exportedAt: "2026-01-02T00:00:00.000Z", run, episodes }),
      );
    } else if (request.url?.includes("/episodes/")) {
      response.end(JSON.stringify({ episode: episodes[0] }));
    } else {
      response.end(JSON.stringify({ run }));
    }
  });
  async function cli(args: string[]) {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        new URL("../src/cli.ts", import.meta.url).pathname,
        ...args,
        "--endpoint",
        new URL(endpoint).origin,
        "--project",
        "project-a",
        "--key-env",
        "UNIVERSE_TEST_TOKEN",
      ],
      {
        env: { ...process.env, UNIVERSE_TEST_TOKEN: "fixture-upload-secret" },
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    const [code] = await once(child, "exit");
    return { code, output };
  }
  assert.equal((await cli(["upload", path])).code, 0);
  const output = join(path, "dataset.json");
  assert.equal((await cli(["dataset", "export", run.id, "--out", output])).code, 0);
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")).episodes, episodes);
  assert.deepEqual(methods, [
    "PUT /api/projects/project-a/runs/test-run",
    `PUT /api/projects/project-a/runs/test-run/episodes/${episodes[0]!.id}`,
    "GET /api/projects/project-a/runs/test-run/export",
  ]);
  fail = true;
  const failure = await cli(["upload", path]);
  assert.equal(failure.code, 1);
  assert.ok(!failure.output.includes("fixture-upload-secret"));
  assert.equal(await readFile(episodePath, "utf8"), original);
});
