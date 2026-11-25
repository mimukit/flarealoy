# QA Plan: the scheduler, `flarealoy run` and the Docker image

_Generated 2026-11-25 · against `b349565` (clean) · covers issue #14, plan 0004 Phase 7_

## Summary
- `flarealoy run` runs every registered job on its interval, logs one line for each run, and stops on SIGTERM. The Docker image runs this service.
- Working means each job runs on time, its last run is in `core_job_runs`, and the container exits 0 on `docker stop`.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-14-add-the-scheduler-the-run-command-and-the-docker` at `b349565` or later.
- Docker on the machine. Node 22.13 or later and pnpm for the build check.
- No screenshots: the change has no screen.
- Do not pass a real Cloudflare token into the container for this plan. The heartbeat job needs no token.
- Do not run `docker compose config` in a shell that holds `CLOUDFLARE_API_TOKEN`. It prints the value of the variable.

Build the image once:

```sh
docker build -t flarealoy-qa .
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: The image, a new volume | `security edit` opens vi over `docker exec` | 🟡 Normal |
| TC-1.2 | 1: The image, a new volume | `docker stop` during a long wait stops the service at once | 🟢 Low |

## Scenario 1: The image, a new volume

**Setup.** Run once, for every case in this scenario.

1. Start the service on a new named volume.

```sh
docker run -d --name flarealoy-qa -v flarealoy-qa-data:/data flarealoy-qa
```

- [ ] Setup complete

### TC-1.1: `security edit` opens vi over `docker exec`  ·  🟡 Normal

**Goal.** The owner can edit the baseline in the container from a terminal, as plan 0004 (Q19) needs.

**Steps**

1. Write the default baseline as revision 1.

   ```sh
   docker exec -it flarealoy-qa flarealoy security init
   ```

   - [ ] The command prints that the baseline is revision 1.
2. Open the baseline in the editor.

   ```sh
   docker exec -it -e EDITOR=vi flarealoy-qa flarealoy security edit --baseline
   ```

   - [ ] vi opens with the baseline YAML, and the keys work in your terminal.
3. Quit vi with `:q` and no change.
   - [ ] The command says that nothing changed, and the terminal is usable.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: `docker stop` during a long wait stops the service at once  ·  🟢 Low

**Goal.** A service that waits for a 24 hour interval stops in less than one second on SIGTERM.

**Steps**

1. Stop the container and measure the time.

   ```sh
   time docker stop flarealoy-qa
   ```

   - [ ] The real time is less than 2 seconds.
2. Read the exit code.

   ```sh
   docker inspect -f '{{.State.ExitCode}}' flarealoy-qa
   ```

   - [ ] The exit code is `0`.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
docker rm -f flarealoy-qa && docker volume rm flarealoy-qa-data && docker rmi flarealoy-qa
```

## Automated verification (by AI agent)
_Checks the agent ran itself at `b349565`. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm typecheck
```

```sh
pnpm test
```

```sh
pnpm build && npm pack --dry-run
```

```sh
docker build -t flarealoy-afk14-check:local .
```

```sh
docker run --rm flarealoy-afk14-check:local sh -c 'command -v vi'
```

```sh
docker run --rm flarealoy-afk14-check:local sh -c 'id -un; id -u; node --version; echo "$FLAREALOY_DB"'
```

```sh
docker volume create flarealoy-afk14-data && docker run -d --name flarealoy-afk14-run -v flarealoy-afk14-data:/data flarealoy-afk14-check:local
```

```sh
docker stop -t 30 flarealoy-afk14-run && docker inspect -f '{{.State.ExitCode}}' flarealoy-afk14-run && docker logs flarealoy-afk14-run
```

The agent started the container a second time on the same volume, read `core_job_runs` with `docker exec`, and stopped it again. Then it removed the container, the volume and the image.

- ✅ C1 · `pnpm test` → 309 tests in 21 files pass. `test/core/scheduler.test.ts` › "drives two jobs on different intervals": a 10m job runs at minutes 0, 10, 20, 30, 40, 50 and 60, and a 25m job at 0, 25 and 50.
- ✅ C2 · `docker build .` → exit 0 (base `node:22-alpine`).
- ✅ C3 · the container logs `2026-11-25T14:44:00.324Z job core.heartbeat ok 0ms`, one run line. `docker stop` → `SIGTERM, stopping after the current job`, `stopped`, exit code `0`.
- ✅ C4 · `command -v vi` → `/usr/bin/vi`.
- ✅ C5 · `.dockerignore` lists `*.sqlite` and `.env*`.
- ✅ C6 · after the first run, `core_job_runs` holds `{"job":"core.heartbeat","started_at":"2026-11-25T14:44:00.324Z","status":"ok"}`. The second start on the same volume logs no job line, because the 1d interval did not end. The service test "after a restart, waits out the interval that the stored run started" covers the same rule.
- ✅ C7 · the image user is `node` (uid 1000), Node is `v22.23.5`, `FLAREALOY_DB` is `/data/flarealoy.sqlite`. On the volume, `/data` has mode `700` and the database file has mode `600`, both owned by `node`.
- ✅ C8 · `compose.example.yaml` has one `flarealoy` service with `build: .` and the named volume `flarealoy-data` at `/data`. Docker Compose parsed it with no error.
- ✅ C9 · `pnpm typecheck` exit 0, `pnpm test` exit 0, `pnpm build` exit 0, `npm pack --dry-run` exit 0. The package lists only `dist/`, `LICENSE`, `README.md` and `package.json`, not the Docker files.
- ✅ C10 · `test/core/purity.test.ts` scans `src/core/scheduler.ts` and `src/core/job-runs-sql.ts` and passes.
- ✅ the built binary outside Docker: `node dist/cli/main.js run` on a temporary file logs one heartbeat line, exits 0 on SIGTERM, and makes the file with mode `600`.

## Not covered / needs human judgment
- The vi session over `docker exec -it` needs a real terminal (TC-1.1).
- The Dokploy deploy, the tokens in Dokploy and the run lines in the Dokploy logs belong to issue #15 (plan 0004 Phase 8). The owner runs them.
- No module job exists yet. The `security.diff` job comes in plan 0004 Phase 10 (issue #16).

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
