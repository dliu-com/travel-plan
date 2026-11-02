'use strict';

// scripts/api-client.js with synthetic credential files and a fake fetch. Never touches ~/.dliu_token.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClient, main, readAccessToken, readConfig, routeKey, storageUrl } = require('../scripts/api-client');

const NOW = Date.UTC(2026, 9, 1, 12);
const API = 'https://gw0000test.execute-api.eu-west-1.amazonaws.com';
const S3 = 'https://bucket.s3.eu-west-1.amazonaws.com';
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (exp = NOW / 1000 + 3600) => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ exp })}.c2lnbmF0dXJl`;
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trip-api-client-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function credentialFile(content) {
  const file = path.join(dir, 'token');
  fs.writeFileSync(file, content);
  return file;
}

function response(status, body, headers = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    text: async () => bytes.toString(),
    json: async () => JSON.parse(bytes.toString()),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  };
}

function fakeFetch(handlers) {
  const calls = [];
  const fetchImpl = jest.fn(async (url, options = {}) => {
    calls.push({ url, ...options });
    const handler = handlers.shift();
    if (!handler) throw new Error(`unexpected fetch ${url}`);
    return handler(url, options);
  });
  return { fetchImpl, calls };
}

describe('readConfig', () => {
  test('needs an HTTPS API origin', () => {
    expect(() => readConfig({})).toThrow('Set TRIP_API_URL');
    for (const url of ['http://api.example', 'https://api.example/prod', 'https://u:p@api.example', 'https://api.example/?x=1']) {
      expect(() => readConfig({ TRIP_API_URL: url, TRIP_API_ACCESS_TOKEN: 'abc' })).toThrow('HTTPS API origin');
    }
    expect(readConfig({ TRIP_API_URL: `${API}/`, TRIP_API_ACCESS_TOKEN: 'abc.def' })).toEqual({ endpoint: API, accessToken: 'abc.def' });
  });

  test('uses the default credential file under HOME, or an absolute override', () => {
    expect(readConfig({ TRIP_API_URL: API, HOME: '/home/someone' })).toEqual({ endpoint: API, credentialFile: '/home/someone/.dliu_token' });
    expect(readConfig({ TRIP_API_URL: API, TRIP_API_TOKEN_FILE: '/tmp/x' }).credentialFile).toBe('/tmp/x');
    expect(() => readConfig({ TRIP_API_URL: API, TRIP_API_TOKEN_FILE: 'relative' })).toThrow('absolute');
  });

  test('refuses tokens with header-breaking characters', () => {
    expect(() => readConfig({ TRIP_API_URL: API, TRIP_API_ACCESS_TOKEN: 'abc\r\nx-evil: 1' })).toThrow('bearer-token characters');
    expect(() => readConfig({ TRIP_API_URL: API, TRIP_API_ACCESS_TOKEN: '' })).toThrow('bearer-token characters');
  });
});

describe('readAccessToken', () => {
  test('reads a saved, unexpired token', () => {
    const token = jwt();
    const file = credentialFile(`token=${token}\nexpires_at=${iso(NOW + 3600000)}\n`);
    expect(readAccessToken({ credentialFile: file }, NOW)).toBe(token);
  });

  test('refuses expired tokens by either clock', () => {
    expect(() => readAccessToken({ credentialFile: credentialFile(`token=${jwt()}\nexpires_at=${iso(NOW - 1000)}\n`) }, NOW)).toThrow('expired');
    expect(() => readAccessToken({ credentialFile: credentialFile(`token=${jwt(NOW / 1000 - 1)}\nexpires_at=${iso(NOW + 3600000)}\n`) }, NOW)).toThrow('expired');
  });

  test.each([
    ['a missing file', null],
    ['an extra line', `token=${jwt()}\nexpires_at=${iso(NOW + 3600000)}\nother=1\n`],
    ['a duplicate token', `token=${jwt()}\ntoken=${jwt()}\nexpires_at=${iso(NOW + 3600000)}\n`],
    ['no expiry', `token=${jwt()}\n`],
    ['a non-JWT token', `token=opaque\nexpires_at=${iso(NOW + 3600000)}\n`],
    ['a local-time expiry', `token=${jwt()}\nexpires_at=2026-10-01T13:00:00+01:00\n`],
    ['an impossible date', `token=${jwt()}\nexpires_at=2026-02-30T13:00:00Z\n`],
  ])('refuses %s', (_, content) => {
    const file = content === null ? path.join(dir, 'missing') : credentialFile(content);
    expect(() => readAccessToken({ credentialFile: file }, NOW)).toThrow(/credential file|auth\.dliu\.com/i);
  });

  test('error messages never include the token', () => {
    const token = jwt(NOW / 1000 - 1);
    try {
      readAccessToken({ credentialFile: credentialFile(`token=${token}\nexpires_at=${iso(NOW + 3600000)}\n`) }, NOW);
    } catch (error) {
      expect(error.message).not.toContain(token);
    }
  });
});

describe('routes', () => {
  test('match only published routes', () => {
    expect(routeKey('GET', '/api/me')).toBe('GET /api/me');
    expect(routeKey('PUT', '/api/trips/20261101')).toBe('PUT /api/trips/{tripId}');
    expect(routeKey('DELETE', '/api/trips/20261101/events/abc_1-2')).toBe('DELETE /api/trips/{tripId}/events/{eventId}');
    expect(routeKey('GET', '/api/trips/20261101/pdf')).toBe('GET /api/trips/{tripId}/pdf');
    for (const [method, apiPath] of [
      ['POST', '/api/trips/20261101/share'], ['GET', '/api/shared/abc'], ['GET', '/auth/login'],
      ['PATCH', '/api/trips/20261101'], ['GET', '/api/trips/../me'], ['GET', '/api/trips/a/b'], ['GET', '/api/me/'],
    ]) expect(routeKey(method, apiPath)).toBeNull();
  });

  test('storage URLs must be plain HTTPS S3', () => {
    expect(storageUrl(`${S3}/k?X-Amz-Signature=1`)).toBe(`${S3}/k?X-Amz-Signature=1`);
    expect(storageUrl('https://bucket.s3.amazonaws.com/k')).toBe('https://bucket.s3.amazonaws.com/k');
    for (const url of ['http://bucket.s3.eu-west-1.amazonaws.com/k', 'https://evil.example/k', 'https://s3.amazonaws.com.evil.example/k',
      'https://u:p@bucket.s3.eu-west-1.amazonaws.com/k', `${API}/k`]) {
      expect(() => storageUrl(url)).toThrow('Unexpected storage URL');
    }
  });
});

describe('client', () => {
  const config = { endpoint: API, accessToken: 'synthetic.access.token' };

  test('sends the bearer token only to the managed API, and never follows redirects', async () => {
    const { fetchImpl, calls } = fakeFetch([() => response(200, { trips: [] })]);
    const result = await createClient(config, { fetchImpl }).request('GET', '/api/trips');
    expect(result).toEqual({ trips: [] });
    expect(calls[0]).toMatchObject({ url: `${API}/api/trips`, method: 'GET', redirect: 'error', headers: { authorization: 'Bearer synthetic.access.token' } });
  });

  test('refuses unpublished routes before any network call', async () => {
    const { fetchImpl } = fakeFetch([]);
    const client = createClient(config, { fetchImpl });
    await expect(client.request('POST', '/api/trips/20261101/share')).rejects.toThrow('Unknown');
    await expect(client.request('GET', '/api/trips/20261101/files/f1')).rejects.toThrow('download');
    await expect(client.request('POST', '/api/trips/20261101/files', {})).rejects.toThrow('upload');
    await expect(client.request('GET', '/api/trips/20261101/pdf')).rejects.toThrow('pdf');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('reports API errors from the app or the gateway', async () => {
    const { fetchImpl } = fakeFetch([() => response(403, { error: 'Travel plan API permission required' }), () => response(401, { message: 'Unauthorized' })]);
    const client = createClient(config, { fetchImpl });
    await expect(client.request('GET', '/api/trips')).rejects.toThrow('Travel plan API 403: Travel plan API permission required');
    await expect(client.request('GET', '/api/trips')).rejects.toThrow('Travel plan API 401: Unauthorized');
  });

  test('upload: start, PUT to storage without the bearer token, then keep', async () => {
    const local = path.join(dir, 'Booking.PDF');
    fs.writeFileSync(local, 'hello');
    const { fetchImpl, calls } = fakeFetch([
      () => response(201, { fileId: 'f1', uploadUrl: `${S3}/uploads/x?X-Amz-Signature=1`, uploadHeaders: { 'content-type': 'application/pdf' } }),
      () => response(200, ''),
      () => response(201, { trip: { files: [{ id: 'f1', name: 'Hotel.pdf', size: 5 }] } }),
    ]);
    const result = await createClient(config, { fetchImpl }).upload('20261101', local, 'Hotel.pdf');
    expect(result).toEqual({ fileId: 'f1', file: { id: 'f1', name: 'Hotel.pdf', size: 5 } });
    expect(calls[0]).toMatchObject({ url: `${API}/api/trips/20261101/files`, method: 'POST', body: JSON.stringify({ name: 'Hotel.pdf', size: 5, type: 'application/pdf' }) });
    expect(calls[1]).toMatchObject({ url: `${S3}/uploads/x?X-Amz-Signature=1`, method: 'PUT', redirect: 'error', headers: { 'content-type': 'application/pdf' } });
    expect(JSON.stringify(calls[1].headers)).not.toMatch(/authorization|synthetic/i);
    expect(calls[2]).toMatchObject({ url: `${API}/api/trips/20261101/files/f1`, method: 'PUT', body: JSON.stringify({ name: 'Hotel.pdf' }) });
  });

  test('upload refuses a storage URL that is not S3, without sending the file', async () => {
    const local = path.join(dir, 'a.txt');
    fs.writeFileSync(local, 'abc');
    const { fetchImpl } = fakeFetch([() => response(201, { fileId: 'f1', uploadUrl: 'https://evil.example/x', uploadHeaders: {} })]);
    await expect(createClient(config, { fetchImpl }).upload('20261101', local)).rejects.toThrow('Unexpected storage URL');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('download: link from the API, bytes from storage without the bearer token, never overwrites', async () => {
    const out = path.join(dir, 'out.pdf');
    const link = () => response(200, { url: `${S3}/files/x?X-Amz-Signature=1`, expiresIn: 300, file: { id: 'f1', name: 'a.pdf', size: 3, type: 'application/pdf' } });
    const { fetchImpl, calls } = fakeFetch([link, () => response(200, Buffer.from('abc')), link, () => response(200, Buffer.from('xyz'))]);
    const client = createClient(config, { fetchImpl });
    const result = await client.download('20261101', 'f1', out);
    expect(result).toEqual({ saved: out, bytes: 3, file: { id: 'f1', name: 'a.pdf', size: 3, type: 'application/pdf' } });
    expect(JSON.stringify(result)).not.toContain('X-Amz-Signature');
    expect(fs.readFileSync(out, 'utf8')).toBe('abc');
    expect(fs.statSync(out).mode & 0o777).toBe(0o600);
    expect(calls[1]).toEqual({ url: `${S3}/files/x?X-Amz-Signature=1`, redirect: 'error' });
    await expect(client.download('20261101', 'f1', out)).rejects.toThrow(/EEXIST/);
    expect(fs.readFileSync(out, 'utf8')).toBe('abc');
  });

  test('pdf: saves the export with language and time zone', async () => {
    const out = path.join(dir, 'plan.pdf');
    const { fetchImpl, calls } = fakeFetch([() => response(200, Buffer.from('%PDF-1.4'))]);
    const client = createClient(config, { fetchImpl });
    expect(await client.pdf('20261101', out, 'zh', 'Asia/Tokyo')).toEqual({ saved: out, bytes: 8 });
    expect(calls[0].url).toBe(`${API}/api/trips/20261101/pdf?lang=zh&tz=Asia%2FTokyo`);
    await expect(client.pdf('20261101', path.join(dir, 'b.pdf'), 'fr')).rejects.toThrow('en or zh');
  });

  test('main reads the token file per request and prints results', async () => {
    const token = jwt();
    const file = credentialFile(`token=${token}\nexpires_at=${iso(NOW + 3600000)}\n`);
    const { fetchImpl, calls } = fakeFetch([() => response(201, { id: '20261101', title: 'Kyoto' })]);
    const print = jest.fn();
    await main(['POST', '/api/trips', '{"title":"Kyoto"}'], { TRIP_API_URL: API, TRIP_API_TOKEN_FILE: file }, { fetchImpl, print, now: () => NOW });
    expect(print).toHaveBeenCalledWith({ id: '20261101', title: 'Kyoto' });
    expect(calls[0].headers.authorization).toBe(`Bearer ${token}`);
    await expect(main(['nope'], { TRIP_API_URL: API, TRIP_API_ACCESS_TOKEN: 'a' }, { fetchImpl, print })).rejects.toThrow('Usage');
  });
});
