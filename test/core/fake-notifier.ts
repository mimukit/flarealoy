// A fake alert channel for tests: it records every message it sends, and can fail on demand.
import type { AlertMessage, Notifier } from '../../src/core/notifier.js';

export interface FakeNotifier extends Notifier {
  sent: AlertMessage[];
  /** When set, the next sends throw this error and record nothing. */
  failWith?: Error;
}

export function fakeNotifier(): FakeNotifier {
  const fake: FakeNotifier = {
    name: 'fake',
    sent: [],
    async send(message) {
      if (fake.failWith !== undefined) throw fake.failWith;
      fake.sent.push(message);
    },
  };
  return fake;
}

/** A fake fetch that records each call and answers with `status`. It never opens a connection. */
export function fakeFetch(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(status === 200 ? '{}' : 'error', { status });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}
