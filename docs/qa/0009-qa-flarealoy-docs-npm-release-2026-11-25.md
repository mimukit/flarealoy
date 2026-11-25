# QA Plan: Flarealoy docs and the npm releases

_Generated 2026-11-25 · against `94d159f` (clean), refreshed at `262eeeb` (clean) · covers issue #17: README.md, AGENTS.md, the plan 0001 and 0003 superseded notes, the `.gitignore` comments, the comment fixes in `src/`, the `npm/flarewall-placeholder/` package, and the body edits of issues #2 and #4_

## Summary
- The docs name Flarealoy, and the repo holds the `flarewall` placeholder package for the owner to publish.
- Working means a reader can install, deploy, run commands over SSH and move flarewall data from the README alone, and the owner can publish both packages.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-17-document-flarealoy-and-publish-the-npm-packages` at `94d159f` or later.
- You need the Dokploy server with the deployed `flarealoy` service, SSH access to it, and the npm account that owns the `flarealoy` and `flarewall` names.
- Screenshots: none. This change has no UI.

Install and build with:

```sh
pnpm install && pnpm build
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: The branch checked out, nothing published | The README is complete and correct for a new reader | 🔴 Critical |
| TC-1.2 | 1: The branch checked out, nothing published | Accept or reject the kept rule descriptions | 🟡 Normal |
| TC-2.1 | 2: The deployed server and a work machine | The shell function runs commands in the container | 🔴 Critical |
| TC-3.1 | 3: The PR merged, nothing published | Publish `flarealoy@0.1.0` | 🔴 Critical |
| TC-3.2 | 3: The PR merged, nothing published | Publish and deprecate the `flarewall` placeholder | 🔴 Critical |

## Scenario 1: The branch checked out, nothing published

**Setup.** Run once, for every case in this scenario.

1. Open `README.md` and `AGENTS.md` of the branch in a Markdown viewer.

- [ ] Setup complete

### TC-1.1: The README is complete and correct for a new reader  ·  🔴 Critical

**Goal.** A reader can install, deploy, use the shell function and move old data from the README alone.

**Steps**

1. Read the README from the top to "Commands".
   - [ ] The server setup steps are in an order you can follow on Dokploy
     - the compose app, the environment values, the volume backup, the deploy, the shell function, `flarealoy init`
   - [ ] The data move steps match what you did, or would do, for the old flarewall file
2. Read the AGENTS.md changes.
   - [ ] The rules are correct for an agent that works in this repo

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: Accept or reject the kept rule descriptions  ·  🟡 Normal

**Goal.** The owner decides if the 7 `flarewall:` rule descriptions can stay under the grep criterion of issue #17.

**Steps**

1. Run the grep of the issue.

   ```sh
   grep -rn flarewall README.md AGENTS.md src
   ```

   - [ ] Every printed line is the old-variable message, a migration step, the `flarewall_` ref prefix, or a rule description you accept
     - the 7 `description: "flarewall: ..."` lines in `src/modules/security/baseline/default.yaml` stay, because `diff` compares `description`
     - the plan file names in the README links cannot change

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Scenario 2: The deployed server and a work machine

**Setup.** Run once, for every case in this scenario.

1. Add the shell function from the README "Run commands over SSH" section to your shell startup file. Replace `<host>` with the SSH name of the server.
2. Open a new terminal.

- [ ] Setup complete

### TC-2.1: The shell function runs commands in the container  ·  🔴 Critical

**Goal.** The README shell function reaches the `flarealoy` container on the server.

**Steps**

1. Run a read command through the function.

   ```sh
   flarealoy security log
   ```

   - [ ] The output is the revision list of the server database
2. Open the baseline in the editor, then quit with no change.

   ```sh
   flarealoy security edit --baseline
   ```

   - [ ] `vi` opens in your terminal, and an unchanged quit saves no revision

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Nothing to reset.

## Scenario 3: The PR merged, nothing published

**Setup.** Run once, for every case in this scenario.

1. Check out `main` with the merged PR.
2. Log in to npm with the account that owns the names.

```sh
pnpm install && pnpm build
```

- [ ] Setup complete

### TC-3.1: Publish `flarealoy@0.1.0`  ·  🔴 Critical

**Goal.** The `flarealoy` package is on npm at version `0.1.0` with only the allowed files.

**Steps**

1. Check the package contents.

   ```sh
   npm pack --dry-run
   ```

   - [ ] The list holds only `dist/`, `LICENSE`, `README.md` and `package.json`
2. Publish the package.

   ```sh
   npm publish
   ```

