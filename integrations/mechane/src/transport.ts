import { z } from "zod";

export class MechanePolicyError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus?: number,
  ) {
    super(httpStatus ? `Mechane returned HTTP ${httpStatus}.` : `Mechane policy failed (${code}).`);
    this.name = "MechanePolicyError";
  }
}

export function createTransport(options: {
  endpoint: string;
  apiKey: string;
  fetch?: typeof fetch;
}) {
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
  const request = options.fetch ?? fetch;

  return {
    origin: origin.origin,
    async send<T>(
      path: string,
      schema: z.ZodType<T>,
      signal: AbortSignal,
      body?: unknown,
    ): Promise<T> {
      signal.throwIfAborted();
      const encoded = body === undefined ? undefined : JSON.stringify(body);
      if (encoded && (encoded.length > 200_000 || encoded.includes(options.apiKey))) {
        throw new MechanePolicyError("invalid_request");
      }
      let response: Response;
      try {
        response = await request(new URL(path, origin), {
          method: body === undefined ? "GET" : "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: encoded,
          signal,
          redirect: "error",
        });
      } catch {
        signal.throwIfAborted();
        throw new MechanePolicyError("transport_failed");
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new MechanePolicyError("http_error", response.status);
      }
      if (!response.body) throw new MechanePolicyError("invalid_response");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 4_194_304) throw new MechanePolicyError("response_too_large");
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      try {
        const text = Buffer.concat(chunks)
          .toString("utf8")
          .replaceAll(options.apiKey, "[redacted]");
        return schema.parse(JSON.parse(text));
      } catch {
        throw new MechanePolicyError("invalid_response");
      }
    },
  };
}
