#!/usr/bin/env node
'use strict';

// Local preview: serves web/ and runs the real API handler against an in-memory store.
// Sign-in is faked: /auth/login signs you in as a dev user without Microsoft.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8787);
const SITE_URL = `http://localhost:${PORT}`;
process.env.SITE_URL = SITE_URL;

const auth = require('../lambda/api/auth');
const { createHandler } = require('../lambda/api/index');
const { createMemoryFiles } = require('./memory-files');
const { createMemoryStore } = require('./memory-store');

const config = { tenantId: 'dev', clientId: 'dev', clientSecret: 'dev-secret', allowedDomain: 'dliu.com' };
const store = createMemoryStore();
const files = createMemoryFiles();
const handler = createHandler({ store, files, loadConfig: async () => config });
const WEB = path.join(__dirname, '..', 'web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
// Local cookies can't use the __Host- prefix over plain http, so rename them on the way in and out.
const LOCAL_SESSION = 'plan_dev_session';

function sessionCookie() {
  const value = auth.sign({ user: 'dev@dliu.com', name: 'Dev User', exp: Math.floor(Date.now() / 1000) + 86400 }, auth.sessionKey(config));
  return `${LOCAL_SESSION}=${value}; Path=/; HttpOnly; SameSite=Lax`;
}

async function seed() {
  const trip = await store.createTrip({
    title: 'Autumn in Kyoto',
    destination: 'Kyoto, Japan',
    startDate: '2026-11-12',
    endDate: '2026-11-16',
    intro: 'Five days of temples, food and autumn leaves. Friends join from day 3.',
  }, 'Dev User');
  const events = [
    { date: '2026-11-12', time: '15:40', title: 'Land at Kansai (KIX)', status: 'confirmed', place: 'Kansai International Airport', notes: 'Haruka express to Kyoto Station.', link: '' },
    { date: '2026-11-12', time: '19:00', title: 'Dinner in Pontocho', status: 'planned', place: 'Pontocho Alley, Kyoto', notes: 'Somewhere small along the alley. Kaiseki is pricey; yakitori or obanzai are good casual options. Ask the hotel to book if we decide on a set menu.', link: '' },
    { date: '2026-11-13', time: '06:30', title: 'Fushimi Inari at sunrise', status: 'option', place: 'Fushimi Inari Taisha', notes: 'Go early to beat the crowds.', link: 'https://inari.jp/en/' },
    { date: '2026-11-13', time: '07:00', title: 'Sleep in, then Nishiki Market', status: 'option', place: 'Nishiki Market, Kyoto', notes: 'If jet lag wins.', link: '' },
    { date: '2026-11-14', time: '', title: 'Arashiyama day', status: 'proposed', place: 'Arashiyama, Kyoto', notes: 'Bamboo grove, Tenryu-ji, boat ride.', link: '' },
    { date: '', time: '', title: 'Maybe: tea ceremony', place: '', notes: 'Book if we find a free afternoon.', link: '' },
  ];
  for (const event of events) await store.addEvent(trip.id, event, 'Dev User');
  await store.createTrip({ title: 'Lisbon weekend', destination: 'Lisbon, Portugal', startDate: '', endDate: '', intro: '' }, 'Dev User');
}

function toLambdaEvent(req, body) {
  const url = new URL(req.url, SITE_URL);
  const cookieHeader = (req.headers.cookie || '').replace(new RegExp(`\\b${LOCAL_SESSION}=`), `${auth.SESSION_COOKIE}=`);
  return {
    rawPath: url.pathname,
    queryStringParameters: Object.fromEntries(url.searchParams),
    headers: { ...req.headers, cookie: cookieHeader },
    requestContext: { http: { method: req.method } },
    body: body.length ? body.toString('base64') : undefined,
    isBase64Encoded: true,
  };
}

async function handle(req, res) {
  const url = new URL(req.url, SITE_URL);
  if (url.pathname === '/auth/login') {
    res.writeHead(302, { location: auth.safeReturnPath(url.searchParams.get('return')), 'set-cookie': sessionCookie() });
    return res.end();
  }
  if (url.pathname === '/auth/logout') {
    res.writeHead(302, { location: '/', 'set-cookie': `${LOCAL_SESSION}=; Path=/; Max-Age=0` });
    return res.end();
  }
  // Stand-in for the attachments bucket: presigned PUTs land here and downloads are served from here.
  if (url.pathname.startsWith('/dev-files/')) {
    const key = decodeURIComponent(url.pathname.slice('/dev-files/'.length));
    if (req.method === 'PUT' && key.startsWith('pending/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      files.put(key, Buffer.concat(chunks), req.headers['content-type']);
      res.writeHead(200);
      return res.end();
    }
    const object = files.objects.get(key);
    if (req.method !== 'GET' || !object) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, {
      'content-type': url.searchParams.get('response-content-type') || object.type,
      'content-disposition': url.searchParams.get('response-content-disposition') || 'attachment',
      'x-content-type-options': 'nosniff',
    });
    return res.end(object.body);
  }
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const result = await handler(toLambdaEvent(req, Buffer.concat(chunks)));
    res.writeHead(result.statusCode, result.headers);
    return res.end(result.body);
  }
  let file = url.pathname === '/' || (/^\/(plan|trips|s)\//.test(url.pathname) || /^\/(about|security)\/?$/.test(url.pathname)) ? '/index.html' : url.pathname;
  file = path.join(WEB, path.normalize(file));
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('Not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

seed().then(() => {
  http.createServer((req, res) => handle(req, res).catch((error) => {
    console.error(error);
    res.writeHead(500);
    res.end('Internal error');
  })).listen(PORT, () => console.log(`Travel plan dev server: ${SITE_URL} (Sign in = fake dev user)`));
});
