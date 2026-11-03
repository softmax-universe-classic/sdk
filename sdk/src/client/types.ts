import type { Episode, Run } from "@softmax-universe/protocol";
import type { RunExport } from "@softmax-universe/protocol";

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
