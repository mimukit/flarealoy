# QA Plan: security drift to the shared alerts

_Generated 2026-11-25 · against `ed924bc` (clean) · covers issue #16, plan 0004 Phase 10, and the notifier, ntfy and scheduler fixes_

## Summary

- The `security.diff` job diffs every inventory zone on its interval, records the run, fills `core_zones`, and sends drift alerts.
- Working means one alert when a zone enters drift, legacy or error, and one alert when it is back in sync.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-16-send-security-drift-to-the-shared-alerts` at `ed924bc` or later.
- The deployed flarealoy service from Phase 8, with the ntfy variables and the read token set in Dokploy.
- A phone or a browser that subscribes to the ntfy topic.
- One test zone that you own and that has an inventory revision. Use a zone where a short drift does no harm.
- No screenshots: the change has no screen.
- Do not run `docker compose config` in a shell that holds `CLOUDFLARE_API_TOKEN`. It prints the value of the variable.

Set a short interval for this plan in Dokploy, then deploy again:

```sh
FLAREALOY_SECURITY_DIFF_INTERVAL=15m
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Deployed service, test zone in sync | A drift alert arrives on the phone and reads well | 🔴 Critical |
| TC-1.2 | 1: Deployed service, test zone in sync | A back-in-sync alert arrives after the fix | 🟡 Normal |

## Scenario 1: Deployed service, test zone in sync

**Setup.** Run once, for every case in this scenario.

1. Confirm that the test zone is in sync. Use the shell function from the README.

   ```sh
   flarealoy security diff example.com --no-record
   ```

   - [ ] The output shows the test zone as `in sync`.
2. Wait for one `security.diff` run in the Dokploy logs.
   - [ ] The log shows one `job security.diff ok` line.

- [ ] Setup complete

### TC-1.1: A drift alert arrives on the phone and reads well  ·  🔴 Critical

**Goal.** A real drift on a real zone reaches the owner once, through ntfy, with clear text.

**Steps**

1. In the Cloudflare dashboard, disable one custom rule whose ref starts with `flarewall_` on the test zone.
2. Wait for the next `security.diff` run in the Dokploy logs.
   - [ ] One ntfy notification arrives, titled `<zone>: drift from the security baseline`.
     - the body names the count of changes and the `flarealoy security diff <zone>` command
     - the priority is high (ntfy priority 4)
3. Wait for one more `security.diff` run.
   - [ ] No second drift notification arrives.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: A back-in-sync alert arrives after the fix  ·  🟡 Normal

**Goal.** The owner learns that the zone is back on the baseline, once.

**Steps**

1. In the Cloudflare dashboard, enable the rule again.
2. Wait for the next `security.diff` run.
   - [ ] One ntfy notification arrives, titled `<zone>: back in sync`, at the default priority.
3. Wait for one more `security.diff` run.
   - [ ] No second notification arrives.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above. Remove `FLAREALOY_SECURITY_DIFF_INTERVAL` in Dokploy, so the job runs every 24 hours, then deploy again.

```sh
flarealoy security diff example.com --no-record
```

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Every command ran in the worktree with `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_WRITE_TOKEN` and the ntfy variables unset. The tests use the fake Cloudflare API, the fake notifier and a fake fetch. No command reached Cloudflare or an ntfy server. The CLI checks used a new `FLAREALOY_DB` file in a temp folder.

Commands run (one per block):

```sh
pnpm typecheck
```

```sh
pnpm test
```

```sh
pnpm build
```

```sh
npm pack --dry-run
```

```sh
FLAREALOY_DB=/tmp/qa/flarealoy.sqlite node dist/cli/main.js init
```

```sh
FLAREALOY_DB=/tmp/qa/flarealoy.sqlite FLAREALOY_SECURITY_DIFF_INTERVAL=daily node dist/cli/main.js run
```

```sh
FLAREALOY_DB=/tmp/qa/flarealoy.sqlite FLAREALOY_HEARTBEAT_INTERVAL=off timeout --preserve-status -s TERM 3 node dist/cli/main.js run
```

