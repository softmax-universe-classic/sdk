import { execFileSync } from "node:child_process";
import { readFile, readdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
execFileSync("tenet", ["validate", "--root", root], { stdio: "inherit" });
const names = new Set();
let count = 0;

for (const scope of [".contracts", "integrations/mechane/.contracts"]) {
  const contractsDirectory = path.join(root, scope);
  const index = await readFile(path.join(contractsDirectory, "index.md"), "utf8");
  for (const entry of await readdir(contractsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const relative = `${entry.name}/CONTRACT.md`;
    const source = await readFile(path.join(contractsDirectory, relative), "utf8");
    const metadata = /^---\nname: ([a-z][a-z0-9-]+)\nmessage: ([^\n]+)\n(?:[^\n]+\n)*?---\n/.exec(
      source,
    );
    if (!metadata || !metadata[1] || !metadata[2])
      throw new Error(`${relative}: expected name/message frontmatter`);
    if (names.has(metadata[1])) throw new Error(`${relative}: duplicate contract name`);
    names.add(metadata[1]);
    if (!source.includes("\n## Rules\n") || !source.includes("\n## Checks\n")) {
      throw new Error(`${relative}: expected Rules and Checks`);
    }
    if (!index.includes(`](${relative})`)) throw new Error(`${relative}: missing index entry`);
    if (/\/Users\/|\.codex\/|scott-softmax-factory/.test(source)) {
      throw new Error(`${relative}: product requirements must be self-contained`);
    }
    count += 1;
  }
}

for (const document of ["AGENTS.md", ".context/index.md", ".contracts/index.md"]) {
  const source = await readFile(path.join(root, document), "utf8");
  for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (!target || target.includes("://") || target.startsWith("#")) continue;
    const pathname = target.split("#")[0];
    await access(path.resolve(root, path.dirname(document), pathname));
  }
}

console.log(`Validated ${count} repository contracts and guidance links.`);
