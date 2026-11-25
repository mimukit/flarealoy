# QA Plan: flarewall moves into the Flarealoy security module

_Generated 2026-11-25 · against `d2b71a7` (clean) · covers issue #11, plan 0004 Phases 2, 3 and 4_

## Summary
- The flarewall code moves into `src/modules/security`, runs as `flarealoy security <cmd>`, and shares a core SQLite store with one migration list per module.
- Working means the same security behavior with the new command names, and old flarewall data that opens or imports with no loss.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-11-move-flarewall-into-the-security-module-of-flarealoy` at `d2b71a7` or later.
- Node 22.13 or later, and pnpm.
- No screenshots: the change has no screen. The TUI code moved without a change in behavior.
- Use a temporary directory for every database file in this plan. Never point `FLAREALOY_DB` at a file that holds real data, except a copy in Scenario 2.

Build the package once:

```sh
pnpm install --frozen-lockfile && pnpm build
```

Set a temporary directory for the database files:

```sh
export QA_DIR="$(mktemp -d)"
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: New build, no database | The help texts read correctly | 🟢 Low |
| TC-2.1 | 2: A copy of a real flarewall database | Real data opens with no loss, and status reads live zones | 🔴 Critical |

## Scenario 1: New build, no database

**Setup.** Run once, for every case in this scenario.

1. Make sure that no old variable is set.

```sh
unset FLAREWALL_DB FLAREALOY_DB
```

- [ ] Setup complete

### TC-1.1: The help texts read correctly  ·  🟢 Low

**Goal.** The top-level and security help texts tell a new user which command to run.

**Steps**

1. Print the top-level help.

   ```sh
   node dist/cli/main.js --help
   ```

   - [ ] The text says clearly that `security` is a module, and that `init`, `export` and `import` are top-level commands
2. Print the security help.

   ```sh
   node dist/cli/main.js security --help
   ```

   - [ ] Every line names `flarealoy security`, and no line names `export` or `import`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset. This scenario writes no file.

## Scenario 2: A copy of a real flarewall database

**Setup.** Run once, for every case in this scenario. You need your own flarewall database file and a read token.

1. Copy your flarewall database into the temporary directory. Use the path that `FLAREWALL_DB` named, or the default path.

```sh
cp ~/.local/share/flarewall/flarewall.sqlite "$QA_DIR/real-copy.sqlite"
```

2. Set your Cloudflare read token in the shell. Do not write it to a file.

- [ ] Setup complete

### TC-2.1: Real data opens with no loss, and status reads live zones  ·  🔴 Critical

**Goal.** A real flarewall version 1 file keeps every revision and backup after the migration, and the security commands still work on it.

**Steps**

1. Record the revisions before the migration.

   ```sh
   sqlite3 "$QA_DIR/real-copy.sqlite" "select count(*), max(id) from revisions; select count(*) from backups; select key, value from meta;"
   ```

2. List the revisions through flarealoy. This runs the migration on the copy.

   ```sh
   FLAREALOY_DB="$QA_DIR/real-copy.sqlite" node dist/cli/main.js security log
   ```

   - [ ] The list shows the same revision ids, times and messages as `flarewall log` showed before
3. Read the counts and the meta keys again.

   ```sh
   sqlite3 "$QA_DIR/real-copy.sqlite" "select count(*), max(id) from revisions; select count(*) from backups; select key, value from meta;"
   ```

   - [ ] The counts are equal to step 1, and meta holds `schema_version.core` and `schema_version.security` and no `schema_version`
4. Read the live state of your zones. This command only reads.

   ```sh
   FLAREALOY_DB="$QA_DIR/real-copy.sqlite" node dist/cli/main.js security status
   ```

   - [ ] Each zone shows the same state that `flarewall status` showed before the change

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Remove the temporary directory and the copy in it.

```sh
rm -rf -- "$QA_DIR"
```

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Phase 2 checks ran in a detached worktree of the move commit `69ddb53`. Phase 3 and 4 checks ran at `d2b71a7`. Every database file was a new file in a temporary directory.

Commands run (one per block; chain with `&&` when they must run together):

```sh
git worktree add --detach "$TMP/move" 69ddb53 && cd "$TMP/move" && pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build
```

```sh
node dist/modules/security/cli/main.js --help
```

```sh
git diff -M50% --name-status flarewall-v0.1.0 69ddb53 -- src
```

