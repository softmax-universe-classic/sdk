export interface TransferOptions {
  endpoint: string;
  projectId: string;
  token: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}
