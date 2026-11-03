'use strict';

// The managed API: Microsoft access tokens through API Gateway (lambda/api/api-access.js).
// Every identifier and token here is synthetic.
const SITE_URL = 'https://plan.dliu.com';
const GATEWAY = 'gw0000test';
const TENANT = '00000000-0000-4000-8000-000000000001';
const CLIENT = '00000000-0000-4000-8000-000000000002';
const OID = '00000000-0000-4000-8000-0000000000aa';
Object.assign(process.env, {
  SITE_URL, API_GATEWAY_ID: GATEWAY, API_TENANT_ID: TENANT, API_AUDIENCE: CLIENT, API_CLIENT_ID: CLIENT,
});

const fs = require('fs');
const path = require('path');
const auth = require('../lambda/api/auth');
const api = require('../lambda/api/index');
const pdf = require('../lambda/pdf/index');
const { authorize, isManaged, parseRoles, ROLE, ROUTES } = require('../lambda/api/api-access');
const { uploadKey } = require('../lambda/api/s3');
const { routeKey } = require('../scripts/api-client');
const { createMemoryFiles } = require('../scripts/memory-files');
const { createMemoryStore } = require('../scripts/memory-store');

const NOW = Date.UTC(2026, 9, 1);
const config = { tenantId: 'tenant', clientId: 'client', clientSecret: 'secret', allowedDomain: 'dliu.com' };
const ALL_SCOPES = ['trip.read', 'trip.write', 'trip.delete'];

const goodClaims = () => ({
  ver: '2.0',
  iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
  tid: TENANT,
  aud: CLIENT,
  azp: CLIENT,
  oid: OID,
  sub: 'synthetic-subject',
  roles: '[api.access]',
  preferred_username: 'agent@dliu.com',
  name: 'Agent User',
});