```sh
git diff -M50% flarewall-v0.1.0 69ddb53 -- src | grep '^[+-][^+-]' | grep -vE '^[+-]\s*(import|\} from|from )'
```

```sh
git diff --name-status -M 0a833ad 69ddb53 -- '*.snap'
```

```sh
git diff 69ddb53 8bd1ed7 -- test/security/__snapshots__/cli-transcript.test.ts.snap
```

```sh
pnpm typecheck && pnpm test && pnpm build && npm pack --dry-run
```

```sh
bash cli-checks.sh "$TMP" "$PWD"
```

- ✅ C1 · `0a833ad` adds `test/cli-transcript.test.ts` with 36 snapshot tests before the move. It covers every security command and the no-token, no-database, `--data` and bad-revision-id paths.
- ✅ C2 · At `69ddb53`, `pnpm typecheck` exits 0 and `pnpm test` reports 17 files, 261 tests passed (225 old tests plus 36 transcript tests).
- ✅ C3 · The name-status diff of `src` against the tag shows 26 lines, all `R100`. The changed-line grep prints nothing.
- ✅ C4 · In `69ddb53`, both snapshot files are `R100` renames. The render snapshot is also `R100` from the tag to `d2b71a7`.
- ✅ C5 · At `69ddb53`, `node dist/modules/security/cli/main.js --help` prints text identical to the `USAGE` constant of the tag (`diff` exit 0).
- ✅ C6 · `package.json` is `flarealoy` `0.1.0` with bin `{"flarealoy":"dist/cli/main.js"}`. `npm pack --dry-run` names `flarealoy-0.1.0.tgz`.
- ✅ C7 · The transcript snapshot diff from `69ddb53` to `8bd1ed7` has 53 changed lines. After the substitution of `flarealoy security` and `flarealoy` with `flarewall`, the removed and added lines are equal.
- ✅ C8 · `security status` with a missing `FLAREALOY_DB` file prints `no flarealoy database at <path>; run flarealoy security init`, exit 2.
- ✅ C9 · `FLAREWALL_DB=x` prints `FLAREWALL_DB is gone; flarealoy reads FLAREALOY_DB. To move old data: flarewall export <file>, then flarealoy import <file>`, exit 2. Top-level `init` stops the same way.
- ✅ C10 · `flarealoy nope` prints `unknown command: nope` and the top-level usage, exit 2. `flarealoy security nope` prints the security usage, exit 2.
- ✅ C11 · The security `MIGRATIONS` text at `d2b71a7` is identical to the tag. The store, the runner, export and import live in `src/core/` and `src/node/`. `test/core/store.test.ts` and `test/core/purity.test.ts` pass.
- ✅ C12 · `flarealoy init` creates the file with mode `600`, the meta keys `schema_version.core=1` and `schema_version.security=1`, and the four security tables. A second `init` exits 0. `security init` on a missing file writes baseline revision 1.
- ✅ C13 · A file made by the `flarewall-v0.1.0` build (meta `schema_version=1`) opens with `flarealoy security log`. The revision rows (id, sha256, created_at, decided_at) are byte-identical before and after. The meta keys become `schema_version.core=1` and `schema_version.security=1`. `test/core/store.test.ts` covers all four tables.
- ✅ C14 · The tag build's `flarewall export` piped into `flarealoy import -` loads 1 revision. A new export holds the same rows in all four tables. A flarealoy export, imported and exported again, is byte-identical (`cmp` exit 0). A second import into a non-empty file exits 2.
- ✅ C15 · With `schema_version.security=99`, `security log` and `export` print `the database schema is newer than this flarealoy; upgrade flarealoy`, exit 2.
- ✅ C16 · `security export` and `security import` print `moved: run flarealoy export`, exit 2.
- ✅ C17 · At `d2b71a7`: `pnpm typecheck` exit 0; `pnpm test` 20 files, 292 tests passed; `pnpm build` exit 0; `npm pack --dry-run` exit 0 with 66 files: `dist/`, `LICENSE`, `README.md` and `package.json`.

### Browser checks
_Not run. The change has no web page._

## Not covered / needs human judgment
- The TUI is not run by hand. Its code moved with import edits only, and its 5 test files pass.
- A write against a live zone is not run. AGENTS.md reserves `apply --write` for the owner.
- The README and most of AGENTS.md still name flarewall. Plan 0004 Phase 11 owns that rewrite.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
