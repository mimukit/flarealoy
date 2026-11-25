// flarealoy account add|list|set|remove: edits the core accounts table. The usage module reads it.
import { parseArgs } from 'node:util';
import {
  AccountError,
  checkAccountId,
  checkLabel,
  checkPlan,
  checkTokenEnv,
  tokenVariable,
  type Account,
  type AccountChange,
  type AccountStore,
} from '../core/accounts.js';
import { StoreError } from '../core/store.js';
import type { Io } from '../modules/security/cli/run.js';

export const ACCOUNT_USAGE = `Usage: flarealoy account <command> [options]

Commands:
  add <account-id> --label <text> --plan free|paid [--token-env <NAME>]
                    Add a Cloudflare account
  list              Print one line per account: ID, plan, token variable, label
  set <account-id> [--label <text>] [--plan free|paid] [--token-env <NAME>]
                    Change an account; --token-env CLOUDFLARE_API_TOKEN goes back to the default
  remove <account-id>
                    Remove an account

Options:
  --label <text>        The account label
  --plan free|paid      The Cloudflare plan of the account
  --token-env <NAME>    The variable that holds the read token of this account
                        (default: CLOUDFLARE_API_TOKEN). flarealoy stores the name, never the token.
  -h, --help            Show this help`;

/** One `account list` line: account ID, plan, token variable, label. */
export function accountLine(account: Account): string {
  return [account.accountId, account.plan, tokenVariable(account), account.label].join('  ');
}

/** Runs `flarealoy account <command>` and returns the exit code. */
export async function runAccount(argv: string[], env: Record<string, string | undefined>, io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        label: { type: 'string' },
        plan: { type: 'string' },
        'token-env': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    io.err((error as Error).message);
    io.err(ACCOUNT_USAGE);
    return 2;
  }
  const [command, ...rest] = parsed.positionals;
  if (parsed.values.help) {
    io.out(ACCOUNT_USAGE);
    return 0;
  }
  const { label, plan, 'token-env': tokenEnv } = parsed.values;
  const noOptions = (name: string): boolean => {
    if (label === undefined && plan === undefined && tokenEnv === undefined) return true;
    io.err(`account ${name} takes no options`);
    return false;
  };

  try {
    // Check the arguments before the database opens, so a usage error needs no file.
    let act: (accounts: AccountStore) => void;
    switch (command) {
      case 'add': {
        if (rest.length !== 1 || rest[0] === undefined) {
          io.err('account add takes one account ID');
          return 2;
        }
        if (label === undefined || plan === undefined) {
          io.err('account add needs --label and --plan');
          return 2;
        }
        const account = { accountId: checkAccountId(rest[0]), label: checkLabel(label), plan: checkPlan(plan), tokenEnv: tokenEnv === undefined ? null : checkTokenEnv(tokenEnv) };
        act = (accounts) => {
          const added = accounts.add(account);
          io.out(`added account ${added.accountId} (${added.plan}, reads ${tokenVariable(added)})`);
        };
        break;
      }
      case 'list': {
        if (rest.length > 0) {
          io.err(`account list takes no arguments, got: ${rest.join(' ')}`);
          return 2;
        }
        if (!noOptions('list')) return 2;
        act = (accounts) => {
          const all = accounts.list();
          if (all.length === 0) io.out('no accounts');
          for (const account of all) io.out(accountLine(account));
        };
        break;
      }
      case 'set': {
        if (rest.length !== 1 || rest[0] === undefined) {
          io.err('account set takes one account ID');
          return 2;
        }
        const accountId = checkAccountId(rest[0]);
        const change: AccountChange = {};
        if (label !== undefined) change.label = checkLabel(label);
        if (plan !== undefined) change.plan = checkPlan(plan);
        if (tokenEnv !== undefined) change.tokenEnv = checkTokenEnv(tokenEnv);
        if (Object.keys(change).length === 0) {
          io.err('account set needs --label, --plan or --token-env');
          return 2;
        }
        act = (accounts) => {
          const changed = accounts.set(accountId, change);
          io.out(`changed account ${changed.accountId}: ${accountLine(changed)}`);
        };
        break;
      }
      case 'remove': {
        if (rest.length !== 1 || rest[0] === undefined) {
          io.err('account remove takes one account ID');
          return 2;
        }
        if (!noOptions('remove')) return 2;
        const accountId = checkAccountId(rest[0]);
        act = (accounts) => {
          accounts.remove(accountId);
          io.out(`removed account ${accountId}`);
        };
        break;
      }
      case undefined:
        io.err(ACCOUNT_USAGE);
        return 2;
      default:
        io.err(`unknown account command: ${command}`);
        io.err(ACCOUNT_USAGE);
        return 2;
    }

    // A dynamic import, so node:sqlite loads only after main.ts filters its warning.
    const { openDatabase, resolveDbPath } = await import('../node/sqlite-store.js');
    const { accountStore } = await import('../node/accounts-store.js');
    const db = openDatabase(resolveDbPath(env));
    try {
      act(accountStore(db));
    } finally {
      db.close();
    }
    return 0;
  } catch (error) {
    if (error instanceof AccountError || error instanceof StoreError) {
      io.err(error.message);
      return 2;
    }
    io.err(`error: ${(error as Error).message ?? String(error)}`);
    return 2;
  }
}