function managedEvent(method, url, { scopes = ALL_SCOPES, claims = goodClaims(), key, body, headers = {}, cookies, jwt = true, apiId = GATEWAY } = {}) {
  const rawPath = url.split('?')[0];
  return {
    version: '2.0',
    routeKey: key || routeKey(method, rawPath) || `${method} ${rawPath}`,
    rawPath,
    queryStringParameters: Object.fromEntries(new URL(url, SITE_URL).searchParams),
    headers: { authorization: 'Bearer synthetic.token.value', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(cookies ? { cookies } : {}),
    requestContext: {
      apiId,
      routeKey: key || routeKey(method, rawPath) || `${method} ${rawPath}`,
      http: { method },
      ...(jwt ? { authorizer: { jwt: { claims, scopes } } } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function setup() {
  const store = createMemoryStore({ now: () => new Date(NOW).toISOString() });
  const files = createMemoryFiles({ base: 'https://bucket.s3.eu-west-1.amazonaws.com' });
  const loadConfig = jest.fn(async () => config);
  const deps = { store, files, loadConfig, now: () => NOW };
  const apiHandler = api.createHandler(deps);
  const pdfHandler = pdf.createHandler(deps);
  const session = auth.sign({ typ: 'session', user: 'member@example.com', name: 'Dewei', exp: NOW / 1000 + 3600 }, auth.sessionKey(config));
  const parse = (res) => ({ ...res, json: (res.headers['content-type'] || '').startsWith('application/json') ? JSON.parse(res.body) : undefined });

  const managed = async (method, url, options = {}) => {
    const handler = /\/pdf$/.test(url.split('?')[0]) && !options.toApi ? pdfHandler : apiHandler;
    return parse(await handler(managedEvent(method, url, options)));
  };
  // The website: CloudFront and the function URL ($default route), with the session cookie.
  const website = async (method, url, { body, signedIn = true, token } = {}) => parse(await apiHandler({
    rawPath: url.split('?')[0],
    queryStringParameters: Object.fromEntries(new URL(url, SITE_URL).searchParams),
    headers: { origin: SITE_URL, ...(token ? { 'x-plan-token': token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    cookies: signedIn ? [`${auth.SESSION_COOKIE}=${session}`] : [],
    requestContext: { apiId: 'functionurl', routeKey: '$default', http: { method } },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { store, files, loadConfig, managed, website, session };
}

describe('route contract', () => {
  test('one shared User-only role for every dliu.com managed API', () => {
    expect(ROLE).toBe('api.access');
  });

  test('exactly the published routes, each with one trip scope', () => {
    expect(ROUTES).toEqual({
      'GET /api/me': { scope: 'trip.read' },
      'GET /api/trips': { scope: 'trip.read' },
      'POST /api/trips': { scope: 'trip.write' },
      'GET /api/trips/{tripId}': { scope: 'trip.read' },
      'PUT /api/trips/{tripId}': { scope: 'trip.write' },
      'DELETE /api/trips/{tripId}': { scope: 'trip.delete' },
      'POST /api/trips/{tripId}/events': { scope: 'trip.write' },
      'PUT /api/trips/{tripId}/events/{eventId}': { scope: 'trip.write' },
      'DELETE /api/trips/{tripId}/events/{eventId}': { scope: 'trip.delete' },
      'POST /api/trips/{tripId}/files': { scope: 'trip.write' },
      'GET /api/trips/{tripId}/files/{fileId}': { scope: 'trip.read' },
      'PUT /api/trips/{tripId}/files/{fileId}': { scope: 'trip.write' },
      'DELETE /api/trips/{tripId}/files/{fileId}': { scope: 'trip.delete' },
      'GET /api/trips/{tripId}/pdf': { scope: 'trip.read', function: 'pdf' },
    });
    for (const [key, { scope }] of Object.entries(ROUTES)) {
      if (key.startsWith('DELETE ')) expect(scope).toBe('trip.delete');
      expect(key).not.toMatch(/share|shared|auth/);
    }
  });
});

describe('parseRoles', () => {
  test.each([
    ['[api.access]', ['api.access']],
    ['[video.access api.access]', ['video.access', 'api.access']],
    ['[]', []],
    ['["api.access"]', ['api.access']],
    ['api.access', ['api.access']],
    [['api.access'], ['api.access']],
  ])('accepts %p', (input, expected) => expect(parseRoles(input)).toEqual(expected));

  test.each([
    ['[ api.access]'], ['[api.access  other]'], ['["api.access"'], ['api.access other'], ['[trip."access]'],
    [42], [null], [undefined], [{ 0: 'api.access' }], [[1]],
  ])('refuses %p', (input) => expect(parseRoles(input)).toBeNull());
});

describe('authorize', () => {
  const event = (claims, scopes = ['trip.read'], apiId = GATEWAY) => ({ requestContext: { apiId, authorizer: { jwt: { claims, scopes } } } });

  test('accepts a Microsoft user token for the dliu API with the role and scope', () => {
    expect(authorize(event(goodClaims()), 'trip.read')).toEqual({ user: OID, name: 'Agent User' });
    expect(authorize(event({ ...goodClaims(), roles: ['other', 'api.access'] }), 'trip.read').user).toBe(OID);
  });

  // preferred_username is mutable and not for authorization: an assigned token is accepted whatever it says.
  test.each([
    ['no preferred_username', { preferred_username: undefined }, 'Agent User'],
    ['a non-email preferred_username', { preferred_username: 'agent' }, 'Agent User'],
    ['another domain', { preferred_username: 'agent@example.com' }, 'Agent User'],
    ['a look-alike domain', { preferred_username: 'agent@dliu.com.example.com' }, 'Agent User'],
    ['no name or username', { preferred_username: undefined, name: undefined }, OID],
  ])('accepts an assigned token with %s, identified by oid', (_, change, name) => {
    expect(authorize(event({ ...goodClaims(), ...change }), 'trip.read')).toEqual({ user: OID, name });
  });

  test.each([
    ['another gateway', {}, 'other-gateway'],
    ['a v1 token', { ver: '1.0' }],
    ['the v1 issuer', { iss: `https://sts.windows.net/${TENANT}/` }],
    ['another tenant issuer', { iss: 'https://login.microsoftonline.com/common/v2.0' }],
    ['another tenant', { tid: '00000000-0000-4000-8000-000000000009' }],
    ['another audience', { aud: '00000000-0000-4000-8000-000000000009' }],
    ['Microsoft Graph', { aud: '00000003-0000-0000-c000-000000000000' }],
    ['no oid', { oid: undefined }],
    ['no sub', { sub: '' }],
  ])('401 for %s', (_, change, apiId = GATEWAY) => {
    expect(authorize(event({ ...goodClaims(), ...change }, ['trip.read'], apiId), 'trip.read'))
      .toEqual({ status: 401, error: 'Microsoft access token required' });
  });

  test.each([
    ['another client', { azp: '00000000-0000-4000-8000-000000000009' }],
    ['no role', { roles: undefined }],
    ['another site role', { roles: '[video.access]' }],
    ['the old site-specific role alone', { roles: '[trip.access]' }],
    ['the old role as an array', { roles: ['trip.access'] }],
    ['the old role as a bare value', { roles: 'trip.access' }],
    ['a scope-shaped role', { roles: '[trip.read trip.write trip.delete]' }],
    ['a differently cased role', { roles: '[Api.Access]' }],
    ['a longer role name', { roles: '[api.access.admin]' }],
    ['an unparseable role claim', { roles: '[api.access ]' }],
    ['a dliu.com username but no role', { roles: undefined, preferred_username: 'agent@dliu.com' }],
    ['a role in another claim', { roles: undefined, scp: 'api.access', wids: ['api.access'] }],
  ])('403 for %s', (_, change) => {
    expect(authorize(event({ ...goodClaims(), ...change }), 'trip.read'))
      .toEqual({ status: 403, error: 'Travel plan API permission required' });
  });

  test('403 without the exact route scope', () => {
    expect(authorize(event(goodClaims(), ['trip.write']), 'trip.read').status).toBe(403);
    expect(authorize(event(goodClaims(), ['trip.write']), 'trip.delete').status).toBe(403);
    expect(authorize(event(goodClaims(), ['trip.read.all']), 'trip.read').status).toBe(403);
    expect(authorize(event(goodClaims(), 'trip.read'), 'trip.read').status).toBe(403);
  });

  test('401 when the function is not configured for the gateway', () => {
    const saved = process.env.API_GATEWAY_ID;
    delete process.env.API_GATEWAY_ID;
    try {
      expect(authorize(event(goodClaims()), 'trip.read').status).toBe(401);
    } finally {
      process.env.API_GATEWAY_ID = saved;
    }
  });

  test('only gateway routes count as managed, never the website function URL', () => {
    expect(isManaged(managedEvent('GET', '/api/trips'))).toBe(true);
    expect(isManaged(managedEvent('GET', '/api/trips', { jwt: false }))).toBe(true);
    expect(isManaged({ requestContext: { apiId: 'x', routeKey: '$default', http: { method: 'GET' } } })).toBe(false);
    expect(isManaged({ requestContext: { http: { method: 'GET' } } })).toBe(false);
    expect(isManaged({ headers: { authorization: 'Bearer x' } })).toBe(false);
  });
});

describe('managed API', () => {
  test('/api/me identifies the token user without the website sign-in settings', async () => {
    const { managed, loadConfig } = setup();
    const res = await managed('GET', '/api/me');
    expect(res.statusCode).toBe(200);
    expect(res.json).toEqual({ signedIn: true, user: OID, name: 'Agent User' });
    expect(loadConfig).not.toHaveBeenCalled();
  });

  test('members-equivalent: sees and edits every travel plan, including ones made on the website', async () => {
    const { managed, website, loadConfig } = setup();
    const before = loadConfig.mock.calls.length;
    const mine = await website('POST', '/api/trips', { body: { title: 'Kyoto' } });
    expect(mine.statusCode).toBe(201);
    const created = await managed('POST', '/api/trips', { body: { title: 'Lisbon', travellers: 'A, B' } });
    expect(created.statusCode).toBe(201);
    expect(created.json.updatedBy).toBe('Agent User');
    const list = await managed('GET', '/api/trips');
    expect(list.json.trips.map((t) => t.title).sort()).toEqual(['Kyoto', 'Lisbon']);
    const edited = await managed('PUT', `/api/trips/${mine.json.id}`, { body: { title: 'Kyoto and Nara' } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json.title).toBe('Kyoto and Nara');
    expect((await website('GET', `/api/trips/${mine.json.id}`)).json.updatedBy).toBe('Agent User');
    // Website calls load the sign-in settings; the managed calls didn't add any.
    expect(loadConfig.mock.calls.length - before).toBe(2);
  });

  test('events: write scope adds and edits, only the delete scope deletes', async () => {
    const { managed } = setup();
    const trip = (await managed('POST', '/api/trips', { body: { title: 'Kyoto' } })).json;
    const added = await managed('POST', `/api/trips/${trip.id}/events`, { body: { title: 'Train', date: '2026-11-12', time: '09:30' } });
    expect(added.statusCode).toBe(201);
    const eventPath = `/api/trips/${trip.id}/events/${added.json.eventId}`;
    expect((await managed('PUT', eventPath, { body: { title: 'Fast train' }, scopes: ['trip.write'] })).json.trip.events[0].title).toBe('Fast train');
    expect((await managed('DELETE', eventPath, { scopes: ['trip.read', 'trip.write'] })).statusCode).toBe(403);
    const deleted = await managed('DELETE', eventPath, { scopes: ['trip.delete'] });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json.trip.events).toEqual([]);
  });

  test('an assigned token without an email-style username can use the API, and is identified by oid', async () => {
    const { managed } = setup();
    const claims = { ...goodClaims(), preferred_username: undefined, name: 'Agent User' };
    expect((await managed('GET', '/api/me', { claims })).json).toEqual({ signedIn: true, user: OID, name: 'Agent User' });
    const created = await managed('POST', '/api/trips', { body: { title: 'Oslo' }, claims: { ...claims, preferred_username: 'agent' } });
    expect(created.statusCode).toBe(201);
    expect(created.json.updatedBy).toBe('Agent User');
    expect((await managed('GET', '/api/trips', { claims: { ...claims, tid: '00000000-0000-4000-8000-000000000009' } })).statusCode).toBe(401);
    expect((await managed('GET', '/api/trips', { claims: { ...claims, roles: '[]' } })).statusCode).toBe(403);
    expect((await managed('GET', '/api/trips', { claims, scopes: ['trip.write'] })).statusCode).toBe(403);
  });

  test('the shared api.access role is required, and never stands in for a scope', async () => {
    const { managed } = setup();
    const trip = (await managed('POST', '/api/trips', { body: { title: 'Kyoto' } })).json;
    const oldRole = { ...goodClaims(), roles: '[trip.access]' };
    expect((await managed('GET', `/api/trips/${trip.id}`, { claims: oldRole })).statusCode).toBe(403);
    expect((await managed('GET', `/api/trips/${trip.id}`, { claims: { ...goodClaims(), roles: '[trip.access api.access]' } })).statusCode).toBe(200);
    expect((await managed('GET', `/api/trips/${trip.id}`, { scopes: [] })).statusCode).toBe(403);
    expect((await managed('DELETE', `/api/trips/${trip.id}`, { scopes: ['trip.read', 'trip.write'] })).statusCode).toBe(403);
    expect((await managed('GET', `/api/trips/${trip.id}/pdf`, { claims: oldRole })).statusCode).toBe(403);
  }, 20000);

  test('read scope cannot write, write scope cannot read-only routes beyond its own', async () => {
    const { managed } = setup();
    expect((await managed('POST', '/api/trips', { body: { title: 'x' }, scopes: ['trip.read'] })).statusCode).toBe(403);
    expect((await managed('POST', '/api/trips', { body: { title: 'x' }, scopes: ['trip.delete'] })).statusCode).toBe(403);
    expect((await managed('GET', '/api/trips', { scopes: ['trip.write', 'trip.delete'] })).statusCode).toBe(403);
    expect((await managed('GET', '/api/me', { scopes: [] })).statusCode).toBe(403);
  });

  test('deleting a travel plan needs trip.delete and removes its files', async () => {
    const { managed, files } = setup();
    const trip = (await managed('POST', '/api/trips', { body: { title: 'Kyoto' } })).json;
    expect((await managed('DELETE', `/api/trips/${trip.id}`, { scopes: ['trip.read', 'trip.write'] })).statusCode).toBe(403);
    const started = await managed('POST', `/api/trips/${trip.id}/files`, { body: { name: 'a.txt', size: 3, type: 'text/plain' } });
    files.put(uploadKey(trip.id, started.json.fileId), 'abc', 'text/plain');
    await managed('PUT', `/api/trips/${trip.id}/files/${started.json.fileId}`, { body: { name: 'a.txt' } });
    const res = await managed('DELETE', `/api/trips/${trip.id}`, { scopes: ['trip.delete'] });
    expect(res.statusCode).toBe(200);
    expect(res.json).toEqual({ deleted: trip.id });
    expect(files.objects.size).toBe(0);
    expect((await managed('GET', `/api/trips/${trip.id}`)).statusCode).toBe(404);
  });

  test('attachments: upload, keep, rename, download link as data (no redirect), delete with trip.delete', async () => {
    const { managed, files } = setup();
    const trip = (await managed('POST', '/api/trips', { body: { title: 'Kyoto' } })).json;
    const started = await managed('POST', `/api/trips/${trip.id}/files`, { body: { name: 'booking.pdf', size: 5, type: 'application/pdf' }, scopes: ['trip.write'] });
    expect(started.statusCode).toBe(201);
    expect(started.json).toEqual({ fileId: expect.any(String), uploadUrl: expect.stringContaining('https://'), uploadHeaders: { 'content-type': 'application/pdf' } });
    const filePath = `/api/trips/${trip.id}/files/${started.json.fileId}`;
    expect((await managed('PUT', filePath, { body: { name: 'booking.pdf' } })).statusCode).toBe(404);
    files.put(uploadKey(trip.id, started.json.fileId), 'hello', 'application/pdf');
    const kept = await managed('PUT', filePath, { body: { name: 'booking.pdf' } });
    expect(kept.statusCode).toBe(201);
    expect(kept.json.trip.files).toEqual([expect.objectContaining({ id: started.json.fileId, name: 'booking.pdf', size: 5 })]);
    expect((await managed('PUT', filePath, { body: { name: 'Hotel.pdf' } })).json.trip.files[0].name).toBe('Hotel.pdf');

    const link = await managed('GET', `${filePath}?download=1`, { scopes: ['trip.read'] });
    expect(link.statusCode).toBe(200);
    expect(link.headers.location).toBeUndefined();
    expect(link.json).toEqual({
      url: expect.stringContaining('response-content-disposition=attachment'),
      expiresIn: 300,
      file: { id: started.json.fileId, name: 'Hotel.pdf', size: 5, type: 'application/pdf' },
    });

    expect((await managed('DELETE', filePath, { scopes: ['trip.write'] })).statusCode).toBe(403);
    const deleted = await managed('DELETE', filePath, { scopes: ['trip.delete'] });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json.trip.files).toEqual([]);
  });

  test('reading a plan returns its share link as a ready-to-open address, never the bare token field', async () => {
    const { managed, website } = setup();
    const trip = (await website('POST', '/api/trips', { body: { title: 'Kyoto' } })).json;
    const { shareToken } = trip;
    expect(shareToken).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const shareUrl = `${SITE_URL}/plan/${trip.id}?token=${shareToken}`;
    const read = await managed('GET', `/api/trips/${trip.id}`);
    expect(read.statusCode).toBe(200);
    expect(read.json.shareUrl).toBe(shareUrl);
    expect(read.json).not.toHaveProperty('shareToken');
    expect(read.json).not.toHaveProperty('shared');
    // Plans returned by writes carry it too; summaries in the list do not.
    expect((await managed('PUT', `/api/trips/${trip.id}`, { body: { title: 'Kyoto 2' } })).json.shareUrl).toBe(shareUrl);
    expect((await managed('POST', `/api/trips/${trip.id}/events`, { body: { title: 'Temple' } })).json.trip.shareUrl).toBe(shareUrl);
    const list = await managed('GET', '/api/trips');
    expect(list.body).not.toContain(shareToken);
    expect(list.body).not.toContain('shareToken');
    // Every gate still applies: no scope or no role, no link.
    for (const options of [{ scopes: ['trip.write'] }, { claims: { ...goodClaims(), roles: '[]' } }, { jwt: false }]) {
      const denied = await managed('GET', `/api/trips/${trip.id}`, options);
      expect(denied.statusCode).toBeGreaterThanOrEqual(401);
      expect(denied.body).not.toContain(shareToken);
    }
    // The link opens the plan on the website without signing in.
    expect((await website('GET', `/api/trips/${trip.id}`, { signedIn: false, token: shareToken })).statusCode).toBe(200);
  });

  test('an expired link is not returned, and the API cannot create one', async () => {
    const { managed, website, store } = setup();
    const trip = (await website('POST', '/api/trips', { body: { title: 'Kyoto' } })).json;
    expect((await managed('GET', `/api/trips/${trip.id}`)).json.shareExpiresAt).toBe('2027-01-01T00:00:00.000Z');
    store.trips.get(trip.id).shareExpiresAt = '2026-09-01T00:00:00.000Z';
    const read = await managed('GET', `/api/trips/${trip.id}`);
    expect(read.json.shareUrl).toBeNull();
    expect(read.body).not.toContain(trip.shareToken);
    expect((await managed('POST', `/api/trips/${trip.id}/share`)).statusCode).toBe(404);
    expect(store.trips.get(trip.id).shareToken).toBe(trip.shareToken);
  });

  test('a plan made before every plan had a link gets one when the API reads it', async () => {
    const { managed, website, store } = setup();
    const trip = (await website('POST', '/api/trips', { body: { title: 'Kyoto' } })).json;
    delete store.trips.get(trip.id).shareToken;
    const read = await managed('GET', `/api/trips/${trip.id}`);
    expect(read.json.shareUrl).toBe(`${SITE_URL}/plan/${trip.id}?token=${store.trips.get(trip.id).shareToken}`);
  });

  test('share links, sign-in and unpublished routes are not reachable through the gateway', async () => {
    const { managed, website } = setup();
    const trip = (await website('POST', '/api/trips', { body: { title: 'Kyoto' } })).json;
    const { shareToken } = trip;
    for (const [method, url] of [
      ['POST', `/api/trips/${trip.id}/share`],
      ['DELETE', `/api/trips/${trip.id}/share`],
      ['GET', `/api/shared/${shareToken}`],
      ['GET', '/auth/login'],
      ['GET', '/auth/callback'],
      ['GET', '/auth/logout'],
    ]) {
      const res = await managed(method, url);
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain(shareToken);
    }
    // A route key whose method doesn't match, or the PDF route on the API function, is refused too.
    expect((await managed('DELETE', `/api/trips/${trip.id}`, { key: 'GET /api/trips/{tripId}' })).statusCode).toBe(404);
    expect((await managed('GET', `/api/trips/${trip.id}/pdf`, { toApi: true })).statusCode).toBe(404);
    expect((await website('GET', `/api/trips/${trip.id}`)).json.shareToken).toBe(shareToken);
  });

  test('no website cookie, share token or forged header stands in for the Microsoft token', async () => {
    const { managed, website, session } = setup();
    const trip = (await website('POST', '/api/trips', { body: { title: 'Kyoto' } })).json;
    const { shareToken } = trip;
    const cookies = [`${auth.SESSION_COOKIE}=${session}`];
    for (const options of [
      { jwt: false, cookies },
      { jwt: false, headers: { 'x-plan-token': shareToken } },
      { jwt: false, headers: { authorization: 'Bearer anything' } },
      { claims: { ...goodClaims(), roles: '[]' }, cookies },
      { apiId: 'another-api', cookies },
    ]) {
      const res = await managed('GET', `/api/trips/${trip.id}`, options);
      expect([401, 403]).toContain(res.statusCode);
    }
  });

  test('keeps the JSON and size checks, but bearer requests need no Origin', async () => {
    const { managed } = setup();
    const ok = await managed('POST', '/api/trips', { body: { title: 'x' }, headers: { origin: 'https://elsewhere.example' } });
    expect(ok.statusCode).toBe(201);
    expect((await managed('POST', '/api/trips', { body: { title: 'x' }, headers: { 'content-type': 'text/plain' } })).statusCode).toBe(415);
    expect((await managed('POST', '/api/trips', { body: { title: 'x'.repeat(70000) } })).statusCode).toBe(413);
    expect((await managed('POST', '/api/trips', { body: { title: '' } })).statusCode).toBe(400);
  });

  test('managed callers do not use share-link allowances', async () => {
    const { managed, store } = setup();
    const useQuota = jest.spyOn(store, 'useQuota');
    const trip = (await managed('POST', '/api/trips', { body: { title: 'Kyoto' } })).json;
    await managed('GET', `/api/trips/${trip.id}`);
    await managed('PUT', `/api/trips/${trip.id}`, { body: { title: 'K' } });
    await managed('GET', `/api/trips/${trip.id}/pdf`);
    expect(useQuota).not.toHaveBeenCalled();
  });

  test('PDF export through the gateway needs trip.read and only its own route', async () => {
    const { managed, loadConfig } = setup();
    const trip = (await managed('POST', '/api/trips', { body: { title: 'Kyoto' } })).json;
    const res = await managed('GET', `/api/trips/${trip.id}/pdf?lang=zh`, { scopes: ['trip.read'] });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(res.body, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    expect((await managed('GET', `/api/trips/${trip.id}/pdf`, { scopes: ['trip.write'] })).statusCode).toBe(403);
    expect((await managed('GET', `/api/trips/${trip.id}/pdf`, { jwt: false })).statusCode).toBe(401);
    expect((await managed('GET', `/api/trips/${trip.id}/pdf`, { key: 'GET /api/trips/{tripId}' })).statusCode).toBe(404);
    expect((await managed('GET', '/api/trips/20990199/pdf')).statusCode).toBe(404);
    expect(loadConfig).not.toHaveBeenCalled();
  }, 20000);

  test('errors are logged without the token, claims or headers', async () => {
    const { managed, store } = setup();
    jest.spyOn(store, 'listTrips').mockRejectedValue(new Error('boom'));
    const logged = [];
    const spies = ['log', 'info', 'warn', 'error'].map((level) => jest.spyOn(console, level).mockImplementation((...args) => logged.push(args.join(' '))));
    try {
      expect((await managed('GET', '/api/trips')).statusCode).toBe(500);
      expect((await managed('GET', '/api/trips', { claims: { ...goodClaims(), roles: '[]' } })).statusCode).toBe(403);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
    const text = logged.join('\n');
    expect(text).toContain('boom');
    expect(text).not.toMatch(/synthetic|Bearer|authorization|agent@dliu\.com|0000000000aa/i);
  });
});

describe('website sign-in is unchanged', () => {
  test('cookie sessions and the same-origin rule still apply off the gateway', async () => {
    const { website } = setup();
    expect((await website('GET', '/api/me')).json).toEqual({ signedIn: true, user: 'member@example.com', name: 'Dewei' });
    expect((await website('GET', '/api/trips', { signedIn: false })).statusCode).toBe(401);
    const trip = (await website('POST', '/api/trips', { body: { title: 'Kyoto' } })).json;
    expect(trip.shareToken).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(trip).not.toHaveProperty('shareUrl');
  });

  test('a bearer token or forged authorizer claims on the website are ignored', async () => {
    const { store, files } = setup();
    const handler = api.createHandler({ store, files, loadConfig: async () => config, now: () => NOW });
    const res = await handler({
      rawPath: '/api/trips',
      headers: { authorization: 'Bearer synthetic.token.value', origin: SITE_URL },
      cookies: [],
      requestContext: { apiId: 'functionurl', routeKey: '$default', http: { method: 'GET' } },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('API docs', () => {
  const docs = fs.readFileSync(path.join(__dirname, '../web/docs/api.md'), 'utf8');

  test('document every managed route with its scope, and link the shared auth docs', () => {
    for (const [key, { scope }] of Object.entries(ROUTES)) {
      expect(docs).toContain(`### ${key}`);
      expect(docs).toContain(`| [${key}](#`);
      const section = docs.split(`### ${key}`)[1].split('\n### ')[0];
      expect(section).toContain(`Required scope: \`${scope}\``);
    }
    expect(docs).toContain('https://auth.dliu.com/docs/api');
    expect(docs).toContain('__TRIP_API_URL__');
    expect(docs).toContain('`api.access`');
    expect(docs).toContain('`trip.access` role is not accepted');
    expect(docs).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  test('render safely as HTML-free nodes', () => {
    const { render } = loadRenderer();
    const root = render(docs);
    // The page's <h1> is the document title; its sections are h2 and below.
    expect(root.querySelectorAll('h1').length).toBe(0);
    expect(root.querySelectorAll('h2').length).toBeGreaterThan(5);
    expect(root.querySelectorAll('table').length).toBeGreaterThan(2);
    expect(root.querySelectorAll('pre').length).toBeGreaterThan(2);
    const evil = render('Hello <img src=x onerror=alert(1)> [x](javascript:alert(1)) `code`');
    expect(evil.querySelectorAll('img, a').length).toBe(0);
  });
});

// docs-api.js is a browser script; give it a tiny DOM so it can run here.
function loadRenderer() {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; }
    setAttribute(name, value) { this.attrs[name] = value; }
    append(...items) { this.children.push(...items); }
    querySelectorAll(selector) {
      const tags = selector.split(',').map((s) => s.trim());
      const found = [];
      const walk = (node) => {
        for (const child of node.children) {
          if (child instanceof Node) {
            if (tags.includes(child.tag)) found.push(child);
            walk(child);
          }
        }
      };
      walk(this);
      return found;
    }
  }
  const module = { exports: {} };
  const document = { createElement: (tag) => new Node(tag) };
  // eslint-disable-next-line no-new-func
  new Function('module', 'document', fs.readFileSync(path.join(__dirname, '../web/docs-api.js'), 'utf8'))(module, document);
  return module.exports;
}
