#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { RunnerError, safeError } from "./errors/index.js";
import { exportDataset, uploadDirectory } from "./transfer/index.js";

const help = `Usage:
  universe upload <directory> --endpoint <url> --project <id> --key-env <variable>
  universe dataset export <run-id> --out <file> --endpoint <url> --project <id> --key-env <variable>

The named environment variable supplies a project credential. Upload reads saved files only.
Export writes a new file and refuses to replace different content. No endpoint or project is implicit.
`;

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        endpoint: { type: "string" },
        project: { type: "string" },
        "key-env": { type: "string" },
        out: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch {
    throw new RunnerError("invalid_command");
  }
  if (parsed.values.help) {
    process.stdout.write(help);
    return;
  }
  const { endpoint, project, "key-env": keyEnv, out } = parsed.values;
  if (!endpoint || !project || !keyEnv || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyEnv)) {
    throw new RunnerError("invalid_command");
  }
  const token = process.env[keyEnv];
  if (!token) throw new RunnerError("invalid_command");
  const options = { endpoint, projectId: project, token };
  const [command, argument, runId] = parsed.positionals;
  if (command === "upload" && argument && parsed.positionals.length === 2 && !out) {
    const result = await uploadDirectory(resolve(argument), options);
    process.stdout.write(`Uploaded ${result.episodes} saved episode(s).\n`);
  } else if (
    command === "dataset" &&
    argument === "export" &&
    runId &&
    out &&
    parsed.positionals.length === 3
  ) {
    await exportDataset(runId, resolve(out), options);
    process.stdout.write("Dataset saved.\n");
  } else {
    throw new RunnerError("invalid_command");
  }
}

main().catch((error: unknown) => {
  const failure = safeError(error, "invalid_command");
  process.stderr.write(`${failure.code}: ${failure.message}\n`);
  process.exitCode = 1;
});
