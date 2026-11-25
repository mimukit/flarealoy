# QA Plan: notifier and flarealoy test-alert

_Generated 2026-11-25 · against `3274706` (clean) · covers issue #13: the Notifier port, the `core_alerts` dedupe record, the ntfy adapter and `flarealoy test-alert`_

## Summary
- flarealoy sends every alert through one channel port and sends each dedupe key once; ntfy is the first channel.
- Working means `flarealoy test-alert` delivers one message to the configured ntfy topic and records its key in `core_alerts`.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-13-add-the-notifier-and-the-test-alert-command`, built with `pnpm build`.
- Use a new scratch database file, never your real one.
- Use a new ntfy topic for this test. Subscribe to it in the ntfy app on your phone before you start.
- Screenshots: none. The change has no UI.

Build, then set the scratch database:

```sh
pnpm install --frozen-lockfile && pnpm build
```

```sh
export FLAREALOY_DB="$(mktemp -d)/flarealoy.sqlite"
```

```sh
node dist/cli/main.js init
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Scratch database, ntfy topic subscribed on a phone | A test alert reaches the phone | 🔴 Critical |
| TC-1.2 | 1: Scratch database, ntfy topic subscribed on a phone | A protected topic accepts the token | 🟡 Normal |

## Scenario 1: Scratch database, ntfy topic subscribed on a phone

**Setup.** Run once, for every case in this scenario. Replace the topic with the one you subscribed to.

```sh
export FLAREALOY_NTFY_TOPIC=flarealoy-qa-change-me
```

- [ ] Setup complete

### TC-1.1: A test alert reaches the phone  ·  🔴 Critical

**Goal.** A real ntfy server accepts the POST that flarealoy sends, and the phone shows it correctly.

**Steps**

1. Send one test alert through the public ntfy.sh server.

   ```sh
   node dist/cli/main.js test-alert
   ```

   - [ ] The command prints `sent a test alert through ntfy` and exits 0
2. Look at the notification on the phone.
   - [ ] One notification arrives, and it reads correctly
     - title: `flarealoy test alert`
     - body: the sentence with the send time
     - priority: default (no urgent sound or banner)
3. Run the command a second time.
   - [ ] A second notification arrives, because every test alert has a new key

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: A protected topic accepts the token  ·  🟡 Normal

**Goal.** A self-hosted or reserved ntfy topic that needs an access token gets the alert.

**Steps**

1. Set the server and a token for a topic that refuses anonymous posts. Skip this case if you have no such topic.

   ```sh
   export FLAREALOY_NTFY_URL=https://ntfy.example.com FLAREALOY_NTFY_TOKEN=tk_change_me
   ```

2. Send one test alert.

   ```sh
   node dist/cli/main.js test-alert
   ```

   - [ ] The command exits 0, and the notification arrives on the phone
3. Unset the token and send again.

   ```sh
   unset FLAREALOY_NTFY_TOKEN && node dist/cli/main.js test-alert
   ```

   - [ ] The command exits 1 with `test-alert: ntfy: the server answered HTTP 403` (or 401), and the output holds no topic and no token

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
unset FLAREALOY_NTFY_TOPIC FLAREALOY_NTFY_URL FLAREALOY_NTFY_TOKEN && rm -f "$FLAREALOY_DB"
```

## Automated verification (by AI agent)
_Checks the agent ran itself at `3274706` (clean). No action needed from the tester. No check sent a request to any ntfy server: the unit tests use a fake fetch, and the end-to-end checks post to a local stub HTTP server on 127.0.0.1._

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

- ✅ `pnpm typecheck` → exit 0
- ✅ `pnpm test` → exit 0, 23 files, 317 tests. New files: `test/core/notifier.test.ts`, `test/core/ntfy.test.ts`, `test/core/test-alert-cli.test.ts`
- ✅ C1 · `sendAlert` › "sends each message with a new key, and the fake notifier records each one" → the fake holds both messages, and `core_alerts` holds both rows
- ✅ C2 · `sendAlert` › "a second send with the same dedupe key sends nothing" → result `duplicate`, the fake holds one message, `core_alerts` holds one row
- ✅ C3 · `flarealoy test-alert` › "with the fake notifier records one message and one core_alerts row" → exit 0, one message, one row
- ✅ C4 · `ntfy notifier` › "sends one POST to the server and topic with the title, the priority and the body" → URL `https://ntfy.example.com/flarealoy-alerts`, method POST, `Title`, `Priority: 5` for critical, the body text
- ✅ C5 · `test/core/purity.test.ts` scans `src/core/notifier.ts` and `src/core/alerts-sql.ts` → no Node-only API; the adapter files sit in `src/node/`
- ✅ Each new test went red under a deliberate break in the code it covers (dedupe skip, release on failure, priority map, body, title, the send in test-alert, the claim result), and green after the break was undone
- ✅ `pnpm build` → exit 0; `npm pack --dry-run` → exit 0 and lists `dist/core/notifier.js`, `dist/node/ntfy.js`, `dist/cli/test-alert.js`

End-to-end with the built CLI and a scratch database (`FLAREALOY_DB` in a temporary directory):

- ✅ `flarealoy --help` → lists `test-alert` and the three `FLAREALOY_NTFY_*` variables
- ✅ `flarealoy init` → exit 0; `meta` holds `schema_version.core = 2`, `schema_version.security = 1`
- ✅ Schema → `core_alerts (id INTEGER PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')), sent_at TEXT NOT NULL)`
- ✅ `test-alert` with no `FLAREALOY_NTFY_TOPIC` → exit 2, `no alert channel is configured; set FLAREALOY_NTFY_TOPIC (and FLAREALOY_NTFY_URL for a server other than ntfy.sh)`
- ✅ `test-alert` with topic `a/b` → exit 2, `FLAREALOY_NTFY_TOPIC must be 1 to 64 letters, digits, - or _`
- ✅ `test-alert now` → exit 2, `test-alert takes no arguments, got: now`
- ✅ `test-alert` against a local stub (200) with a token → exit 0, `sent a test alert through ntfy`; the stub got one `POST /flarealoy-qa` with `Title: flarealoy test alert`, `Priority: 3`, `Authorization: Bearer tk_fake_qa` and the body text
- ✅ A second `test-alert` → exit 0, a second request, a second `core_alerts` row with a new key
- ✅ `test-alert` against a stub that answers 500 → exit 1, `test-alert: ntfy: the server answered HTTP 500`
- ✅ `test-alert` against a closed port → exit 1, `test-alert: ntfy: the request to 127.0.0.1:18915 failed: fetch failed` (the server host only, no topic)
- ✅ `flarealoy export` after two test alerts → `schema_versions {"core":2,"security":1}`, tables `revisions, backups, runs, run_zones`; `core_alerts` stays out of the export by design

## Not covered / needs human judgment
- C8 · the delivery to a real ntfy server and a real phone (TC-1.1, TC-1.2). The run must not send a real request to ntfy.
- Concurrency: two processes that send the same key at one time. The UNIQUE constraint makes the claim atomic, but no test runs two processes.
- The usage and drift alerts. They come in the usage plan and in Phase 10 (#16).

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
