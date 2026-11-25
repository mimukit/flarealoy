// The ntfy adapter with a fake fetch: no test opens a connection to an ntfy server.
import { describe, expect, it } from 'vitest';
import { NotifierConfigError, type AlertMessage } from '../../src/core/notifier.js';
import { NO_NOTIFIER, notifierFromEnv } from '../../src/node/notifiers.js';
import { headerValue, ntfyNotifier } from '../../src/node/ntfy.js';
import { fakeFetch } from './fake-notifier.js';

const message: AlertMessage = { title: 'example.com drifted', body: 'one rule differs from the baseline', severity: 'critical', dedupeKey: 'k' };

describe('ntfy notifier', () => {
  it('sends one POST to the server and topic with the title, the priority and the body', async () => {
    const { calls, fetch } = fakeFetch();
    const notifier = ntfyNotifier({ server: 'https://ntfy.example.com', topic: 'flarealoy-alerts' }, fetch);
    expect(notifier.name).toBe('ntfy');
    await notifier.send(message);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('https://ntfy.example.com/flarealoy-alerts');
    expect(call?.init.method).toBe('POST');
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.Title).toBe('example.com drifted');
    expect(headers.Priority).toBe('5');
    expect(headers.Authorization).toBeUndefined();
    expect(call?.init.body).toBe('one rule differs from the baseline');
  });

  it('maps info to priority 3 and warning to 4', async () => {
    const { calls, fetch } = fakeFetch();
    const notifier = ntfyNotifier({ server: 'https://ntfy.example.com', topic: 't' }, fetch);
    await notifier.send({ ...message, severity: 'info' });
    await notifier.send({ ...message, severity: 'warning' });
    expect(calls.map((c) => (c.init.headers as Record<string, string>).Priority)).toEqual(['3', '4']);
  });

  it('drops a trailing slash of the server and sends the token as a Bearer token', async () => {
    const { calls, fetch } = fakeFetch();
    await ntfyNotifier({ server: 'https://ntfy.example.com/', topic: 't', token: 'tk_fake' }, fetch).send(message);
    expect(calls[0]?.url).toBe('https://ntfy.example.com/t');
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tk_fake');
  });

  it('encodes a title outside ASCII as an RFC 2047 word', async () => {
    expect(headerValue('plain title')).toBe('plain title');
    expect(headerValue('zone → drift')).toBe(`=?UTF-8?B?${Buffer.from('zone → drift').toString('base64')}?=`);
  });

  it('throws on an HTTP error without the topic or the token in the message', async () => {
    const { fetch } = fakeFetch(403);
    const send = ntfyNotifier({ server: 'https://ntfy.example.com', topic: 'secret-topic', token: 'tk_fake' }, fetch).send(message);
    await expect(send).rejects.toThrow('ntfy: the server answered HTTP 403');
  });

  it('names only the server host when the request fails', async () => {
    const fetch = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof globalThis.fetch;
    const error = await ntfyNotifier({ server: 'https://ntfy.example.com', topic: 'secret-topic' }, fetch)
      .send(message)
      .catch((e: Error) => e);
    expect((error as Error).message).toBe('ntfy: the request to ntfy.example.com failed: connect ECONNREFUSED');
  });

  it('adds the cause of a failed fetch to the message', async () => {
    const fetch = (async () => {
      throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND ntfy.example.com') });
    }) as unknown as typeof globalThis.fetch;
    await expect(ntfyNotifier({ server: 'https://ntfy.example.com', topic: 'secret-topic' }, fetch).send(message)).rejects.toThrow(
      'ntfy: the request to ntfy.example.com failed: fetch failed (getaddrinfo ENOTFOUND ntfy.example.com)',
    );
  });

  it('aborts a request that gets no answer within the time limit', async () => {
    let signal: AbortSignal | undefined;
    const fetch = ((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      // A server that never answers: the promise ends only when the signal aborts.
      return new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    }) as unknown as typeof globalThis.fetch;
    const send = ntfyNotifier({ server: 'https://ntfy.example.com', topic: 'secret-topic', timeoutMs: 20 }, fetch).send(message);
    await expect(send).rejects.toThrow('ntfy: the request to ntfy.example.com failed: no answer within 20 ms');
    expect(signal?.aborted).toBe(true);
  });

  it('gives every request a time limit by default', async () => {
    const { calls, fetch } = fakeFetch();
    await ntfyNotifier({ server: 'https://ntfy.example.com', topic: 't' }, fetch).send(message);
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses a token with a control character', () => {
    for (const token of ['tk_a\nInjected: yes', 'tk_a\r', 'tk_\u0000', 'tk_\u007f']) {
      expect(() => ntfyNotifier({ server: 'https://ntfy.example.com', topic: 't', token }), JSON.stringify(token)).toThrow(
        'FLAREALOY_NTFY_TOKEN must not hold control characters such as a line break',
      );
    }
    expect(() => notifierFromEnv({ FLAREALOY_NTFY_TOPIC: 't', FLAREALOY_NTFY_TOKEN: 'tk_a\nb' })).toThrow(NotifierConfigError);
  });

  it('refuses a bad server URL or topic', () => {
    expect(() => ntfyNotifier({ server: 'ftp://ntfy.example.com', topic: 't' })).toThrow(NotifierConfigError);
    expect(() => ntfyNotifier({ server: 'not a url', topic: 't' })).toThrow('FLAREALOY_NTFY_URL is not a URL');
    expect(() => ntfyNotifier({ server: 'https://ntfy.example.com', topic: 'a/b' })).toThrow('FLAREALOY_NTFY_TOPIC must be');
  });
});

describe('notifierFromEnv', () => {
  it('needs FLAREALOY_NTFY_TOPIC', () => {
    expect(() => notifierFromEnv({})).toThrow(NO_NOTIFIER);
    expect(() => notifierFromEnv({ FLAREALOY_NTFY_TOPIC: '' })).toThrow(NotifierConfigError);
  });

  it('defaults the server to https://ntfy.sh', async () => {
    const { calls, fetch } = fakeFetch();
    await notifierFromEnv({ FLAREALOY_NTFY_TOPIC: 'flarealoy-test' }, fetch).send(message);
    expect(calls[0]?.url).toBe('https://ntfy.sh/flarealoy-test');
  });

  it('reads the server and the token', async () => {
    const { calls, fetch } = fakeFetch();
    await notifierFromEnv({ FLAREALOY_NTFY_TOPIC: 't', FLAREALOY_NTFY_URL: 'https://ntfy.example.com', FLAREALOY_NTFY_TOKEN: 'tk_fake' }, fetch).send(message);
    expect(calls[0]?.url).toBe('https://ntfy.example.com/t');
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tk_fake');
  });
});
