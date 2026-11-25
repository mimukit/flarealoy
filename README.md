# Flarealoy

Flarealoy manages and monitors Cloudflare accounts. It has one command, `flarealoy`, with modules:

- The `security` module keeps a set of Cloudflare zones on one security baseline. You write the rules once in a baseline. Flarealoy applies them to each zone, checks every zone for drift on a schedule, sends an alert when a zone drifts, and shows the state of all zones on one screen. Every edit to the baseline or a zone inventory is a revision you can list, diff and roll back.
- A `usage` module that alerts before an account reaches a Cloudflare plan limit comes later, from its own plan.

The security module targets the Cloudflare Free plan: 5 custom rules, 1 rate limiting rule with a 10 second period, and no `matches` operator.

Flarealoy keeps all its data (the accounts, the baseline, each zone's inventory, the backups, the drift runs and the sent alerts) in one SQLite file. In normal use that file is on your server, in the Docker volume of the `flarealoy run` service, and you run every command in that container over SSH.

Flarealoy was called flarewall before 2026-11-25. See [Move your flarewall data](#move-your-flarewall-data).

## Install

Flarealoy needs Node 22.13 or later, for `node:sqlite`.

```sh
npm install -g flarealoy
```

A local install with a local database is for development and tests only. For real use, run the service on a server, as the next section says, and keep one database there.

## Server setup

The repo ships a `Dockerfile` and [`compose.example.yaml`](compose.example.yaml). The compose file has one `flarealoy` service that builds the image from this repo, runs `flarealoy run`, and keeps the database on the named volume `flarealoy-data`, mounted at `/data`. The image sets `FLAREALOY_DB=/data/flarealoy.sqlite`, runs as the non-root `node` user, and includes `vi` for `flarealoy security edit`.

To deploy with [Dokploy](https://dokploy.com):

1. Create a Dokploy compose app from this repo, with `compose.example.yaml` as the compose file. Dokploy builds the image; there is no image registry.
2. Set the environment values in Dokploy: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_WRITE_TOKEN`, and the ntfy variables from [Alerts](#alerts). Never write a token into the compose file.
3. Add a Dokploy volume backup for the `flarealoy-data` volume. Flarealoy does not copy the database file itself.
4. Deploy. The service creates `/data/flarealoy.sqlite`, runs every job on its interval and logs one line for each run. It stops cleanly on SIGTERM. Until the database holds a baseline, each `security.diff` run logs an error line; this stops after step 6 or step 8.
5. Add the [shell function](#run-commands-over-ssh) on each machine you work from.
6. Run `flarealoy init` once through the shell function. It checks the database and prints `database ready`. To bring flarewall data, do [the data move](#move-your-flarewall-data) now, before the next steps.
7. Run `flarealoy test-alert` to check the alert channel.
8. When you did the data move, skip `flarealoy security init`: the import brought your baseline, and `security init` refuses a database that holds one. Otherwise run `flarealoy security init` to write the default baseline. Then run `flarealoy security add <zone>` for each new zone. Set the host roles with `flarealoy security edit <zone>` before you apply.

The service and every `docker exec` command share the one file in the one container. A command waits up to 5 seconds for a lock, and the service writes once per job run, so lock waits are short.

These variables set the job intervals. Each takes a value such as `15m`, `24h` or `1d`, or `off` to drop the job. Set them as environment values in Dokploy; `compose.example.yaml` passes them to the container. A variable that is not in the compose `environment:` block never reaches the container.

| Variable | Job | Default |
|----------|-----|---------|
| `FLAREALOY_SECURITY_DIFF_INTERVAL` | `security.diff`: diffs every inventory zone with the read token, records the run as `flarealoy security diff` does, and sends the drift alerts | `24h` |
| `FLAREALOY_HEARTBEAT_INTERVAL` | `core.heartbeat`: does nothing, so its log line shows that the service runs | `24h` |

## Run commands over SSH

Put this shell function in the shell startup file (`~/.bashrc` or `~/.zshrc`) of each machine you work from. Replace `<host>` with the SSH name of the Dokploy server.

```sh
flarealoy() {
  ssh -t <host> "docker exec -it -e EDITOR \$(docker ps -qf label=com.docker.compose.service=flarealoy) flarealoy $([ $# -gt 0 ] && printf '%q ' "$@")"
}
```

- The `docker ps` part runs on the server. It finds the container by its compose service label, because Dokploy sets the compose project name.
- `-e EDITOR` passes the server shell's `EDITOR` to the container when it is set. Otherwise the image default, `vi`, opens for `flarealoy security edit`.
- With the function, `flarealoy security status` on your machine runs `flarealoy security status` in the container on the server.

The function uses `-t`, so it cannot read stdin from a pipe. To pipe a file into a command, such as `flarealoy import -` or `flarealoy security propose <zone> -`, run `docker exec -i` without `-t`:

```sh
ssh <host> 'docker exec -i $(docker ps -qf label=com.docker.compose.service=flarealoy) flarealoy import -' < old.json
```

## Move your flarewall data

Skip this section when you never used flarewall.

Flarealoy does not open the flarewall database file. It loads a flarewall export. When `FLAREWALL_DB` is set, every `flarealoy` command stops with a message that names these steps, so unset it after the move.

1. On the machine that holds the old flarewall file, build flarewall from the `flarewall-v0.1.0` tag of this repo: `git checkout flarewall-v0.1.0`, then `pnpm install` and `pnpm build`.
2. Export the old data with that build: `node dist/cli/main.js export old.json`. It reads `FLAREWALL_DB` (or the flarewall default path) and never writes the old file.
3. Load the export into the empty server database: `ssh <host> 'docker exec -i $(docker ps -qf label=com.docker.compose.service=flarealoy) flarealoy import -' < old.json`. The database must hold no rows: run the import before `flarealoy security init` and `flarealoy account add`.
4. Check the result: `flarealoy security log` lists the same revision ids as `flarewall log` did, and `flarealoy security backups <zone>` lists the same backup ids.
5. Delete `old.json`. It holds your private data.

`import` loads into an empty database only and never merges. An import runs in one transaction, so a failed import leaves the database empty: fix the cause and run the import again. The old flarewall file stays as it was, so you can go back to the `flarewall-v0.1.0` build at any time.

## Commands

Top-level commands:

| Command | What it does |
|---------|--------------|
| `flarealoy init` | Creates the database file when it is missing and runs every module migration. |
| `flarealoy account add <account-id> --label <text> --plan free\|paid [--token-env <NAME>]` | Adds a Cloudflare account. `--token-env` names the variable that holds the read token of this account; see [Tokens](#tokens). |
| `flarealoy account list` | Prints one line per account: ID, plan, token variable and label. |
| `flarealoy account set <account-id> [--label <text>] [--plan free\|paid] [--token-env <NAME>]` | Changes an account. `--token-env CLOUDFLARE_API_TOKEN` goes back to the default. |
| `flarealoy account remove <account-id>` | Removes an account. |
| `flarealoy export <file>` | Writes every table of every module to one new JSON file, with mode 0600. It never overwrites a file. |
| `flarealoy import <file\|->` | Loads an export file, or stdin for `-`, into an empty database. It also loads a flarewall export. It never merges. |
| `flarealoy test-alert` | Sends one test alert through the configured alert channel. |
| `flarealoy run` | Runs every registered job on its interval until SIGTERM or SIGINT. The Docker image runs this command. |

Security zone commands:

| Command | What it does |
|---------|--------------|
| `flarealoy security init` | Writes the default baseline as revision 1, and creates the database file when it is missing. It refuses when the file already holds a baseline. |
| `flarealoy security add <zone>` | Writes the first inventory revision for a zone with no entry. The zone's proxied hostnames go in as comments. |
| `flarealoy security status [zone...]` | Prints one row per zone: name, plan, and state (`in sync`, `drift`, `legacy`, `not managed`, or `error`). Covers every zone by default. |
| `flarealoy security diff [zone...]` | Prints the changes per zone, plus the unowned and legacy rules. Covers every zone by default. It records the run (one row per zone) unless you pass `--no-record`. |
| `flarealoy security apply <zone...>` or `flarealoy security apply --all` | Sends the rendered baseline to the zones. Without `--write` it is a dry run that prints what it would send. |
| `flarealoy security tui` | Opens the terminal UI: every zone's state and diff on one screen, with dry run, apply, and add keys. Press `?` for the keys. It needs a terminal. |
| `flarealoy security restore <zone> <backup-id>` | Sends a stored backup back to a zone. Without `--write` it is a dry run that prints what it would send. |
| `flarealoy security backups <zone>` | Lists the stored backups of a zone, with their ids. |

Security revision commands:

| Command | What it does |
|---------|--------------|
| `flarealoy security edit <zone>` or `flarealoy security edit --baseline` | Opens the current text in `$EDITOR` (`$VISUAL` first, `vi` when neither is set). An invalid file opens again with the error at the top; an empty file cancels. Flarealoy prints the diff and saves an approved revision. |
| `flarealoy security propose <zone> <file>` or `flarealoy security propose --baseline <file>` | Writes a pending revision for the owner to approve and prints its id. `<file>` can be `-` for stdin. |
| `flarealoy security approve <id>` and `flarealoy security reject <id>` | Decide a pending revision. Approval refuses a revision whose parent is no longer the current revision; propose it again. |
| `flarealoy security log [zone]` | Lists the revisions, oldest first: id, time, document, status, author, and message. |
| `flarealoy security show <id>` | Prints one revision: a comment header, then the YAML text. |
| `flarealoy security revert <id>` | Saves the text of an older approved revision as a new revision. Nothing is deleted. |

`flarealoy security export` and `flarealoy security import` moved to the top level: run `flarealoy export` and `flarealoy import`.

Security flags:

- `--all` makes `apply` cover every inventory zone. `apply` needs zone names or `--all`.
- `--write` makes `apply` and `restore` send the writes. Each zone gets a backup first, then a confirmation prompt, then the writes, then a read-back. It needs `CLOUDFLARE_WRITE_TOKEN`.
- `--yes` skips the per-zone prompt. With `--write`, no terminal on stdin, and no `--yes`, the command refuses to start.
- `--no-record` makes `diff` skip the run record.
- `--baseline` makes `edit` and `propose` work on the baseline in place of a zone inventory.
- `-m <text>` or `--message <text>` sets the revision message for `edit`, `propose`, and `revert`.
- `--author <word>` sets the author on `propose`. It defaults to `skill`; `add`, `edit`, `revert`, and the TUI write `owner`.

Every command prints its usage with `--help`, for example `flarealoy security --help`.

`apply` keeps every rule that has no `flarewall_` ref, after the Flarealoy rules. It replaces the rules the old `cf-security-setup.sh` script wrote and keeps their rule `id`. Before any write it checks the Free plan limits (5 custom rules, 1 rate limiting rule, 10 redirect rules) on the total of Flarealoy and other rules, and skips a zone that would go over. A failure in one zone is reported, and the run continues with the next zone.

Each backup is one row in the database: the zone's ruleset phases, `always_use_https`, `browser_check`, and Bot Fight Mode as JSON. Flarealoy prints the backup id. Every backup stays; there is no prune.

## Exit codes

| Command | 0 | 1 | 2 |
|---------|---|---|---|
| `security status`, `security diff` | every zone in sync or not managed | a zone has drift or legacy rules | an error, such as an API failure or a bad data file |
| `security apply`, `security restore` | every zone succeeded or was declined | not used | a zone failed (limit, API error, read-back mismatch), a missing token, or a usage error |
| `test-alert` | the channel accepted the message | the delivery failed | no channel is configured, the database is missing, or a usage error |
| `security tui` | quit, and no write failed | not used | a write failed, or stdin is not a terminal |
| every other command | done | not used | an error, a refusal, or a usage error |

## Tokens

Flarealoy reads Cloudflare API tokens from environment variables only, and never writes a token to a file. A `wrangler` or `cf` login will not work, since those OAuth scopes have no access to WAF rules, zone settings, or Bot Management.

| Variable | Used by |
|----------|---------|
| `CLOUDFLARE_API_TOKEN` | The read token: `security add`, `status`, `diff`, the dry runs of `apply` and `restore`, the TUI, and the `security.diff` job. When only `CLOUDFLARE_WRITE_TOKEN` is set, reads use that one. |
| `CLOUDFLARE_WRITE_TOKEN` | The write token: `security apply --write`, `security restore --write`, and the TUI write keys. Without it they refuse, for example with `security apply --write needs CLOUDFLARE_WRITE_TOKEN`. |
| The variable an account names with `--token-env` | The read token for that account, when the main read token cannot see it. Flarealoy stores the variable name, never the token. No command reads it yet: the security commands and the `security.diff` job use `CLOUDFLARE_API_TOKEN`. On the server, the variable also reaches the container only when you add it to the compose `environment:` block. |

On the server, set both tokens as environment values in Dokploy. Make each one a user token scoped to the zones you manage:

| Permission | Read token | Write token | Used by |
|------------|------------|-------------|---------|
| Zone Read | yes | yes | every zone command: the zone list and plan |
| DNS Read | yes | yes | `add` (proxied hostnames), and every check, which renders the rules from the zone's DNS records |
| Zone WAF | Read | Edit | the custom rules and rate limiting rule phases |
| Single Redirect (Dynamic URL Redirects) | Read | Edit | the redirect rules phase |
| Zone Settings | Read | Edit | `always_use_https` and Browser Integrity Check |
| Bot Management | Read | Edit | Bot Fight Mode |

The exact rulesets permission for a zone-level phase read is not yet checked against a live zone. If a read fails with a 403, the error names the phase; add the matching rulesets permission.

## Alerts

Flarealoy sends every alert through one channel, and sends each alert once: it records the dedupe key of each sent alert in the `core_alerts` table and skips a key it already holds. The `security.diff` job sends one alert when a zone enters drift, legacy or error, and one when the zone is back in sync. The first channel is [ntfy](https://ntfy.sh). Configure it with environment variables only:

| Variable | Value |
|----------|-------|
| `FLAREALOY_NTFY_TOPIC` | The ntfy topic. Setting it turns on the ntfy channel. On the public ntfy.sh server, anyone who knows the topic can read it, so pick a long random name. |
| `FLAREALOY_NTFY_URL` | The ntfy server. Default: `https://ntfy.sh`. |
| `FLAREALOY_NTFY_TOKEN` | An access token for a protected topic (optional). Flarealoy sends it as a Bearer token and never writes it to a file. |

Run `flarealoy test-alert` after `flarealoy init` to send one test message.

## The database file

Flarealoy reads and writes one SQLite file. `FLAREALOY_DB` names it. The Docker image sets `FLAREALOY_DB=/data/flarealoy.sqlite`. With no value, the file is `$XDG_DATA_HOME/flarealoy/flarealoy.sqlite`, or `~/.local/share/flarealoy/flarealoy.sqlite` when `XDG_DATA_HOME` is not set. A local file is for development and tests only; keep your real data in the one file on the server.

`FLAREWALL_DB` is gone: setting it stops every `flarealoy` command. `FLAREWALL_DATA` and `--data` are gone too: setting one of them stops every `flarealoy security` command.

The file holds your private data, so Flarealoy creates it with mode `0600` in a directory with mode `0700`. Keep it out of every git repo; this repo's `.gitignore` lists `*.sqlite`.

Flarealoy never copies, syncs, or uploads the file. Back it up with a Dokploy volume backup. `flarealoy export <file>` also writes a JSON text copy, and `flarealoy import <file>` rebuilds a database from it in a new, empty file.

## What the baseline covers

- Block requests to non-standard edge ports.
- Block scanner probes such as `.env`, `/.git`, and `phpinfo`, with exceptions for API hosts and WordPress hosts.
- Challenge traffic from hosting networks, by ASN.
- Challenge traffic from outside one country (optional per zone, off by default).
- A rate limit per IP.
- Redirect rules for HTTP to HTTPS and for www or non-www.
- `always_use_https`, Browser Integrity Check, and Bot Fight Mode where the zone's hosts allow it.

Flarealoy owns only the rules it creates. Each one carries a `ref` that starts with `flarewall_`, the prefix from before the rename, kept so that live rules stay owned. A rule you made by hand in the dashboard stays in place, and `diff` lists it as unowned instead of as drift.

## Your data stays out of this repo

This repo holds code and a generic default baseline. Your accounts, zone inventory, host roles, origin IPs, backups, and drift history live in the database file, outside every repo. See [the database file](#the-database-file).

## Plans

- [docs/plans/0001-plan-flarewall-2026-10-21.md](docs/plans/0001-plan-flarewall-2026-10-21.md): the security baseline tool.
- [docs/plans/0002-plan-flarewall-tui-2026-10-21.md](docs/plans/0002-plan-flarewall-tui-2026-10-21.md): the TUI.
- [docs/plans/0003-plan-d1-data-store-2026-10-21.md](docs/plans/0003-plan-d1-data-store-2026-10-21.md): the SQLite data store.
- [docs/plans/0004-plan-flarealoy-migration-2026-11-25.md](docs/plans/0004-plan-flarealoy-migration-2026-11-25.md): the move from flarewall to Flarealoy, the server and the alerts.

## Stack

TypeScript on Node 22.13 or later, `node:sqlite` for the data store, the official [`cloudflare`](https://github.com/cloudflare/cloudflare-typescript) SDK, Zod for the baseline and inventory schemas, and [Ink](https://github.com/vadimdemedes/ink) for the terminal UI.
