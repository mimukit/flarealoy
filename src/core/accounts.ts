// The core inventory, version 1: the Cloudflare accounts. Each account has its Cloudflare account
// ID, a label, the plan (free or paid), optional limit overrides as JSON (the usage plan defines
// their shape), and the variable that holds its read token (null means CLOUDFLARE_API_TOKEN).
// The Node adapter (src/node/accounts-store.ts) runs ACCOUNT_SQL on node:sqlite.
// Core module: no Node-only API here, so a Worker can run it.
import { z } from 'zod';
import type { StoreTable } from './store.js';
import { READ_TOKEN } from './tokens.js';

export const PLANS = ['free', 'paid'] as const;
export type Plan = (typeof PLANS)[number];

export interface Account {
  id: number;
  accountId: string;
  label: string;
  plan: Plan;
  /** The limit overrides as JSON text; null when the account uses the plan limits. */
  limits: string | null;
  /** The variable that holds the read token; null means CLOUDFLARE_API_TOKEN. */
  tokenEnv: string | null;
}

export interface NewAccount {
  accountId: string;
  label: string;
  plan: Plan;
  tokenEnv: string | null;
}

/** The fields `account set` changes; an absent field stays as it is. */
export interface AccountChange {
  label?: string;
  plan?: Plan;
  tokenEnv?: string | null;
}

/** A wrong account argument or a missing account. The CLI prints the message and exits 2. */
export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountError';
  }
}

/** The accounts table as the store sees it. */
export interface AccountStore {
  list(): Account[];
  get(accountId: string): Account | undefined;
  add(account: NewAccount): Account;
  set(accountId: string, change: AccountChange): Account;
  remove(accountId: string): void;
}

const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const VARIABLE = /^[A-Z_][A-Z0-9_]*$/;

/** A Cloudflare account ID: 32 lowercase hex characters. */
export function checkAccountId(value: string): string {
  if (!ACCOUNT_ID.test(value)) throw new AccountError(`not a Cloudflare account ID: ${value}; it has 32 lowercase hex characters`);
  return value;
}

export function checkLabel(value: string): string {
  const label = value.trim();
  if (label === '') throw new AccountError('the label is empty');
  return label;
}

export function checkPlan(value: string): Plan {
  if (!(PLANS as readonly string[]).includes(value)) throw new AccountError(`the plan is free or paid, got: ${value}`);
  return value as Plan;
}

/**
 * The variable name for --token-env. CLOUDFLARE_API_TOKEN gives null, because null means that
 * variable; this is also how `account set` goes back to the default token.
 */
export function checkTokenEnv(value: string): string | null {
  if (!VARIABLE.test(value)) throw new AccountError(`not an environment variable name: ${value}`);
  return value === READ_TOKEN ? null : value;
}

/** The variable that holds the read token of an account. */
export function tokenVariable(account: Pick<Account, 'tokenEnv'>): string {
  return account.tokenEnv ?? READ_TOKEN;
}

/** The core_accounts table in the export: its columns in order and the schema of one row. */
export const ACCOUNTS_TABLE: StoreTable = {
  columns: ['id', 'account_id', 'label', 'plan', 'limits', 'token_env'],
  row: z.strictObject({
    id: z.number().int().positive(),
    account_id: z.string().regex(ACCOUNT_ID),
    label: z.string().min(1),
    plan: z.enum(PLANS),
    limits: z.string().nullable(),
    token_env: z.string().regex(VARIABLE).nullable(),
  }),
};

/** The core migration that creates core_accounts. CORE_MIGRATIONS lists it. */
export const ACCOUNTS_MIGRATION = `
CREATE TABLE core_accounts (
  id INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('free', 'paid')),
  limits TEXT CHECK (limits IS NULL OR json_valid(limits)),
  token_env TEXT
);
`;

export const ACCOUNT_SQL = {
  list: `SELECT id, account_id, label, plan, limits, token_env FROM core_accounts ORDER BY id`,
  get: `SELECT id, account_id, label, plan, limits, token_env FROM core_accounts WHERE account_id = ?`,
  insert: `INSERT INTO core_accounts (account_id, label, plan, token_env) VALUES (?, ?, ?, ?)`,
  update: `UPDATE core_accounts SET label = ?, plan = ?, token_env = ? WHERE account_id = ?`,
  remove: `DELETE FROM core_accounts WHERE account_id = ?`,
} as const;
