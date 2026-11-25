# QA Plan: accounts and token capability

_Generated 2026-11-25 · updated 2026-11-25 · against `c8d51e0` (clean) · covers issue #12: `flarealoy account`, core migration 2 (`core_accounts`), the write-token gate in `security apply`, `security restore` and the TUI_

## Summary
- flarealoy keeps the Cloudflare accounts in the core store, and write commands need `CLOUDFLARE_WRITE_TOKEN`.
- Working means: the account commands edit `core_accounts`, a write without the write token stops before any API call, and reads run on either token.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-12-add-accounts-and-token-capability`, built with `pnpm build`.
- A test database file, never the server file. Set `FLAREALOY_DB` to a new path.
- A real read-only Cloudflare token for Scenario 1. Do not set `CLOUDFLARE_WRITE_TOKEN` in Scenario 1.
- Screenshots: none. This is a terminal UI, and no browser driver applies.

Launch with:

```sh
pnpm install --frozen-lockfile && pnpm build
```

```sh
export FLAREALOY_DB="$(mktemp -d)/flarealoy.sqlite"
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Live zones, read token only | The TUI write key shows the missing-token message | 🔴 Critical |
| TC-1.2 | 1: Live zones, read token only | The help texts read clearly | 🟢 Low |

## Scenario 1: Live zones, read token only

**Setup.** Run once, for every case in this scenario.

1. Set the read token in your shell. Make sure that `CLOUDFLARE_WRITE_TOKEN` is not set.

```sh
unset CLOUDFLARE_WRITE_TOKEN
```

2. Create the test database and add one zone that the read token can see.

```sh
node dist/cli/main.js security init && node dist/cli/main.js security add example.com
```

- [ ] Setup complete

### TC-1.1: The TUI write key shows the missing-token message  ·  🔴 Critical

**Goal.** With no write token, the TUI key `a` tells the owner what is missing and sends nothing.

**Steps**

1. Start the TUI in a real terminal.

   ```sh
   node dist/cli/main.js security tui
   ```

   - [ ] The hint line shows `a apply: needs CLOUDFLARE_WRITE_TOKEN` in the dim colour, and the other hints read as before
2. Select the zone and press `a`.
   - [ ] The diff pane shows `<zone>: needs CLOUDFLARE_WRITE_TOKEN`, no CONFIRM prompt opens, and the line is easy to understand
3. Press `d`, then press `q`.
   - [ ] The dry run plan shows in the diff pane, and the TUI exits with no error

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The help texts read clearly  ·  🟢 Low

**Goal.** The new help text tells the owner which token each command reads.

**Steps**

1. Print the three help texts.

   ```sh
   node dist/cli/main.js --help
   ```

   ```sh
   node dist/cli/main.js security --help
   ```

   ```sh
   node dist/cli/main.js account --help
   ```

   - [ ] The Environment sections and the account usage read clearly, and the columns line up

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
rm -f "$FLAREALOY_DB"
```

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm typecheck
```

```sh
pnpm test
```

```sh
pnpm build
```

The CLI checks below ran on the built binary, with `FLAREALOY_DB` set to a new file in a scratch directory and with neither token set unless the line says so.

```sh
node dist/cli/main.js init && node dist/cli/main.js account add 0123456789abcdef0123456789abcdef --label Main --plan free && node dist/cli/main.js account add fedcba9876543210fedcba9876543210 --label Client --plan paid --token-env CLIENT_TOKEN && node dist/cli/main.js account list
```

```sh
node dist/cli/main.js account set 0123456789abcdef0123456789abcdef --plan paid && node dist/cli/main.js account remove fedcba9876543210fedcba9876543210 && node dist/cli/main.js account list
```

```sh
CLOUDFLARE_API_TOKEN=t node dist/cli/main.js security apply example.com --write --yes
```

```sh
CLOUDFLARE_API_TOKEN=t node dist/cli/main.js security restore example.com 1 --write --yes
```

```sh
node dist/cli/main.js export "$(dirname "$FLAREALOY_DB")/out.json"
```

```sh
sqlite3 "$FLAREALOY_DB" "select key, value from meta; select name from pragma_table_info('core_accounts');"
```

