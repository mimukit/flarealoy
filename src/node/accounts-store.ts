// Node-only adapter: the core accounts table on the one flarealoy database (node:sqlite). The
// platform store (src/node/sqlite-store.ts) opens the file and runs the core migration that
// creates core_accounts.
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { ACCOUNT_SQL, AccountError, type Account, type AccountChange, type AccountStore, type NewAccount, type Plan } from '../core/accounts.js';

type Row = Record<string, SQLInputValue>;

function toAccount(row: Row): Account {
  return {
    id: Number(row.id),
    accountId: row.account_id as string,
    label: row.label as string,
    plan: row.plan as Plan,
    limits: row.limits as string | null,
    tokenEnv: row.token_env as string | null,
  };
}

function missing(accountId: string): AccountError {
  return new AccountError(`no account ${accountId}; list them with flarealoy account list`);
}

export function accountStore(db: DatabaseSync): AccountStore {
  const get = (accountId: string): Account | undefined => {
    const row = db.prepare(ACCOUNT_SQL.get).get(accountId) as Row | undefined;
    return row === undefined ? undefined : toAccount(row);
  };
  return {
    list: () => (db.prepare(ACCOUNT_SQL.list).all() as Row[]).map(toAccount),
    get,
    add(account: NewAccount): Account {
      if (get(account.accountId) !== undefined) throw new AccountError(`account ${account.accountId} already exists; change it with flarealoy account set`);
      db.prepare(ACCOUNT_SQL.insert).run(account.accountId, account.label, account.plan, account.tokenEnv);
      return get(account.accountId) as Account;
    },
    set(accountId: string, change: AccountChange): Account {
      const current = get(accountId);
      if (current === undefined) throw missing(accountId);
      const next = { ...current, ...change };
      db.prepare(ACCOUNT_SQL.update).run(next.label, next.plan, next.tokenEnv, accountId);
      return get(accountId) as Account;
    },
    remove(accountId: string): void {
      if (get(accountId) === undefined) throw missing(accountId);
      db.prepare(ACCOUNT_SQL.remove).run(accountId);
    },
  };
}
