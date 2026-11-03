export interface MechanePolicyOptions {
  endpoint: string;
  apiKey: string;
  workspaceId: string;
  model: string;
  pollIntervalMs?: number;
}