- ✅ `pnpm typecheck` → exit 0 at `c8d51e0`
- ✅ `pnpm test` → 22 files, 310 tests passed at `c8d51e0`
- ✅ `pnpm build` → exit 0 at `c8d51e0`; `dist/cli/main.js` runs
- ✅ At `c8d51e0`, on the rebuilt binary: `account add` and `account list` print the same lines as below, and `security apply example.com --write --yes` with only `CLOUDFLARE_API_TOKEN` exits 2 with `security apply --write needs CLOUDFLARE_WRITE_TOKEN`. The other CLI lines below ran at `15adb19`; the fix commit changed only the `--write` handling of read commands.
- ✅ C1 · `account add` → `added account 0123…cdef (free, reads CLOUDFLARE_API_TOKEN)` and `added account fedc…3210 (paid, reads CLIENT_TOKEN)`; `account list` → `0123456789abcdef0123456789abcdef  free  CLOUDFLARE_API_TOKEN  Main` and `fedcba9876543210fedcba9876543210  paid  CLIENT_TOKEN  Client`
- ✅ C1 · `account set --plan paid` → `paid` in the line; `account remove` → `removed account fedc…3210`; the next `account list` shows one account
- ✅ C1 · bad input (duplicate ID, bad ID, plan `pro`, bad variable name, empty label, missing `--label`, unknown account, no database file) → exit 2 with one clear line each (`test/core/accounts-cli.test.ts`)
- ✅ C2 · `security apply example.com --write --yes` with only `CLOUDFLARE_API_TOKEN` → exit 2, `security apply --write needs CLOUDFLARE_WRITE_TOKEN`; the fake API records 0 writes and builds 0 clients (transcript snapshot `write token > … refuse without CLOUDFLARE_WRITE_TOKEN`)
- ✅ C3 · the same command with `CLOUDFLARE_WRITE_TOKEN` → backup 1 saved, `applied, read-back in sync`, 6 writes, the client is built on the write token; the dry run uses the read token (transcript snapshot)
- ✅ C3 · `security restore … --write` with only `CLOUDFLARE_API_TOKEN` → exit 2, `security restore --write needs CLOUDFLARE_WRITE_TOKEN`
- ✅ C4 · `security status --write` with only `CLOUDFLARE_API_TOKEN` → the flag has no effect, the table prints on the read token (transcript snapshot, `c8d51e0`)
- ✅ C4 · `security status` with only `CLOUDFLARE_WRITE_TOKEN` → exit 1 (drift), the table prints, the client is built on the write token (transcript snapshot)
- ✅ C5 · TUI with no write client → the hint line shows `a apply: needs CLOUDFLARE_WRITE_TOKEN`, `a` puts `example.org: needs CLOUDFLARE_WRITE_TOKEN` in the diff pane, no prompt opens, 0 writes, and `d` still runs the dry run (`test/security/tui-write.test.tsx`)
- ✅ Data · `meta` holds `schema_version.core = 2` and `schema_version.security = 1`; `core_accounts` has `id, account_id, label, plan, limits, token_env`; the file mode is `600`
- ✅ Data · export → `schema_versions {core: 2, security: 1}`, tables `core_accounts` first; export, import into a new file and export again give a byte-identical file (`test/core/accounts-cli.test.ts`)
- ✅ C6 · core purity test passes for the new `src/core/accounts.ts`, `src/core/tokens.ts` and `src/core/core-module.ts`
- ✅ No token reaches a file: `src/core/tokens.ts`, `src/core/accounts.ts`, `src/cli/account.ts` and `src/node/accounts-store.ts` hold no file write; `core_accounts.token_env` stores the variable name only

## Not covered / needs human judgment
- A real `apply --write` on a live zone. AGENTS.md forbids it for the agent; the owner runs writes.
- The private string check needs the owner's `FLAREALOY_PRIVATE_STRINGS` secret; CI runs it.
- The look of the TUI hint line in a real terminal (TC-1.1).
- Core migration 2 collides with the core migrations that #13 and #14 add on their branches. The merge renumbers them.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
