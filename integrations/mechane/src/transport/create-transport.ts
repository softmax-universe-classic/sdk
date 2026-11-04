import { call as callMechane, Bytes } from "@mechane/client";
import { catalog, type OperationInput } from "@mechane/client/protocol";
import { Duration, Effect, Option, Redacted, Schema } from "effect";
import { MechanePolicyError } from "./errors.js";
import { type RuntimeOperation, type OperationAnswer } from "./types.js";

export function createTransport(options: { endpoint: string; apiKey: string }) {
  let origin: URL;
  try {
    origin = new URL(options.endpoint);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    if (
      (origin.protocol !== "https:" && !(origin.protocol === "http:" && local)) ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/" ||
      !options.apiKey ||
      /[\r\n]/.test(options.apiKey) ||
      origin.href.includes(options.apiKey)
    )
      throw new Error();
  } catch {
    throw new MechanePolicyError("invalid_configuration");
  }
  const credential = Redacted.make(options.apiKey);
  const maxResponseBytes = Option.some(Schema.decodeUnknownSync(Bytes)(4_194_304));

  return {
    origin: origin.origin,
    async call<N extends RuntimeOperation>(
      name: N,
      parameters: Record<string, string>,
      signal: AbortSignal,
      body: unknown = {},
    ): Promise<OperationAnswer<N>> {
      signal.throwIfAborted();
      const encoded = JSON.stringify(body);
      if (encoded.length > 200_000 || encoded.includes(options.apiKey))
        throw new MechanePolicyError("invalid_request");
      try {
        const operation = catalog[name];
        const input = {
          ...Schema.decodeUnknownSync(operation.params)(parameters),
          ...Schema.decodeUnknownSync(operation.query)({}),
          ...Schema.decodeUnknownSync(operation.body)(body),
        } as OperationInput<(typeof catalog)[N]>;
        const result = await Effect.runPromise(
          callMechane({
            origin,
            name,
            input,
            credential,
            maxResponseBytes,
            timeout: Duration.seconds(15),
            userAgent: "softmax-universe/0.3.0-alpha.3",
          }),
          { signal },
        );
        const answer = JSON.stringify(Schema.encodeSync(operation.output)(result));
        if (answer.length > 4_194_304) throw new MechanePolicyError("response_too_large");
        return JSON.parse(answer.replaceAll(options.apiKey, "[redacted]")) as OperationAnswer<N>;
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof MechanePolicyError) throw error;
        throw new MechanePolicyError("runtime_call_failed");
      }
    },
  };
}
