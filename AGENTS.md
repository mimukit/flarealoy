# AGENTS.md

## What this project is

Flarealoy manages and monitors Cloudflare accounts through one `flarealoy` command with modules. The `security` module keeps a set of Cloudflare zones on one security baseline: it applies the baseline to each zone, checks every zone for drift on a schedule, sends drift alerts, and shows all zones on one screen. It targets the Cloudflare Free plan. A `usage` module for plan limit alerts comes from its own plan. The service runs as `flarealoy run` in one Docker container on the owner's server, deployed with Dokploy.

The current plan is `docs/plans/0004-plan-flarealoy-migration-2026-11-25.md`. Its Design decisions table is the source of truth for the platform layout, the store, the tokens and the deploy; it supersedes rows of plans 0001 and 0003, which still hold the security module decisions. Read them before you change the stack or the architecture.

## Stack

- TypeScript on Node 22.13 or later (for `node:sqlite`), published to npm as `flarealoy`. The old `flarewall` npm name is a deprecated placeholder in `npm/flarewall-placeholder/`.
- The official `cloudflare` SDK, pinned to an exact 7.x version. Security Events use one raw `fetch` to the GraphQL endpoint.
- Zod 4 for the baseline and inventory schemas.
- Vitest for tests, with snapshot tests for the `render` step.
- Ink 8 for the TUI. Only the `security tui` command loads it.
- Docker and Dokploy for the server: `Dockerfile` and `compose.example.yaml`.

## Build and test

- Install: `pnpm install`
- Typecheck: `pnpm typecheck`
- Test: `pnpm test` (update render snapshots with `pnpm test -u` only after you check the change)
- Build: `pnpm build` (compiles `src/` to `dist/` and copies `src/modules/security/baseline/default.yaml` to `dist/modules/security/baseline/`)
- Private string check: `FLAREALOY_PRIVATE_STRINGS='<one string per line>' pnpm check:private`
- Package contents: `npm pack --dry-run`

## Rules for agents

- Never put private data in this repo: account IDs, zone IDs or names, client names, host roles, origin IPs, backups, or tokens. That data lives in one SQLite file outside every repo: on the server at `/data/flarealoy.sqlite` in the Docker volume, named by `FLAREALOY_DB`. A local `FLAREALOY_DB` file is for development and tests only. Plan 0003 replaced the old private data repo, and plan 0004 moved the file to the server. Never commit a database file or an export. Test fixtures use `example.com` hosts and RFC 5737 IP addresses.
- Never write a Cloudflare token to a file. The tool reads tokens from the environment only: `CLOUDFLARE_API_TOKEN` for reads (or the variable an account names in `token_env`), and `CLOUDFLARE_WRITE_TOKEN` for writes. The owner sets both on the server as Dokploy environment values.
- Never run `npm publish`, `npm deprecate` or any npm command that writes to the registry, and never add an `NPM_TOKEN`. The owner publishes by hand.
- Never run `flarealoy security apply` or `flarealoy security restore` with `--write` against a live zone. The owner runs writes.
- Keep the core free of logic in the TUI or the skill. Both call the core.
- Keep `src/core/` and every `src/modules/*/core/` folder free of Node-only APIs, so a Worker can run them later. `test/core/purity.test.ts` checks this.
- Every rule Flarealoy creates carries a `ref` that starts with `flarewall_`, kept from before the rename so live rules stay owned. Never delete or rewrite a rule without that prefix.

## Docs artifact naming

- An artifact under `docs/<type>/` (a plan, a QA plan, a review, research) is named `NNNN-<type>-<slug>-YYYY-MM-DD.md`.
- `NNNN` is a four-digit serial, per directory, assigned in creation order and never reused. To get it, take the highest serial in that directory across this worktree, every other worktree that `git worktree list` names, and `origin/HEAD` (`git ls-tree --name-only origin/HEAD <dir>` after `git fetch origin`), and add one. Scan all three, because parallel worktrees otherwise take the same serial. Skip a source that fails, such as no remote, and without git list the directory only. An empty directory starts at `0001`.
- `YYYY-MM-DD` is the creation date. The whole name stays fixed after edits.
- An ADR uses its decision number as the serial: `docs/adr/NNNN-adr-<slug>-YYYY-MM-DD.md`.
- Reader-facing pages (`docs/wiki/`, how-to guides, runbooks) stay unnumbered.