- ✅ `pnpm typecheck` → exit 0 at `ed924bc`.
- ✅ `pnpm test` → 27 files, 382 tests passed at `ed924bc`.
- ✅ `pnpm build` → exit 0 at `ed924bc`; `npm pack --dry-run` lists `dist/core/zones.js`, `dist/modules/security/core/drift-job.js`, `dist/modules/security/node/jobs.js` and `dist/node/zones-store.js`.
- ✅ C1 · `drift-job.test.ts` › sends exactly one drift message over two runs, then one in-sync message after the fix → the fake notifier holds one drift message after two runs on an edited rule.
- ✅ C2 · the same test → a third run after the fix adds one `back in sync` message, and a new drift later alerts once again.
- ✅ C3 · `drift-job.test.ts` › a run with a failing API sends one error message and no drift message → one `the security check failed` message over two runs; a failing `listZones` also gives one error message per zone.
- ✅ C4 · `drift-job.test.ts` › after one job run, no core_zones row has an empty account ID → both rows carry the account ID from `listZones`.
- ✅ C5 · `drift-job.test.ts` › flarealoy security add writes the zone row with the inventory revision → one row with the zone ID, the name and the account ID.
- ✅ C6 · `drift-job.test.ts` › core migration 5 fills core_zones → a version 4 file gets one row per current approved inventory, with an empty account ID; a pending revision and a bad `zone_id` get no row.
- ✅ C7 · `scheduler.test.ts` › registers security.diff every 24h by default → `1d` by default, `6h` from `FLAREALOY_SECURITY_DIFF_INTERVAL`, none at `off`; `drift-job.test.ts` › records each run as flarealoy security diff does → two runs with the zone states.
- ✅ C7 · `run` with `FLAREALOY_SECURITY_DIFF_INTERVAL=daily` → exit 2 with `FLAREALOY_SECURITY_DIFF_INTERVAL must be a positive interval such as 15m, 24h or 1d, or off; got: daily`.
- ✅ C7 · `run` with no token → `flarealoy run: security.diff every 1d`, then `job security.diff error 1ms: CLOUDFLARE_API_TOKEN is not set; ...`; SIGTERM → `stopping; a running job gets 5s to finish`, `stopped`, exit 0.
- ✅ C8 · `notifier.test.ts` › records the key only after the send succeeds → no key while the send is in flight, one key after it.
- ✅ C9 · `ntfy.test.ts` › aborts a request that gets no answer within the time limit, adds the cause of a failed fetch, refuses a token with a control character → all pass.
- ✅ C10 · `scheduler.test.ts` › times out a hung job, stops on the signal while a job hangs, records no run for a job that stops on its signal, runs a job whose stored start is not a time, logs a store that cannot record or read a run → all pass.
- ✅ C11 · typecheck, test and build pass (above).

### Database checks

The database is the temp file from `flarealoy init`, opened read-only through `node:sqlite`.

```sh
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(d.prepare(\"select sql from sqlite_master where name='core_zones'\").get().sql);console.log(d.prepare('select key, value from meta order by key').all())" /tmp/qa/flarealoy.sqlite
```

- ✅ Table → `core_zones (id INTEGER PRIMARY KEY, zone_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, account_id TEXT NOT NULL DEFAULT '')`.
- ✅ Index → `sqlite_autoindex_core_zones_1`, unique on `zone_id`.
- ✅ Constraints → `zone_id` and `name` are not null; `account_id` is not null with the default `''`.
- ✅ Migration list → `schema_version.core` is `5`, `schema_version.security` is `1`.

## Not covered / needs human judgment

- A real ntfy notification on a phone, and its text and priority. A test cannot see the phone.
- A real Cloudflare zone. The tests use the fake API only.
- The Dokploy deploy passes the ntfy variables into the container. Check the Dokploy environment, not `docker compose config`.
- A flarealoy export at core schema version 4 does not import into this build, because the core is now at version 5. A flarewall export still imports.
- Concurrency of two `flarealoy run` services on one file is not covered; the plan runs one service.

## Overall result

_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
