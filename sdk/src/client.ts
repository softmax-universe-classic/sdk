import { z } from "zod";
import { episodeSchema, idSchema, runSchema } from "./schema.js";
import type { Episode, Run } from "./schema.js";
import { runExportSchema, validateRunEpisodes } from "./validation.js";
import type { RunExport } from "./validation.js";

export interface ClientOptions {
  baseUrl: string;
  projectId: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface RunDetail {
  run: Run;
  episodes: Episode[];
}

export interface UniverseClient {
  putRun(run: Run, options?: RequestOptions): Promise<Run>;
  putEpisode(runId: string, episode: Episode, options?: RequestOptions): Promise<Episode>;
  listRuns(options?: RequestOptions): Promise<Run[]>;
  getRun(runId: string, options?: RequestOptions): Promise<RunDetail>;
  getEpisode(runId: string, episodeId: string, options?: RequestOptions): Promise<Episode>;
  exportRun(runId: string, options?: RequestOptions): Promise<RunExport>;
}

export class UniverseApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`Universe request failed (${code}).`);
    this.name = "UniverseApiError";
    this.status = status;
    this.code = code;
  }
}

const runResponseSchema = z.strictObject({ run: runSchema });
const episodeResponseSchema = z.strictObject({ episode: episodeSchema });
const runDetailSchema = z.strictObject({
  run: runSchema,
  episodes: z.array(episodeSchema).max(1000),
});
const runListSchema = z.strictObject({ runs: z.array(runSchema).max(1000) });
const errorResponseSchema = z.object({
  error: z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/) }),
});

function requireIdentity(matches: boolean): void {
  if (!matches) {
    throw new UniverseApiError(200, "INVALID_RESPONSE");
  }
}

export function createClient(options: ClientOptions): UniverseClient {
  const projectId = idSchema.parse(options.projectId);
  let base: URL;
  try {
    base = new URL(options.baseUrl);
  } catch {
    throw new Error("The Universe base URL must be a valid HTTP(S) URL.");
  }
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new Error(
      "The Universe base URL must be an HTTP(S) URL without credentials, query, or fragment.",
    );
  }
  const projectUrl = `${base.href.replace(/\/$/, "")}/api/projects/${encodeURIComponent(projectId)}`;
  const transport = options.fetch ?? globalThis.fetch.bind(globalThis);
  const headers = new Headers({ Accept: "application/json" });
  if (options.token !== undefined) {
    if (!/^[\x21-\x7e]+$/.test(options.token)) {
      throw new Error("The Universe token must be a nonempty header value.");
    }
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  function runPath(runId: string): string {
    return `/runs/${encodeURIComponent(idSchema.parse(runId))}`;
  }

  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    requestOptions: RequestOptions = {},
    body?: unknown,
  ): Promise<T> {
    const requestHeaders = new Headers(headers);
    const init: RequestInit = {
      method: body === undefined ? "GET" : "PUT",
      headers: requestHeaders,
      credentials: "same-origin",
      signal: requestOptions.signal,
      redirect: "error",
    };
    if (body !== undefined) {
      requestHeaders.set("Content-Type", "application/json");
      init.body = JSON.stringify(body);
    }
    let response: Response;
    try {
      response = await transport(`${projectUrl}${path}`, init);
    } catch {
      const code = requestOptions.signal?.aborted ? "ABORTED" : "NETWORK_ERROR";
      throw new UniverseApiError(0, code);
    }
    let document: unknown;
    try {
      document = await response.json();
    } catch {
      if (requestOptions.signal?.aborted) {
        throw new UniverseApiError(0, "ABORTED");
      }
      throw new UniverseApiError(response.status, "INVALID_RESPONSE");
    }
    if (!response.ok) {
      const failure = errorResponseSchema.safeParse(document);
      const code = failure.success ? failure.data.error.code : "REQUEST_FAILED";
      throw new UniverseApiError(response.status, code);
    }
    const result = schema.safeParse(document);
    if (!result.success) {
      throw new UniverseApiError(response.status, "INVALID_RESPONSE");
    }
    return result.data;
  }

  return {
    async putRun(value, requestOptions) {
      const run = runSchema.parse(value);
      const result = await request(runPath(run.id), runResponseSchema, requestOptions, run);
      requireIdentity(result.run.id === run.id);
      return result.run;
    },
    async putEpisode(runId, value, requestOptions) {
      const episode = episodeSchema.parse(value);
      if (episode.runId !== runId) {
        throw new Error("Episode run ID must match the requested run.");
      }
      const path = `${runPath(runId)}/episodes/${encodeURIComponent(episode.id)}`;
      const result = await request(path, episodeResponseSchema, requestOptions, episode);
      requireIdentity(result.episode.id === episode.id && result.episode.runId === runId);
      return result.episode;
    },
    async listRuns(requestOptions) {
      const result = await request("/runs", runListSchema, requestOptions);
      return result.runs;
    },
    async getRun(runId, requestOptions) {
      const result = await request(runPath(runId), runDetailSchema, requestOptions);
      requireIdentity(result.run.id === runId);
      try {
        return { run: result.run, episodes: validateRunEpisodes(result.run, result.episodes) };
      } catch {
        throw new UniverseApiError(200, "INVALID_RESPONSE");
      }
    },
    async getEpisode(runId, episodeId, requestOptions) {
      const path = `${runPath(runId)}/episodes/${encodeURIComponent(idSchema.parse(episodeId))}`;
      const result = await request(path, episodeResponseSchema, requestOptions);
      requireIdentity(result.episode.id === episodeId && result.episode.runId === runId);
      return result.episode;
    },
    async exportRun(runId, requestOptions) {
      const result = await request(`${runPath(runId)}/export`, runExportSchema, requestOptions);
      requireIdentity(result.run.id === runId);
      return result;
    },
  };
}
