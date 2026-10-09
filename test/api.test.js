'use strict';

const SITE_URL = 'https://plan.dliu.com';
process.env.SITE_URL = SITE_URL;

const auth = require('../lambda/api/auth');
const { createHandler } = require('../lambda/api/index');
const { NotConfigured } = require('../lambda/api/config');
const { createMemoryFiles } = require('../scripts/memory-files');
const { createMemoryStore } = require('../scripts/memory-store');

const NOW = Date.UTC(2026, 9, 1);
const config = { tenantId: 'tenant', clientId: 'client', clientSecret: 'secret', allowedDomain: 'dliu.com' };

function setup() {
  const store = createMemoryStore({ now: () => new Date(NOW).toISOString() });
  const files = createMemoryFiles();
  const handler = createHandler({ store, files, loadConfig: async () => config, now: () => NOW });
  const session = auth.sign({ user: 'dewei@dliu.com', name: 'Dewei', exp: NOW / 1000 + 3600 }, auth.sessionKey(config));

  function call(method, path, { body, signedIn = true, origin = SITE_URL, contentType = 'application/json', token } = {}) {
    const headers = {};
    if (token) headers['x-plan-token'] = token;
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

  return { store, files, call };
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
    expect(trip).toMatchObject({ id: '20261000', title: 'Kyoto', events: [], files: [], shareToken: '', updatedBy: 'Dewei' });

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
    expect((await call('GET', '/api/trips/20991299')).statusCode).toBe(404);
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
  async function sharedTrip(call) {
    const trip = await createTrip(call);
    await call('POST', `/api/trips/${trip.id}/events`, { body: { title: 'Inari' } });
    const shared = await call('POST', `/api/trips/${trip.id}/share`);
    return { trip, token: shared.json.shareToken };
  }

  test('anyone with the link can view and edit that trip, until sharing stops', async () => {
    const { call } = setup();
    const { trip, token } = await sharedTrip(call);
    expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect((await call('POST', `/api/trips/${trip.id}/share`)).json.shareToken).toBe(token);

    const guest = { signedIn: false, token };
    const view = await call('GET', `/api/trips/${trip.id}`, guest);
    expect(view.statusCode).toBe(200);
    expect(view.json).toMatchObject({ title: 'Kyoto', events: [expect.objectContaining({ title: 'Inari' })] });
    // Images and downloads pass the token in the address instead.
    expect((await call('GET', `/api/trips/${trip.id}?token=${token}`, { signedIn: false })).statusCode).toBe(200);

    const edited = await call('PUT', `/api/trips/${trip.id}`, { ...guest, body: { title: 'Kyoto & Nara', intro: 'Hi' } });
    expect(edited.json).toMatchObject({ title: 'Kyoto & Nara', updatedBy: 'share-link' });
    const added = await call('POST', `/api/trips/${trip.id}/events`, { ...guest, body: { title: 'Deer park' } });
    expect(added.statusCode).toBe(201);
    expect((await call('PUT', `/api/trips/${trip.id}/events/${added.json.eventId}`, { ...guest, body: { title: 'Nara deer' } })).statusCode).toBe(200);
    expect((await call('DELETE', `/api/trips/${trip.id}/events/${added.json.eventId}`, guest)).statusCode).toBe(200);

    await call('DELETE', `/api/trips/${trip.id}/share`);
    expect((await call('GET', `/api/trips/${trip.id}`, guest)).statusCode).toBe(403);
    expect((await call('PUT', `/api/trips/${trip.id}`, { ...guest, body: { title: 'x' } })).statusCode).toBe(403);

    const again = await call('POST', `/api/trips/${trip.id}/share`);
    expect(again.json.shareToken).not.toBe(token);
  });

  test('the link only opens its own trip and cannot manage trips', async () => {
    const { call } = setup();
    const { trip, token } = await sharedTrip(call);
    const other = await createTrip(call, { title: 'Lisbon' });
    const guest = { signedIn: false, token };
    expect((await call('GET', `/api/trips/${other.id}`, guest)).statusCode).toBe(403);
    expect((await call('PUT', `/api/trips/${other.id}`, { ...guest, body: { title: 'x' } })).statusCode).toBe(403);
    expect((await call('GET', '/api/trips', guest)).statusCode).toBe(401);
    expect((await call('POST', '/api/trips', { ...guest, body: { title: 'x' } })).statusCode).toBe(401);
    expect((await call('DELETE', `/api/trips/${trip.id}`, guest)).statusCode).toBe(403);
    expect((await call('POST', `/api/trips/${trip.id}/share`, guest)).statusCode).toBe(403);
    expect((await call('DELETE', `/api/trips/${trip.id}/share`, guest)).statusCode).toBe(403);
    // Writes with a token still have to come from the site.
    expect((await call('PUT', `/api/trips/${trip.id}`, { ...guest, origin: 'https://evil.example', body: { title: 'x' } })).statusCode).toBe(403);
    expect((await call('GET', `/api/trips/${trip.id}`)).json.title).toBe('Kyoto');
  });

  test('wrong or malformed tokens are refused', async () => {
    const { call } = setup();
    const { trip, token } = await sharedTrip(call);
    for (const bad of ['A'.repeat(24), token.slice(1), `${token}x`, 'short']) {
      expect((await call('GET', `/api/trips/${trip.id}`, { signedIn: false, token: bad })).statusCode).toBe(403);
    }
    const unshared = await createTrip(call);
    expect((await call('GET', `/api/trips/${unshared.id}`, { signedIn: false, token })).statusCode).toBe(403);
  });

  test('old /s/<token> links find their trip', async () => {
    const { call } = setup();
    const { trip, token } = await sharedTrip(call);
    const found = await call('GET', `/api/shared/${token}`, { signedIn: false });
    expect(found.json).toEqual({ id: trip.id });
    expect((await call('GET', '/api/shared/short', { signedIn: false })).statusCode).toBe(404);
    expect((await call('GET', `/api/shared/${'A'.repeat(24)}`, { signedIn: false })).statusCode).toBe(404);
  });
});

