import test from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  ApiError,
  subscribeApiTrace,
  getSession,
  setSession,
  loadSession,
  saveSession,
  type StoredSession,
  type ApiTrace,
} from '../../web/src/lib/api';

test('API client explains a proxy HTML error instead of exposing a JSON parser error', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>Bad gateway</html>', { status: 502 });
  try {
    await assert.rejects(
      () => api.auth.login({ email: 'alice@example.com', password: 'unused' }),
      (error: unknown) =>
        error instanceof ApiError && error.status === 502 && error.code === 'INVALID_RESPONSE'
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('API client reports a network failure with safe payment retry guidance', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  try {
    await assert.rejects(
      () => api.auth.login({ email: 'alice@example.com', password: 'unused' }),
      (error: unknown) =>
        error instanceof ApiError &&
        error.code === 'NETWORK_ERROR' &&
        error.message.includes('same payment key')
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('request tracing reports HTTP metadata and isolates failed observers', async () => {
  const original = globalThis.fetch;
  const events: ApiTrace[] = [];
  const stopBroken = subscribeApiTrace(() => {
    throw new Error('observer failure');
  });
  const stop = subscribeApiTrace((event) => events.push(event));
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'X-Request-Id': 'test-request-id' },
    });
  try {
    assert.deepEqual(await api.accounts.list(), []);
    assert.equal(events.length, 2);
    assert.equal(events[0].phase, 'request');
    assert.equal(events[1].status, 200);
    assert.equal(events[1].requestId, 'test-request-id');
    assert.equal(events[0].id, events[1].id);
    assert.equal('body' in events[0], false);
    assert.equal('headers' in events[0], false);
  } finally {
    stopBroken();
    stop();
    globalThis.fetch = original;
  }
});

test('request tracing excludes authentication endpoints and credentials', async () => {
  const original = globalThis.fetch;
  const events: ApiTrace[] = [];
  const stop = subscribeApiTrace((event) => events.push(event));
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: { accessToken: 'secret-access', refreshToken: 'secret-refresh' } }), {
      status: 200,
    });
  try {
    await api.auth.login({ email: 'private@example.com', password: 'private-password' });
    assert.deepEqual(events, []);
  } finally {
    stop();
    globalThis.fetch = original;
  }
});

function storageHarness() {
  const descriptors = ['localStorage', 'sessionStorage'].map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const
  );
  const local = new Map<string, string>();
  const tab = new Map<string, string>();
  for (const [name, map] of [
    ['localStorage', local],
    ['sessionStorage', tab],
  ] as const) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => map.set(key, value),
        removeItem: (key: string) => map.delete(key),
      },
    });
  }
  return {
    local,
    tab,
    restore: () => {
      setSession(null);
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}
const exampleSession: StoredSession = {
  accessToken: 'access',
  refreshToken: 'refresh',
  user: { id: 'user-1', email: 'user@example.com', roles: ['USER'], status: 'ACTIVE' },
};

test('tokens persist only in tab storage and legacy persistent copies are removed', () => {
  const storage = storageHarness();
  try {
    storage.local.set('ledger.session', JSON.stringify(exampleSession));
    saveSession(exampleSession);
    assert.equal(storage.local.has('ledger.session'), false);
    assert.deepEqual(loadSession(), exampleSession);
    assert.equal(storage.tab.has('ledger.session'), true);
  } finally {
    storage.restore();
  }
});

test('malformed stored sessions cannot create a trusted client session', () => {
  const storage = storageHarness();
  try {
    storage.tab.set('ledger.session', JSON.stringify({ ...exampleSession, user: { roles: 'ADMIN' } }));
    assert.equal(loadSession(), null);
    assert.equal(storage.tab.has('ledger.session'), false);
  } finally {
    storage.restore();
  }
});

test('a refresh response arriving after logout cannot restore the old session', async () => {
  const storage = storageHarness();
  const original = globalThis.fetch;
  let release!: (response: Response) => void;
  let started!: () => void;
  const refreshStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/auth/refresh')) {
      started();
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }
    return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Expired' } }), {
      status: 401,
    });
  };
  try {
    setSession(exampleSession);
    const request = api.accounts.list();
    await refreshStarted;
    setSession(null);
    release(
      new Response(JSON.stringify({ data: { accessToken: 'new-access', refreshToken: 'new-refresh' } }), {
        status: 200,
      })
    );
    await assert.rejects(request, (error: unknown) => error instanceof ApiError && error.status === 401);
    assert.equal(getSession(), null);
    assert.equal(storage.tab.has('ledger.session'), false);
  } finally {
    globalThis.fetch = original;
    storage.restore();
  }
});
