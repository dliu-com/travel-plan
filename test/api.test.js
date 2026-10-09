'use strict';

const SITE_URL = 'https://plan.dliu.com';
process.env.SITE_URL = SITE_URL;

const auth = require('../lambda/api/auth');
const { createHandler } = require('../lambda/api/index');
const { NotConfigured } = require('../lambda/api/config');
const { createMemoryStore } = require('../scripts/memory-store');

const NOW = Date.UTC(2026, 9, 1);
const config = { tenantId: 'tenant', clientId: 'client', clientSecret: 'secret', allowedDomain: 'dliu.com' };

function setup() {
  const store = createMemoryStore({ now: () => new Date(NOW).toISOString() });
  const handler = createHandler({ store, loadConfig: async () => config, now: () => NOW });
  const session = auth.sign({ user: 'dewei@dliu.com', name: 'Dewei', exp: NOW / 1000 + 3600 }, auth.sessionKey(config));

  function call(method, path, { body, signedIn = true, origin = SITE_URL, contentType = 'application/json' } = {}) {
    const headers = {};
    if (origin) headers.origin = origin;
    if (body !== undefined) headers['content-type'] = contentType;
    return handler({
      rawPath: path.split('?')[0],
      queryStringParameters: Object.fromEntries(new URL(path, SITE_URL).searchParams),
      headers,
      cookies: signedIn ? [`${auth.SESSION_COOKIE}=${session}`] : [],
      requestContext: { http: { method } },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }).then((res) => ({ ...res, json: res.body ? JSON.parse(res.body.startsWith('<') ? '{}' : res.body) : {} }));
  }

  return { store, call };
}

async function createTrip(call, fields = {}) {
  const res = await call('POST', '/api/trips', { body: { title: 'Kyoto', startDate: '2026-11-12', endDate: '2026-11-16', ...fields } });
  expect(res.statusCode).toBe(201);
  return res.json;
}

describe('/api/me', () => {
  test('reports signed-in state', async () => {
    const { call } = setup();
    expect((await call('GET', '/api/me')).json).toEqual({ signedIn: true, user: 'dewei@dliu.com', name: 'Dewei' });
    expect((await call('GET', '/api/me', { signedIn: false })).json).toEqual({ signedIn: false });
  });

  test('works before secrets are configured', async () => {
    const handler = createHandler({ store: createMemoryStore(), loadConfig: async () => { throw new NotConfigured('missing'); } });
    const res = await handler({ rawPath: '/api/me', requestContext: { http: { method: 'GET' } } });
    expect(JSON.parse(res.body)).toEqual({ signedIn: false, configured: false });
  });
});