describe('files', () => {
  async function upload(call, files, tripId, { name = 'ticket.pdf', type = 'application/pdf', body = '%PDF-1', ...options } = {}) {
    const start = await call('POST', `/api/trips/${tripId}/files`, { ...options, body: { name, size: Buffer.byteLength(body), type } });
    expect(start.statusCode).toBe(201);
    expect(start.json.uploadHeaders).toEqual({ 'content-type': type });
    files.put(new URL(start.json.uploadUrl, SITE_URL).pathname.replace('/dev-files/', ''), body, type);
    return { fileId: start.json.fileId, done: await call('PUT', `/api/trips/${tripId}/files/${start.json.fileId}`, { ...options, body: { name } }) };
  }

  test('attach, open, rename and remove files', async () => {
    const { call, files } = setup();
    const trip = await createTrip(call);

    const { fileId, done } = await upload(call, files, trip.id);
    expect(done.statusCode).toBe(201);
    expect(done.json.trip.files).toEqual([{ id: fileId, name: 'ticket.pdf', size: 6, type: 'application/pdf', createdAt: expect.any(String) }]);
    expect([...files.objects.keys()]).toEqual([`trips/${trip.id}/${fileId}`]);

    const open = await call('GET', `/api/trips/${trip.id}/files/${fileId}`);
    expect(open.statusCode).toBe(302);
    expect(new URL(open.headers.location, SITE_URL).searchParams.get('response-content-disposition')).toMatch(/^inline; filename="ticket.pdf"/);
    const download = await call('GET', `/api/trips/${trip.id}/files/${fileId}?download=1`);
    expect(decodeURIComponent(download.headers.location)).toContain('attachment;');

    const renamed = await call('PUT', `/api/trips/${trip.id}/files/${fileId}`, { body: { name: 'boarding.pdf' } });
    expect(renamed.json.trip.files[0]).toEqual(expect.objectContaining({ name: 'boarding.pdf' }));

    expect((await call('DELETE', `/api/trips/${trip.id}/files/${fileId}`)).json.trip.files).toEqual([]);
    expect(files.objects.size).toBe(0);
    expect((await call('GET', `/api/trips/${trip.id}/files/${fileId}`)).statusCode).toBe(404);
  });

  test('share-link guests can attach and open files on their trip only', async () => {
    const { call, files } = setup();
    const trip = await createTrip(call);
    const token = (await call('POST', `/api/trips/${trip.id}/share`)).json.shareToken;
    const { fileId, done } = await upload(call, files, trip.id, { signedIn: false, token, name: 'map.png', type: 'image/png', body: 'png' });
    expect(done.json.trip.files[0]).toMatchObject({ name: 'map.png', type: 'image/png' });
    expect((await call('GET', `/api/trips/${trip.id}/files/${fileId}?token=${token}`, { signedIn: false })).statusCode).toBe(302);
    expect((await call('GET', `/api/trips/${trip.id}/files/${fileId}`, { signedIn: false })).statusCode).toBe(401);
    expect((await call('DELETE', `/api/trips/${trip.id}/files/${fileId}`, { signedIn: false, token })).statusCode).toBe(200);
  });

  test('uploads are checked', async () => {
    const { call, files } = setup();
    const trip = await createTrip(call);
    const post = (body) => call('POST', `/api/trips/${trip.id}/files`, { body });
    expect((await post({ name: 'x', size: 0 })).statusCode).toBe(400);
    expect((await post({ name: 'x', size: 60 * 1024 * 1024 })).statusCode).toBe(400);
    // Confirming before anything was uploaded.
    const start = await post({ name: 'x', size: 1 });
    expect((await call('PUT', `/api/trips/${trip.id}/files/${start.json.fileId}`, { body: { name: 'x' } })).statusCode).toBe(404);
    expect((await call('GET', `/api/trips/${trip.id}/files/..%2F..%2Fsecret`)).statusCode).toBe(404);
    // Whatever type the browser claimed, script-like files are served as downloads.
    const { fileId } = await upload(call, files, trip.id, { name: 'x.html', type: 'text/html', body: '<script>alert(1)</script>' });
    const open = await call('GET', `/api/trips/${trip.id}/files/${fileId}`);
    const params = new URL(open.headers.location, SITE_URL).searchParams;
    expect(params.get('response-content-type')).toBe('application/octet-stream');
    expect(params.get('response-content-disposition')).toMatch(/^attachment;/);
  });

  test('deleting a trip removes its files', async () => {
    const { call, files } = setup();
    const trip = await createTrip(call);
    await upload(call, files, trip.id);
    await upload(call, files, trip.id, { name: 'b.pdf' });
    expect(files.objects.size).toBe(2);
    expect((await call('DELETE', `/api/trips/${trip.id}`)).statusCode).toBe(200);
    expect(files.objects.size).toBe(0);
  });
});

describe('auth routes', () => {
  test('login remembers where to return and logout clears the session', async () => {
    const { call } = setup();
    const login = await call('GET', '/auth/login?return=/plan/20261000', { signedIn: false });
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