3. Read the version from the registry.

   ```sh
   npm view flarealoy version
   ```

   - [ ] The output is `0.1.0`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: Publish and deprecate the `flarewall` placeholder  ·  🔴 Critical

**Goal.** The `flarewall` name holds a deprecated placeholder that points to `flarealoy`.

**Steps**

1. Go to the placeholder folder.

   ```sh
   cd npm/flarewall-placeholder
   ```

2. Publish the placeholder.

   ```sh
   npm publish
   ```

3. Deprecate the name.

   ```sh
   npm deprecate flarewall "renamed to flarealoy"
   ```

4. Read the deprecation from the registry.

   ```sh
   npm view flarewall deprecated
   ```

   - [ ] The output is `renamed to flarealoy`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** A publish cannot be undone. Nothing to reset.

## Automated verification (by AI agent)
_Checks the agent ran itself at `94d159f` (clean). The fix commit `262eeeb` changes README.md only; the agent ran the shell function and grep checks again at `262eeeb`, and the gate results at `94d159f` stay valid because no code, test or package file changed. No action needed from the tester; listed here for context and sign-off._

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

```sh
npm pack --dry-run --json
```

```sh
cd npm/flarewall-placeholder && npm pack --dry-run --json
```

```sh
grep -rn flarewall README.md AGENTS.md src
```

```sh
FLAREALOY_PRIVATE_STRINGS='zz-not-present-zz' pnpm check:private
```

- ✅ `pnpm typecheck` → exit 0.
- ✅ `pnpm test` → 27 files, 382 tests passed. The one snapshot change is the inventory header line `written by flarealoy security add.` and its revision hash.
- ✅ `pnpm build` → exit 0.
- ✅ C3 · `npm pack --dry-run` → `flarealoy` `0.1.0`, 104 files, top-level entries only `LICENSE`, `README.md`, `dist`, `package.json`.
- ✅ C9 · placeholder pack → `flarewall` `0.0.1`, files `README.md` and `package.json`; `bin` and `main` are not set.
- ❌ C2 · the grep prints 61 lines. All are the old-variable message and its checks, the flarewall export and old schema key (migration), the `flarewall_` ref prefix, the README data move section and plan file names, except 7 `description: "flarewall: ..."` lines in `src/modules/security/baseline/default.yaml`. These stay on purpose; see TC-1.2.
- ✅ The private string check runs: "No private strings in 125 files". The real strings run in CI.
- ✅ C1 · each README command ran on the built CLI with `FLAREALOY_DB` in a temp folder and no tokens: `init` (exit 0), `security init` (exit 0), `account add ... --token-env OTHER_TOKEN`, `account list`, `account set ... --token-env CLOUDFLARE_API_TOKEN`, `account remove` (exit 0), `test-alert` with no channel (exit 2, names `FLAREALOY_NTFY_TOPIC`), `export` then `import -` from stdin into a new file (exit 0, same rows), `security export` (exit 2, `moved: run flarealoy export`), `FLAREWALL_DB=x security status` (exit 2, old-variable message), `security status` with no token (exit 2), `security apply example.com --write` (exit 2, `security apply --write needs CLOUDFLARE_WRITE_TOKEN`), `run` with both intervals `off` (logs `no jobs`, stops on SIGTERM).
- ✅ C1 · the shell function, with `ssh` replaced by `printf`, sends `docker exec -it -e EDITOR $(docker ps -qf label=com.docker.compose.service=flarealoy) flarealoy security edit -m two\ words` in bash and in zsh at `262eeeb`. The `$(docker ps ...)` part stays for the server shell, an argument with a space stays one argument, and a call with no arguments sends no empty argument.
- ✅ C5 · `gh issue view 2` and `gh issue view 4` → no `` `flarewall <command> `` is left; the Plan line names plan 0004; labels stay `ready,high` and `blocked,medium`.
- ✅ C6 · AGENTS.md names Flarealoy, `FLAREALOY_DB`, `/data/flarealoy.sqlite`, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_WRITE_TOKEN`, and the no-publish rule.
- ✅ C7 · plan 0001 rows Name, Secrets, Distribution and license, and plan 0003 rows File location, Drift history end with "Superseded by plan 0004".
- ✅ C8 · both `.gitignore` comments name Flarealoy.

## Not covered / needs human judgment
- C4, `npm view flarealoy version` and `npm view flarewall deprecated`: only the owner publishes. TC-3.1 and TC-3.2 cover them.
- The Dokploy deploy and the data move on real data: they need the server and the owner's data. TC-2.1 covers the shell function.
- `docker build`: the Dockerfile did not change in this branch.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
