# Working on the public SDK

Read [.contracts/index.md](.contracts/index.md), then the owning package README.
Use the pinned Mise tools. Run `pnpm install --frozen-lockfile`, `pnpm architecture:setup`, and `pnpm check`.
Keep schemas and examples synchronized. The SDK is browser-safe; the runner owns Node effects.
Preserve game authority, truthful recordings, bounded execution, and independent package builds.
This is an exported source bundle; send changes to its canonical Universe Factory source.
