'use strict';

const SITE_URL = 'https://plan.dliu.com';
process.env.SITE_URL = SITE_URL;

const auth = require('../lambda/api/auth');
const api = require('../lambda/api/index');
const pdf = require('../lambda/pdf/index');
const { clean, pdfFileName, renderPdf, safeTimeZone } = require('../lambda/pdf/render');
const { createMemoryFiles } = require('../scripts/memory-files');
const { createMemoryStore } = require('../scripts/memory-store');

const NOW = Date.UTC(2026, 9, 1);
const config = { tenantId: 'tenant', clientId: 'client', clientSecret: 'secret', allowedDomain: 'dliu.com' };

function setup() {
  const store = createMemoryStore({ now: () => new Date(NOW).toISOString() });
  const deps = { store, files: createMemoryFiles(), loadConfig: async () => config, now: () => NOW };
  const apiHandler = api.createHandler(deps);
  const pdfHandler = pdf.createHandler(deps);
  const session = auth.sign({ user: 'dewei@dliu.com', name: 'Dewei', exp: NOW / 1000 + 3600 }, auth.sessionKey(config));

  const request = (handler) => async (method, path, { body, signedIn = true, token } = {}) => {
    const headers = { origin: SITE_URL };
    if (token) headers['x-plan-token'] = token;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await handler({
      rawPath: path.split('?')[0],
      queryStringParameters: Object.fromEntries(new URL(path, SITE_URL).searchParams),
      headers,
      cookies: signedIn ? [`${auth.SESSION_COOKIE}=${session}`] : [],
      requestContext: { http: { method } },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const isJson = (res.headers['content-type'] || '').startsWith('application/json');
    return { ...res, json: isJson ? JSON.parse(res.body) : undefined };
  };
  return { call: request(apiHandler), exportPdf: request(pdfHandler) };
}

async function kyoto(call) {
  const trip = (await call('POST', '/api/trips', {
    body: { title: '京都 Autumn', startDate: '2026-11-12', endDate: '2026-11-14', description: 'Temples & food 🍁', travellers: ['Dewei', '小明'] },
  })).json;
  await call('POST', `/api/trips/${trip.id}/events`, { body: { title: 'Inari', date: '2026-11-13', time: '06:30', location: 'Fushimi' } });
  return trip;
}

describe('PDF rendering', () => {
  test('renders English and Chinese plans as PDFs', async () => {
    const trip = {
      id: '20261100', title: 'Kyoto', startDate: '2026-11-12', endDate: '2026-11-13', travellers: ['Dewei'],
      events: [{ id: 'a', title: 'Inari', date: '2026-11-13', time: '06:30', status: 'confirmed', url: 'https://example.com' }, { id: 'b', title: 'Someday' }],
      files: [{ name: 'ticket.pdf', size: 2048 }],
    };
    for (const lang of ['en', 'zh']) {
      const buffer = await renderPdf(trip, { lang, now: new Date(NOW), siteUrl: SITE_URL });
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
      expect(buffer.length).toBeLessThan(200 * 1024);
    }
  });

  test('drops characters the font cannot draw and keeps file names safe', () => {
    expect(clean('Tapas 🍤 night')).toBe('Tapas night');
    expect(clean('don’t')).toBe("don't");
    expect(pdfFileName({ title: 'a/b: c?', startDate: '2026-11-12', endDate: '2026-11-14' }, 'en')).not.toMatch(/[/:?]/);
    expect(pdfFileName({ title: 'Kyoto', startDate: '2026-11-12', endDate: '2026-11-16' }, 'en')).toBe('Kyoto 12 – 16 Nov 2026.pdf');
  });

  test('ignores unknown time zones', () => {
    expect(safeTimeZone('Europe/Madrid')).toBe('Europe/Madrid');
    expect(safeTimeZone('Not/AZone')).toBe('UTC');
    expect(safeTimeZone(undefined)).toBe('UTC');
  });
});

describe('/api/trips/<id>/pdf', () => {
  test('members download the plan as a PDF', async () => {
    const { call, exportPdf } = setup();
    const trip = await kyoto(call);
    const res = await exportPdf('GET', `/api/trips/${trip.id}/pdf?lang=zh&tz=Asia/Tokyo`);
    expect(res.statusCode).toBe(200);
    expect(res.isBase64Encoded).toBe(true);
    expect(res.headers).toMatchObject({ 'content-type': 'application/pdf', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="plan-\d{8}\.pdf"; filename\*=UTF-8''.+\.pdf$/);
    expect(Buffer.from(res.body, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('share-link guests can download; others cannot', async () => {
    const { call, exportPdf } = setup();
    const trip = await kyoto(call);
    expect((await exportPdf('GET', `/api/trips/${trip.id}/pdf`, { signedIn: false })).statusCode).toBe(401);
    expect((await exportPdf('GET', `/api/trips/${trip.id}/pdf`, { signedIn: false, token: 'nope' })).statusCode).toBe(403);

    const { shareToken } = (await call('POST', `/api/trips/${trip.id}/share`)).json;
    expect((await exportPdf('GET', `/api/trips/${trip.id}/pdf`, { signedIn: false, token: shareToken })).statusCode).toBe(200);
    expect((await exportPdf('GET', `/api/trips/${trip.id}/pdf`, { signedIn: false, token: 'wrong' })).statusCode).toBe(403);

    const other = (await call('POST', '/api/trips', { body: { title: 'Other', startDate: '2026-12-01' } })).json;
    expect((await exportPdf('GET', `/api/trips/${other.id}/pdf`, { signedIn: false, token: shareToken })).statusCode).toBe(403);

    await call('DELETE', `/api/trips/${trip.id}/share`);
    expect((await exportPdf('GET', `/api/trips/${trip.id}/pdf`, { signedIn: false, token: shareToken })).statusCode).toBe(403);
  });

  test('unknown plans, bad paths and other methods are rejected', async () => {
    const { exportPdf } = setup();
    expect((await exportPdf('GET', '/api/trips/20269900/pdf')).statusCode).toBe(404);
    expect((await exportPdf('GET', '/api/trips/..%2F/pdf')).statusCode).toBe(404);
    expect((await exportPdf('GET', '/api/trips/20269900')).statusCode).toBe(404);
    const post = await exportPdf('POST', '/api/trips/20269900/pdf');
    expect(post.statusCode).toBe(405);
    expect(post.json).toEqual({ error: 'Method not allowed' });
  });
});
