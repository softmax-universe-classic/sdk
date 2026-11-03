export class MechanePolicyError extends Error {
  constructor(readonly code: string) {
    super(`Mechane policy failed (${code}).`);
    this.name = "MechanePolicyError";
  }
}