describe('private trips', () => {
  test('anonymous visitors cannot list, read or change trips', async () => {
    const { call } = setup();
    const trip = await createTrip(call);
    for (const [method, path, body] of [
      ['GET', '/api/trips'],
      ['GET', `/api/trips/${trip.id}`],
      ['POST', '/api/trips', { title: 'x' }],
      ['PUT', `/api/trips/${trip.id}`, { title: 'x' }],
      ['DELETE', `/api/trips/${trip.id}`],
      ['POST', `/api/trips/${trip.id}/share`],
      ['POST', `/api/trips/${trip.id}/events`, { title: 'x' }],
    ]) {
      const res = await call(method, path, { body, signedIn: false });
      expect(res.statusCode).toBe(401);
    }
  });

  test('writes must come from the site itself', async () => {
    const { call } = setup();
    expect((await call('POST', '/api/trips', { body: { title: 'x' }, origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await call('POST', '/api/trips', { body: { title: 'x' }, origin: null })).statusCode).toBe(403);
    expect((await call('POST', '/api/trips', { body: 'title=x', contentType: 'application/x-www-form-urlencoded' })).statusCode).toBe(415);
    expect((await call('POST', '/api/trips', { body: 'x'.repeat(70 * 1024) })).statusCode).toBe(413);
  });

  test('create, list, edit and delete a trip', async () => {
    const { call } = setup();
    const trip = await createTrip(call, { intro: 'Leaves' });
    expect(trip).toMatchObject({ title: 'Kyoto', events: [], shareToken: '', updatedBy: 'Dewei' });

    const list = await call('GET', '/api/trips');
    expect(list.json.trips).toEqual([expect.objectContaining({ id: trip.id, excerpt: 'Leaves', shared: false })]);

    const updated = await call('PUT', `/api/trips/${trip.id}`, { body: { title: 'Kyoto & Osaka' } });
    expect(updated.json.title).toBe('Kyoto & Osaka');
    expect((await call('PUT', `/api/trips/${trip.id}`, { body: { title: '' } })).statusCode).toBe(400);

    expect((await call('DELETE', `/api/trips/${trip.id}`)).statusCode).toBe(200);
    expect((await call('GET', `/api/trips/${trip.id}`)).statusCode).toBe(404);
  });

  test('unknown and malformed ids are 404s', async () => {
    const { call } = setup();
    expect((await call('GET', '/api/trips/nope-0000000000')).statusCode).toBe(404);
    expect((await call('GET', '/api/trips/BAD!')).statusCode).toBe(404);
    expect((await call('GET', '/api/whatever')).statusCode).toBe(404);
  });
});

describe('events', () => {
  test('add, edit and delete events', async () => {
    const { call } = setup();
    const trip = await createTrip(call);
    const added = await call('POST', `/api/trips/${trip.id}/events`, { body: { title: 'Inari', date: '2026-11-13', time: '06:30' } });
    expect(added.statusCode).toBe(201);
    const { eventId } = added.json;
    expect(added.json.trip.events).toEqual([expect.objectContaining({ id: eventId, title: 'Inari' })]);

    const edited = await call('PUT', `/api/trips/${trip.id}/events/${eventId}`, { body: { title: 'Inari at dawn', time: '06:00' } });
    expect(edited.json.trip.events[0]).toMatchObject({ title: 'Inari at dawn', time: '06:00', date: '' });

    expect((await call('PUT', `/api/trips/${trip.id}/events/missing-event`, { body: { title: 'x' } })).statusCode).toBe(404);
    expect((await call('POST', `/api/trips/${trip.id}/events`, { body: { title: 'x', link: 'javascript:alert(1)' } })).statusCode).toBe(400);

    const deleted = await call('DELETE', `/api/trips/${trip.id}/events/${eventId}`);
    expect(deleted.json.trip.events).toEqual([]);
  });
});

describe('share links', () => {
  test('friends can read a shared trip without signing in, until sharing stops', async () => {
    const { call } = setup();
    const trip = await createTrip(call);
    await call('POST', `/api/trips/${trip.id}/events`, { body: { title: 'Inari' } });

    const shared = await call('POST', `/api/trips/${trip.id}/share`);
    const token = shared.json.shareToken;
    expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect((await call('POST', `/api/trips/${trip.id}/share`)).json.shareToken).toBe(token);

    const view = await call('GET', `/api/shared/${token}`, { signedIn: false });
    expect(view.statusCode).toBe(200);
    expect(view.json).toMatchObject({ title: 'Kyoto', events: [expect.objectContaining({ title: 'Inari' })] });
    expect(view.json).not.toHaveProperty('id');
    expect(view.json).not.toHaveProperty('shareToken');
    expect(view.json).not.toHaveProperty('updatedBy');
    expect(view.json).not.toHaveProperty('tripId');

    const member = await call('GET', `/api/shared/${token}`);
    expect(member.json.tripId).toBe(trip.id);
    expect((await call('GET', '/api/trips', { signedIn: false })).statusCode).toBe(401);

    await call('DELETE', `/api/trips/${trip.id}/share`);
    expect((await call('GET', `/api/shared/${token}`, { signedIn: false })).statusCode).toBe(404);

    const again = await call('POST', `/api/trips/${trip.id}/share`);
    expect(again.json.shareToken).not.toBe(token);
  });

  test('bad tokens are 404s', async () => {
    const { call } = setup();
    expect((await call('GET', '/api/shared/short', { signedIn: false })).statusCode).toBe(404);
    expect((await call('GET', `/api/shared/${'A'.repeat(24)}`, { signedIn: false })).statusCode).toBe(404);
  });
});

describe('auth routes', () => {
  test('login remembers where to return and logout clears the session', async () => {
    const { call } = setup();
    const login = await call('GET', '/auth/login?return=/trips/kyoto-abcdefghij', { signedIn: false });
    expect(login.statusCode).toBe(302);
    expect(login.headers.location).toMatch(/^https:\/\/login\.microsoftonline\.com\/tenant\//);

    const logout = await call('GET', '/auth/logout?return=//evil.example');
    expect(logout.statusCode).toBe(302);
    expect(logout.headers.location).toBe('/');
    expect(logout.cookies.join(';')).toMatch(new RegExp(`${auth.SESSION_COOKIE}=;`));
  });

  test('safeReturnPath only allows local paths', () => {
    expect(auth.safeReturnPath('/trips/x')).toBe('/trips/x');
    expect(auth.safeReturnPath('//evil.example')).toBe('/');
    expect(auth.safeReturnPath('https://evil.example')).toBe('/');
    expect(auth.safeReturnPath('/a b')).toBe('/');
    expect(auth.safeReturnPath(undefined)).toBe('/');
  });
});
