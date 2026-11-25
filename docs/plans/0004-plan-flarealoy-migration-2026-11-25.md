# Plan: migrate flarewall into Flarealoy
Grilled: 2026-11-25

## Context

Flarealoy is one Cloudflare management and monitoring project with modules. flarewall becomes its `security` module, and a new `usage` module alerts before a Cloudflare account reaches a plan limit. The trigger: on 2026-11-24 the free plan Hyperdrive limit (100,000 queries per day) blocked a production service of the owner, and nothing alerted the owner. The settled product decisions are in the ideas repo: `topics/flarealoy/IDEA.md` and the `NOTES.md` entry "2026-11-25 · Platform shape, modules, stack". The grill on 2026-11-25 changed one of them: the server container holds the write token too (see Design decisions, Tokens on the server).

This plan covers the migration only: the move of the code, the command mapping, the data migration, the repo rename, the npm plan, the split between `src/core` and the security module, the deploy, and the issue order. The usage module gets its own plan after the GraphQL spike.

- Concept: rename this repo to `flarealoy`, move the flarewall code into `src/modules/security`, and build a shared `src/core` that the `usage` module can use.
- Problem: the restructure must not delay the usage alerts, and it must not change how the security module behaves.
- User: the owner. The owner works from 4 machines on the tailnet and runs the Flarealoy service in Docker with Dokploy.
- Goal behind the request: get usage alerts running for the owner's Cloudflare accounts soon, on a base that security drift alerts can share.
- Target: the move keeps all 225 current tests green (16 test files, `pnpm test` on `main` at 37772c7, 2026-11-25), the render snapshot file stays byte-identical, and a new CLI transcript snapshot stays byte-identical across the move. The usage module can start its build after Phase 5, which is 4 build phases after the rename.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Source of the platform decisions | `ideas/topics/flarealoy/IDEA.md` and `NOTES.md` (2026-11-25): one package, module folders, one binary, the order move, core and usage, then drift alerts. The grill changed one rule: the server holds the write token too. |
| Repo | Rename `mimukit/flarewall` to `mimukit/flarealoy` with `gh repo rename`. The git history, the issues, the PRs, the labels and the conventions stay. GitHub redirects the old URL. The local checkout moves from `/home/dev/projects/flarewall` to `/home/dev/projects/flarealoy`, and the T3 project follows it. |
| Tag before the move | Tag the last flarewall commit `flarewall-v0.1.0` before Phase 2. The owner can build the old binary from this tag. It is the code rollback for every later phase and the tool for the data export. |
| Folder layout | `src/core/` (platform, no Node-only API), `src/node/` (platform Node adapters), `src/cli/` (the `flarealoy` dispatcher), `src/modules/security/{core,node,cli,tui,baseline}/`, `src/modules/usage/`. The security module keeps its current inner layout, so each file moves as one rename. Tests move to `test/security/`, and new tests go to `test/core/` and `test/usage/`. |
| Pure move | Phase 2 is `git mv` plus import path edits only. No logic, message or test assertion changes. Proof: the 225 tests pass; `git diff -M50%` shows every source file as a rename; no changed line other than `import` and `from` lines; the render snapshot is byte-identical; a CLI transcript snapshot added in Phase 2 before the move is byte-identical after it. The threshold is 50%, because small files such as `main.ts` (11 lines) fall under 90% from import edits alone. (Grill default, Q5.) |
| CLI transcript test | A new vitest snapshot test (`test/security/cli-transcript.test.ts`) runs every security command through `run()` with the fake API and an in-memory store, and snapshots stdout, stderr and the exit code. It goes in before the first `git mv`. It is the behavior lock for Phases 2 and 3. Same runner as today: vitest. |
| Command mapping | Every `flarewall <cmd>` becomes `flarealoy security <cmd>` with the same arguments, options, output and exit codes: `init`, `add`, `status`, `diff`, `apply`, `restore`, `backups`, `tui`, `edit`, `propose`, `log`, `show`, `revert`, `approve`, `reject`. `export` and `import` dump every table of every module, so they move to `flarealoy export` and `flarealoy import` in Phase 4. Top-level commands: `flarealoy init`, `run`, `test-alert`, `account ...`, `export`, `import`, and each module name. |
| Message text | Messages that name a command change only by that name: `run flarewall init` becomes `run flarealoy security init`. Phase 3 checks this with the transcript snapshot: its diff holds only `flarewall` to `flarealoy` and `flarealoy security` substitutions. |
| `flarewall` alias | No alias binary. Reason: `npm view flarewall` returned 404 on 2026-11-25, so no outside user installed it; the agent skill is not built (issue #4 is `blocked`); the owner is the only user. |
| npm, `flarealoy` | The first `flarealoy` release is `0.1.0`, because nothing was ever published (Q9). The owner runs `npm publish` by hand, as plan 0001 says. No agent and no CI job publishes, and the repo holds no `NPM_TOKEN`. |
| npm, `flarewall` | The owner holds the name: one placeholder `flarewall@0.0.1` with only a README that points to `flarealoy`, then `npm deprecate flarewall "renamed to flarealoy"`. The placeholder has no `bin` and no code. Owner pick, 2026-11-25 (Q4). |
| Rule ref prefix | Every rule keeps the `flarewall_` ref prefix. A new prefix makes `diff` see every live rule as unowned and needs new adoption logic. (Q10.) |
| Where the data lives | One SQLite file on the host that Dokploy deploys to, in the container volume at `/data/flarealoy.sqlite`. The owner runs every command on the server over SSH. Owner pick, 2026-11-25 (Q1). A local `FLAREALOY_DB` is for development and tests only, and the README says so (Q20). Rejected: a central Postgres (a new adapter, a second SQL dialect, and an extra server), a central libSQL server (less proven to run yourself), a split store with a sync command (two stores that disagree), D1 (a blocked Cloudflare account then blocks its own alert store), and a Flarealoy HTTP API (a server product to solve a database problem). |
| Remote use | The README gives a shell function: `flarealoy() { ssh -t <host> docker exec -it -e EDITOR "$(docker ps -qf label=com.docker.compose.service=flarealoy)" flarealoy "$@"; }`, with the `docker ps` part run on the host. It finds the container by its compose service label, because Dokploy sets the compose project name. No remote mode in code. (Q17.) |
| Editor in the container | The image includes `vi`, and the shell function passes `EDITOR`, so `security edit` works over SSH. (Q19.) |
| Concurrency | The service and each `docker exec` share one file in one container. The journal mode stays `DELETE`, with the 5 second busy timeout. The service writes once every 15 minutes, so lock waits are short. (Q22.) |
| Database file | `FLAREALOY_DB` names the file. The default is `$XDG_DATA_HOME/flarealoy/flarealoy.sqlite`, else `~/.local/share/flarealoy/flarealoy.sqlite`. The image sets `FLAREALOY_DB=/data/flarealoy.sqlite`. File safety from plan 0003 stays: mode `0600` in a `0700` directory, journal mode `DELETE`, a 5 second busy timeout. |
| Old variable | When `FLAREWALL_DB` is set, every command stops with `FLAREWALL_DB is gone; flarealoy reads FLAREALOY_DB. To move old data: flarewall export <file>, then flarealoy import <file>`. This repeats the plan 0003 pattern for `--data`. |
| Data migration path | `flarewall export` from the `flarewall-v0.1.0` build on the machine that holds the old file, then `flarealoy import -` on the server over SSH. There is no `init --from-flarewall`. (Q18.) |
| Store split | `src/core` owns the open, the file safety, the `meta` table, a migration runner with one migration list per module, and `export` and `import` over every registered table. Each module registers its own migrations and its own tables. |
| Schema versions | The `meta` table holds one key per module: `schema_version.core`, `schema_version.security`, `schema_version.usage`. A core migration moves an old `schema_version` key to `schema_version.security`, in one transaction. A newer version for any module stops the command, as today. |
| Table names | The four shipped security tables keep their names: `revisions`, `backups`, `runs`, `run_zones`. Plan 0003 forbids edits to a shipped migration, and a rename adds risk to the append-only triggers for no user gain. New tables carry a prefix: `core_*`, `usage_*`. |
| Export format | The export carries the version for each module. `flarealoy import` reads a file path or `-` for stdin. It also accepts a flarewall export (one `schema_version`, four tables) and loads it as the security module at that version. The byte-identical round trip from plan 0003 holds for a flarealoy export. |
| Core inventory, version 1 | Accounts only: `core_accounts` with the Cloudflare account ID, a label, the plan (`free` or `paid`), optional limit overrides as JSON, and `token_env` (nullable). `flarealoy account add|list|set|remove` edits it. The usage module needs accounts and does not need zones. |
| Token for each account | One read token covers every account by default. `core_accounts.token_env` names another variable for an account that the main token cannot see; null means `CLOUDFLARE_API_TOKEN`. Owner pick, 2026-11-25 (Q2). |
| Zones in core | Phase 10 adds `core_zones` (zone ID, name, account ID). `security add` writes the core zone row and the inventory revision. A migration fills it from the current inventory revisions with an empty account ID, and the drift job fills empty account IDs from `listZones()`. `status` still records nothing, as plan 0003 says. (Q6.) The security inventory YAML keeps `zone_id`, so the security schema does not change. |
| Tokens and capability | Read commands use `CLOUDFLARE_API_TOKEN`, and use `CLOUDFLARE_WRITE_TOKEN` when only that one is set (Q7). Write commands (`security apply --write`, `security restore --write`) need `CLOUDFLARE_WRITE_TOKEN` and refuse without it: `security apply --write needs CLOUDFLARE_WRITE_TOKEN`. The capability is the variable name only, with no read-only flag. Owner pick, 2026-11-25 (Q3). The TUI opens on the read token, and its write keys show `needs CLOUDFLARE_WRITE_TOKEN` when the variable is not set (Q8). The tool never writes a token to a file. |
| Tokens on the server | One container holds both tokens as env values set in Dokploy. Owner pick, 2026-11-25 (Q15). This replaces the IDEA.md rule "the server holds only read tokens". Dokploy stores env values and writes them to a `.env` file on the host. The AGENTS.md rule "never write a token to a file" covers the tool, not the owner's deploy. |
| Notifier | A `Notifier` port in `src/core/notifier.ts` (send one message with a title, a body, a severity and a dedupe key) and a `core_alerts` table for sent keys. Node adapters live in `src/node/`. The first adapter follows the channel pick, which is out of scope for this plan. |
| Scheduler | A pure job model in `src/core/scheduler.ts` (a job has a name, an interval and a run function) and a Node loop in `src/node/`. `flarealoy run` starts the loop with the jobs every module registers, and stores the last run time of each job in `core_job_runs`. |
| Drift job interval | Once every 24 hours, set by `FLAREALOY_SECURITY_DIFF_INTERVAL`. This supersedes the plan 0003 row "Drift history: manual". (Q14.) |
| Service | `flarealoy run` runs from one Docker Compose file that Dokploy deploys. The repo ships a `Dockerfile` (Node 22.13 or later, non-root user, `vi`) and `compose.example.yaml` with `/data` on a named volume. Dokploy builds from the repo; no image registry. (Q13.) |
| File backups | Manual, by the owner, with Dokploy volume backups. The tool does not copy the file. Owner pick, 2026-11-25 (Q16). |
| Core purity | `test/core-purity.test.ts` moves to `test/core/purity.test.ts` and checks `src/core/` and every `src/modules/*/core/` folder. |
| Tests | Vitest, as today. The core store tests run on an in-memory `node:sqlite` database. The data migration tests build a flarewall version 1 file from the shipped `MIGRATIONS[0]` SQL and a flarewall export fixture. The scheduler tests use a fake clock. No new test runner. |
| Private strings | `scripts/check-private-strings.mjs` reads `FLAREALOY_PRIVATE_STRINGS`. CI maps the existing secret: `FLAREALOY_PRIVATE_STRINGS: ${{ secrets.FLAREWALL_PRIVATE_STRINGS }}`, so the owner does not set a new secret. |
| Existing issues | #2 (manual drift run) and #4 (skill) keep their scope. #5 (retire the old script) is unaffected. #8 is still open although PR #9 merged; issuekit `sync` closes it, outside this plan. |
| Outward actions | The build agent may edit the bodies of issues #2 and #4 in Phase 11: text and plan link only, labels unchanged. Owner pick, 2026-11-25 (Q23). The owner runs the tag push, the repo rename, the folder move, the Dokploy deploy and every `npm publish` and `npm deprecate`. (Q24.) |
| Docs | Plan 0001 rows `Name`, `Distribution and license` and `Secrets`, and plan 0003 rows `Drift history` and `File location`, get "Superseded by plan 0004" notes. `AGENTS.md`, `README.md` and the `.gitignore` comments name Flarealoy. The AGENTS.md token rule names both variables. |

## Approach

Move first, then extract. Phase 2 moves the whole flarewall tree into `src/modules/security` with no edit except import paths, so the behavior lock holds by construction. Phase 3 renames the binary and adds the dispatcher. Phases 4 and 5 lift the generic parts of the security module into `src/core`: the SQLite mechanics, the accounts and the token capability. At that point the usage module has everything it needs for `flarealoy usage check`, and its build starts in parallel with the notifier and the scheduler.

What this reuses:

- `src/node/sqlite-store.ts` already holds the file safety, the busy timeout, the `meta` table and a migration runner. Phase 4 splits it into a core part and a security part. It does not rewrite it.
- `src/core/store-sql.ts` already keeps all SQL in one module with a `MIGRATIONS` list. Each module gets the same shape.
- `src/cli/run.ts` already takes `RunDeps` (API factory, store, clock), so the dispatcher passes them through and the security tests keep their fakes.
- `test/fake-api.ts` and `test/helpers.ts` (`memoryStore`, `putBaseline`) carry over to `test/security/`.
- `src/node/warnings.ts` (`quietSqliteWarning`) moves to the platform `src/node/`, because every module opens the store.
- The plan 0003 export and import are the data migration path, as plan 0003 intended.

What stays in the security module: `api.ts`, `apply.ts`, `diff.ts`, `legacy.ts`, `render.ts`, `revisions.ts`, `schema.ts`, `status.ts`, the security part of `store.ts` and `store-sql.ts`, `sdk-client.ts`, `edit.ts`, `default-baseline.ts`, `baseline/default.yaml`, `cli/run.ts`, `cli/format.ts` and all of `tui/`. The `cloudflare` SDK, Ink and React stay security dependencies; only the `security tui` path loads Ink.

What becomes `src/core` and `src/node`: the store open and file safety, the `meta` table, the migration runner, `export` and `import`, `StoreError`, the accounts table, the token capability check, the notifier port, the scheduler, and the SQLite warning filter.

Rejected alternatives:

- Rename the security tables to `security_*`. It needs a migration on append-only tables with triggers, and it gives the owner nothing.
- Extract core before the move. It mixes logic changes with the move, so the tests can no longer prove that behavior did not change.
- A `flarewall` alias binary for a time. No outside user exists, so it is code to remove later with no reader.
- A read-only flag in the image, or two containers that split the tokens. The owner picked one container with both tokens (Q3, Q15).

Issue order (one issue per phase; the usage issues come from the usage plan):

1. Phase 1, rename (attended). No dependency.
2. Phase 2, pure move. After Phase 1.
3. Phase 3, binary and dispatcher. After Phase 2.
4. Phase 4, core store and data migration. After Phase 3.
5. Phase 5, accounts and token capability. After Phase 4. **The usage build starts here**: `usage check` needs the store, the accounts and the read token.
6. Phase 6, notifier and `test-alert`. After Phase 4. It runs in parallel with Phase 5 and the usage build.
7. Phase 7, scheduler, `flarealoy run` and Docker. After Phase 4. It runs in parallel with Phases 5 and 6.
8. Phase 8, deploy with Dokploy (attended). After Phases 5, 6 and 7.
9. Phase 9, data migration on the server (attended). After Phase 8.
10. Phase 10, security drift to the shared alerts. After Phases 5, 6 and 7.
11. Phase 11, docs and the npm releases (attended). After Phase 10, or after the first usage release, whichever comes first.

The GraphQL spike and the usage pure logic (the limits table, the threshold and projection math, the query builder) need only the `src/modules/usage/` folder. They can start after Phase 2.

### Phase 1: rename the repo
Attended: the owner pushes the tag, runs the GitHub rename and moves the local folder.
- Tag the newest `main` commit as `flarewall-v0.1.0` and push the tag.
- Rename the repo with `gh repo rename flarealoy`.
- Set the local remote to the new URL with `git remote set-url origin`.
- Move `/home/dev/projects/flarewall` to `/home/dev/projects/flarealoy` and update the T3 project root.
Done when: `gh repo view --json nameWithOwner` prints `mimukit/flarealoy`, `git ls-remote --tags origin flarewall-v0.1.0` prints one line, and the old URL `https://github.com/mimukit/flarewall` redirects to the new one.

### Phase 2: move flarewall into the security module
- Add `test/cli-transcript.test.ts`: every command in the security usage text, run through `run()` with the fake API and an in-memory store, with a snapshot of stdout, stderr and the exit code. Include the error paths: no token, no database, `--data` set, a bad revision id. Commit it on its own before the move.
- `git mv` `src/core/*`, `src/node/*`, `src/cli/*`, `src/tui/*` and `src/baseline/*` to `src/modules/security/{core,node,cli,tui,baseline}/`.
- `git mv` `test/*` to `test/security/`, with `__snapshots__`.
- Edit import paths only. Update `scripts/copy-baseline.mjs` to the new source path and `dist/modules/security/baseline/`. Point `package.json` `bin.flarewall` at `dist/modules/security/cli/main.js`.
- Update the core purity test to scan `src/modules/security/core/`.
Done when: `pnpm typecheck` passes; `pnpm test` reports at least 226 tests passed (225 plus the transcript); `git diff -M50% --name-status flarewall-v0.1.0 -- src` shows only `R` lines; `git diff -M50% flarewall-v0.1.0 -- src | grep '^[+-][^+-]' | grep -vE '^[+-]\s*(import|\} from|from )'` prints nothing; the old and new render snapshot files are byte-identical; the transcript snapshot file did not change in the move commit; `pnpm build && node dist/modules/security/cli/main.js --help` prints the old usage text.

### Phase 3: the `flarealoy` binary and the dispatcher
- Rename the package to `flarealoy` (version `0.1.0`), set the description, and set `bin` to `{ "flarealoy": "dist/cli/main.js" }`.
- Add `src/cli/main.ts` and `src/cli/run.ts`: top-level help, `security <cmd>` passes the rest of argv and `RunDeps` to the security `run()`, and an unknown module or command exits 2 with the usage text.
- Change the security usage text and messages from `flarewall <cmd>` to `flarealoy security <cmd>`.
- Read `FLAREALOY_DB` with the new default path. Stop with the old-variable message when `FLAREWALL_DB` is set.
- Add dispatcher tests in `test/core/cli.test.ts`.
Done when: `pnpm test` passes; the transcript snapshot diff in the Phase 3 commit shows only `flarewall` to `flarealoy` and `flarealoy security` substitutions plus the path in the database messages; `node dist/cli/main.js security status` with no database prints `no flarealoy database at <path>; run flarealoy security init` and exits 2; `FLAREWALL_DB=x node dist/cli/main.js security status` prints the old-variable message and exits 2.

### Phase 4: core store and the data migration
- Move the open, the file safety, the `meta` table, the migration runner, `export`, `import` and `StoreError` from the security store to `src/core/store.ts`, `src/core/store-sql.ts` and `src/node/sqlite-store.ts`.
- Add module registration: each module gives its name, its migration list and its export tables. Security registers its shipped `MIGRATIONS` unchanged.
- Add the core migration that moves `schema_version` to `schema_version.security`.
- Add `flarealoy init` (creates the file and runs every module migration). `flarealoy security init` keeps its job: it writes the default baseline as revision 1, and creates the file when it is missing (Q12).
- Move `export` and `import` to the top level. `flarealoy security export` and `flarealoy security import` stop with `moved: run flarealoy export`. `import` reads a path or `-` for stdin, and accepts a flarewall export.
Done when: `pnpm test` passes and the transcript snapshot changes only on the `export` and `import` lines; a test opens a flarewall version 1 file with rows in all four tables and checks that every row, id and timestamp is equal after the migration and that the key is now `schema_version.security`; a test pipes a flarewall export fixture into `import -`, exports again and gets the same rows; a newer `schema_version.security` stops the command with the upgrade message.

### Phase 5: accounts and token capability
- Add the `core_accounts` migration (with `token_env`) and `flarealoy account add <account-id> --label <text> --plan free|paid [--token-env <NAME>]`, `account list`, `account set`, `account remove`. Limit overrides are a JSON column; the usage plan defines their shape.
- Add `src/core/tokens.ts`: the read token for an account (its `token_env`, else `CLOUDFLARE_API_TOKEN`, else `CLOUDFLARE_WRITE_TOKEN`), the write token from `CLOUDFLARE_WRITE_TOKEN`, and a `requireWrite(command)` check.
- Gate `security apply --write`, `security restore --write` and the TUI write keys on the write token. Dry runs, `status`, `diff` and `add` use the read token.
Done when: `pnpm test` passes; `CLOUDFLARE_API_TOKEN=t flarealoy security apply example.com --write` against the fake API exits 2 with the write-token message and the fake records zero writes; the same command with `CLOUDFLARE_WRITE_TOKEN` set runs the write path; with only `CLOUDFLARE_WRITE_TOKEN` set, `security status` runs; `flarealoy account add` then `account list` prints the account with its plan and token variable.

### Phase 6: notifier and `test-alert`
- Add the `Notifier` port in `src/core/notifier.ts` with a dedupe key, and the `core_alerts` table that records each sent key.
- Add the Node adapter for the channel the usage plan picks, configured from environment variables only.
- Add `flarealoy test-alert`.
Done when: `pnpm test` passes with a fake notifier that records messages; a second send with the same dedupe key sends nothing; `flarealoy test-alert` with the fake notifier records one message.

### Phase 7: scheduler, `flarealoy run` and Docker
- Add the job model in `src/core/scheduler.ts`, the Node loop in `src/node/`, and `core_job_runs`.
- Add `flarealoy run`: it opens the store, registers each module's jobs, runs each job on its interval, and logs one line for each run. It stops cleanly on SIGTERM.
- Add a `Dockerfile` (Node 22.13 or later, non-root user, `vi`, `FLAREALOY_DB=/data/flarealoy.sqlite`) and `compose.example.yaml` with one `flarealoy` service and a named `/data` volume.
- Add `.dockerignore` with `*.sqlite` and `.env*`.
Done when: `pnpm test` passes with a fake clock that drives two jobs on different intervals; `docker build .` succeeds; `docker run` of the image with a test job logs one run line and exits 0 on SIGTERM; `docker run --rm <image> sh -c 'command -v vi'` prints a path.

### Phase 8: deploy with Dokploy
Attended: the owner deploys with Dokploy on the host of their choice and sets the tokens and the alert channel variables.
- Create the Dokploy compose app from the repo, with the `/data` volume and a Dokploy volume backup.
- Set `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_WRITE_TOKEN` and the notifier variables in Dokploy.
- Add the README shell function on each work machine.
Done when: `flarealoy init` through the shell function creates `/data/flarealoy.sqlite`; `flarealoy test-alert` through the shell function delivers one message on the picked channel; the Dokploy logs show one `flarealoy run` line for each job run.

### Phase 9: move the owner's data to the server
Attended: the owner runs the export on the machine that holds the old flarewall file.
- Build `flarewall-v0.1.0` and run `flarewall export old.json` on the machine that holds the old file.
- Run `ssh <host> docker exec -i <container> flarealoy import - < old.json`.
- Skip this phase when no old flarewall file exists.
Done when: `flarealoy security log` through the shell function lists the same revision ids as `flarewall log` on the old machine, and `flarealoy security backups <zone>` lists the same backup ids for one zone.

### Phase 10: security drift to the shared alerts
- Add `core_zones` and write it from `flarealoy security add`. A migration fills it from the current inventory revisions with an empty account ID.
- Register a `security.diff` job on the `FLAREALOY_SECURITY_DIFF_INTERVAL` interval (default 24 hours). It runs `diff` for every inventory zone with the read token, records the run as `flarealoy security diff` does, and fills empty account IDs in `core_zones` from `listZones()`.
- The job sends one alert when a zone enters drift, legacy or error, and one when the zone is back in sync. The dedupe key is the zone and the state.
Done when: `pnpm test` passes; with the fake API, a test edits a fake zone rule, runs the job twice, and the fake notifier holds exactly one drift message; a third run after the fix holds one in-sync message; a run with a failing API sends one error message and no drift message; after one job run, no `core_zones` row has an empty account ID.

### Phase 11: docs and the npm releases
Attended: the owner runs `npm publish` for `flarealoy` and the `flarewall` placeholder, and runs `npm deprecate`.
- Rewrite `README.md` for Flarealoy: install, the server setup, the shell function, the data migration, the command table, the token variables.
- Update `AGENTS.md` (project description, token rule, `FLAREALOY_DB`, the server store), the `.gitignore` comments, and the plan 0001 and plan 0003 superseded notes.
- Edit the bodies of issues #2 and #4 to the new command names (text and plan link only, labels unchanged).
- Add the placeholder in a folder outside `src/` (for example `npm/flarewall-placeholder/`), with a `package.json` (`flarewall`, `0.0.1`, no `bin`) and a README that points to `flarealoy`.
- The owner runs `pnpm build`, `npm pack --dry-run` and `npm publish`, then publishes the placeholder and runs `npm deprecate flarewall "renamed to flarealoy"`.
Done when: `grep -rn 'flarewall' README.md AGENTS.md src` prints only the old-variable message, the migration steps and the `flarewall_` ref prefix; `npm pack --dry-run` lists only `dist/`, `LICENSE`, `README.md` and `package.json`; `npm view flarealoy version` prints `0.1.0`; `npm view flarewall deprecated` prints `renamed to flarealoy`.

## Migration and rollback

The owner's flarewall data moves in Phase 9. Its schema is version 1 of plan 0003: `meta`, `revisions`, `backups`, `runs`, `run_zones`.

1. On the machine that holds the old file, the owner builds `flarewall-v0.1.0` and runs `flarewall export old.json`. This reads the old file and never writes it.
2. The owner pipes the file into `flarealoy import -` on the server. Import loads into an empty database only. It loads the export as the security module at version 1, then runs the core migration (the key moves to `schema_version.security`) and the core and usage table migrations, each in one transaction.
3. The security tables keep their names and rows. Ids and timestamps do not change, so revision ids in the owner's notes stay valid.
4. Phase 5 added `core_accounts` (empty). The owner adds accounts with `flarealoy account add`.
5. Phase 10 adds `core_zones` and fills it from the current inventory revisions. The drift job fills the account IDs.

Rollback: the old file is never written. To go back, the owner removes `/data/flarealoy.sqlite` on the server and runs `flarewall-v0.1.0` from the tag on the old machine. A failed import leaves a database that is not empty; the owner removes the file and runs `flarealoy init` and the import again. A Dokploy volume backup taken before Phase 10 covers the later migrations.

## Open questions

- Deferred to issue #4: the name of the agent skill (Q11), and how the skill reaches the server. An SSH key for the skill can also run `approve`, so it may need a forced-command key (Q21).

## Non-goals

- The usage module features, the limits table, the GraphQL spike, the alert channel pick and the uptime tool. The usage plan and the ideas repo own them.
- Any change to security behavior beyond the command prefix, the database variable, the move of `export` and `import`, and the write-token gate.
- A rename of the security tables or a change to the baseline or inventory YAML schema.
- A monorepo, a second npm package with code, a web app, a dashboard or Saasaloy.
- A Postgres or libSQL store, or a remote mode in code.
- Automatic backups of the server file. Dokploy covers them.
- A D1 adapter or a Worker deploy.
