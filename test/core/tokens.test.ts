// The token capability: the read token for an account, the write token, and the write check.
import { describe, expect, it } from 'vitest';
import { READ_TOKEN_MISSING, readToken, requireRead, requireWrite, TokenError, writeToken } from '../../src/core/tokens.js';

describe('readToken', () => {
  it('uses CLOUDFLARE_API_TOKEN, else CLOUDFLARE_WRITE_TOKEN', () => {
    expect(readToken({ CLOUDFLARE_API_TOKEN: 'r', CLOUDFLARE_WRITE_TOKEN: 'w' })).toEqual({ variable: 'CLOUDFLARE_API_TOKEN', value: 'r' });
    expect(readToken({ CLOUDFLARE_WRITE_TOKEN: 'w' })).toEqual({ variable: 'CLOUDFLARE_WRITE_TOKEN', value: 'w' });
    expect(readToken({ CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_WRITE_TOKEN: 'w' })).toEqual({ variable: 'CLOUDFLARE_WRITE_TOKEN', value: 'w' });
    expect(readToken({})).toBeUndefined();
  });

  it('an account with a null token_env follows the default chain', () => {
    expect(readToken({ CLOUDFLARE_API_TOKEN: 'r' }, { tokenEnv: null })).toEqual({ variable: 'CLOUDFLARE_API_TOKEN', value: 'r' });
  });

  it('an account with a token_env reads that variable only', () => {
    expect(readToken({ CLOUDFLARE_API_TOKEN: 'r', OTHER_TOKEN: 'o' }, { tokenEnv: 'OTHER_TOKEN' })).toEqual({ variable: 'OTHER_TOKEN', value: 'o' });
    expect(readToken({ CLOUDFLARE_API_TOKEN: 'r' }, { tokenEnv: 'OTHER_TOKEN' })).toBeUndefined();
    expect(() => requireRead({ CLOUDFLARE_API_TOKEN: 'r' }, { tokenEnv: 'OTHER_TOKEN' })).toThrow('OTHER_TOKEN is not set; this account reads its Cloudflare token from OTHER_TOKEN');
  });

  it('requireRead names both variables when none is set', () => {
    expect(() => requireRead({})).toThrow(new TokenError(READ_TOKEN_MISSING));
  });
});

describe('write token', () => {
  it('reads CLOUDFLARE_WRITE_TOKEN only', () => {
    expect(writeToken({ CLOUDFLARE_API_TOKEN: 'r' })).toBeUndefined();
    expect(writeToken({ CLOUDFLARE_WRITE_TOKEN: 'w' })).toEqual({ variable: 'CLOUDFLARE_WRITE_TOKEN', value: 'w' });
  });

  it('requireWrite names the command', () => {
    expect(() => requireWrite({ CLOUDFLARE_API_TOKEN: 'r' }, 'security apply --write')).toThrow('security apply --write needs CLOUDFLARE_WRITE_TOKEN');
    expect(requireWrite({ CLOUDFLARE_WRITE_TOKEN: 'w' }, 'x').value).toBe('w');
  });
});
