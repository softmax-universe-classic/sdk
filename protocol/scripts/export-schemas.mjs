import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { episodeSchema, runSchema, runExportSchema } from "../dist/index.js";

const directory = new URL("../schemas/", import.meta.url);
await mkdir(directory, { recursive: true });
for (const [name, schema] of [
  ["run", runSchema],
  ["episode", episodeSchema],
  ["run-export", runExportSchema],
]) {
  const document = z.toJSONSchema(schema, { target: "draft-2020-12" });
  document.$id = `urn:softmax-universe:schema:${name}:2`;
  document.description =
    "Universe schema version 2. Use the protocol validators for participant membership, decision ordering, timestamps, and run consistency.";
  await writeFile(
    new URL(`${name}.schema.json`, directory),
    `${JSON.stringify(document, null, 2)}\n`,
  );
}
