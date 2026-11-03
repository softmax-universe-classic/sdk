import { execFileSync } from "node:child_process";

const contract = ".contracts/008-code-dependency-boundaries/assets";
for (const [command, args] of [
  [
    "uv",
    [
      "run",
      "--frozen",
      "--script",
      `${contract}/uv/check-package-boundaries.py`,
      "--root",
      ".",
      "--config",
      "package-boundaries.json",
      "--source-rules",
      ".config/source-rules.json",
    ],
  ],
  [
    "uv",
    [
      "run",
      "--script",
      ".contracts/012-code-folder-size/assets/uv/check-layout.py",
      "--root",
      ".",
      "--config",
      ".config/file-layout.json",
    ],
  ],
  [
    "ast-grep",
    [
      "scan",
      "--config",
      ".config/sgconfig.yml",
      "--no-ignore",
      "hidden",
      "--globs",
      "!.contracts/**",
      "--globs",
      "!**/node_modules/**",
      "--globs",
      "!**/dist/**",
      "--globs",
      "!.local/**",
    ],
  ],
])
  execFileSync(command, args, { stdio: "inherit" });
