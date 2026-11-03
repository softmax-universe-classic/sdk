import { createClient, UniverseApiError } from "../src/index.js";
import assert from "node:assert/strict";
import test from "node:test";
import { makeRun, episode } from "./support/index.js";

test("HTTP reads validate returned identity and keep credentials and raw errors out of diagnostics", async () => {
  const run = makeRun();
  const requests: { url: string; options: RequestInit | undefined }[] = [];
  let response = Response.json({ run, episodes: [episode(run)] });
  const client = createClient({
    baseUrl: "https://universe.example",
    projectId: "project-1",
    token: "fixture-secret-token",
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      return response;
    },
  });
  assert.equal((await client.getRun(run.id)).episodes.length, 1);
  assert.equal(requests[0]?.url, "https://universe.example/api/projects/project-1/runs/run-1");
  assert.equal(requests[0]?.options?.credentials, "same-origin");
  assert.equal(
    new Headers(requests[0]?.options?.headers).get("Authorization"),
    "Bearer fixture-secret-token",
  );
  response = Response.json({ run: { ...run, id: "other-run" }, episodes: [] });
  await assert.rejects(client.getRun(run.id), (error: unknown) => {
    return error instanceof UniverseApiError && error.code === "INVALID_RESPONSE";
  });
  response = Response.json(
    { error: { code: "UNAUTHORIZED", message: "fixture-secret-token" } },
    { status: 401 },
  );
  await assert.rejects(client.listRuns(), (error: unknown) => {
    assert.ok(error instanceof UniverseApiError);
    assert.equal(error.status, 401);
    assert.equal(error.code, "UNAUTHORIZED");
    assert.equal(String(error).includes("fixture-secret-token"), false);
    return true;
  });
});
