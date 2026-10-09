'use strict';

const auth = require('./auth');
const { loadConfig, NotConfigured } = require('./config');
const { createStore, NotFound, TooLarge } = require('./store');
const {
  BadRequest, EVENT_ID, SHARE_TOKEN, TRIP_ID, compareSummaries, parseEvent, parseTrip, toApiTrip, toSharedTrip, toSummary,
} = require('./trips');

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};
const MAX_BODY_BYTES = 64 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(statusCode, body, cookies) {
  return {
    statusCode,
    headers: { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8' },
    ...(cookies ? { cookies } : {}),
    body: JSON.stringify(body),
  };
}

function redirect(location, cookies) {
  return { statusCode: 302, headers: { ...SECURITY_HEADERS, location }, ...(cookies ? { cookies } : {}), body: '' };
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function errorPage(statusCode, message, cookies) {
  return {
    statusCode,
    headers: { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8' },
    ...(cookies ? { cookies } : {}),
    body: `<!doctype html><meta charset="utf-8"><title>Plan</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto">
<h1>Sign-in problem</h1><p>${escapeHtml(message)}</p><p><a href="/auth/login">Try again</a></p></body>`,
  };
}

function header(event, name) {
  const headers = event.headers || {};
  return headers[name] || headers[name.toLowerCase()];
}

function readBody(event) {
  const raw = event.body ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8') : Buffer.alloc(0);
  if (raw.length > MAX_BODY_BYTES) throw new HttpError(413, 'Request too large');
  if (!/^application\/json\b/i.test(header(event, 'content-type') || '')) throw new HttpError(415, 'Expected application/json');
  try {
    return JSON.parse(raw.toString('utf8') || 'null');
  } catch {
    throw new BadRequest('Invalid JSON');
  }
}

function createHandler(deps = {}) {
  const getConfig = deps.loadConfig || loadConfig;
  const store = deps.store || createStore();
  const fetchImpl = deps.fetchImpl || ((...args) => fetch(...args));
  const clock = deps.now || Date.now;

  async function requireSession(event) {
    const session = auth.getSession(event, await getConfig(), clock());
    if (!session) throw new HttpError(401, 'Sign in to do that');
    return session;
  }

  // Cookies are SameSite=Lax; also insist that writes come from our own pages.
  function requireSameOrigin(event) {
    if (header(event, 'origin') !== process.env.SITE_URL) throw new HttpError(403, 'Cross-site request refused');
  }

  async function getTrip(id) {
    const item = await store.getTrip(id);
    if (!item) throw new NotFound('Trip not found');
    return item;
  }

  async function api(method, parts, event) {
    // /api/me
    if (parts.length === 1 && parts[0] === 'me' && method === 'GET') {
      try {
        const session = auth.getSession(event, await getConfig(), clock());
        return json(200, session ? { signedIn: true, user: session.user, name: session.name } : { signedIn: false });
      } catch (error) {
        if (error instanceof NotConfigured) return json(200, { signedIn: false, configured: false });
        throw error;
      }
    }
    // Friends open a trip through its share link without signing in.
    if (parts[0] === 'shared' && parts.length === 2 && method === 'GET') {
      const item = SHARE_TOKEN.test(parts[1]) ? await store.getSharedTrip(parts[1]) : null;
      if (!item) throw new NotFound('This link is no longer shared');
      return json(200, toSharedTrip(item));
    }
    if (parts[0] !== 'trips') throw new NotFound('Not found');
    const [, tripId, sub, eventId] = parts;
    if (tripId !== undefined && !TRIP_ID.test(tripId)) throw new NotFound('Trip not found');
    if (eventId !== undefined && !EVENT_ID.test(eventId)) throw new NotFound('Event not found');

    if (method !== 'GET') requireSameOrigin(event);
    const session = await requireSession(event);
    const user = session.name || session.user;

    if (parts.length === 1) {
      if (method === 'GET') {
        const trips = (await store.listTrips()).map(toSummary).sort(compareSummaries);
        return json(200, { trips });
      }
      if (method === 'POST') return json(201, toApiTrip(await store.createTrip(parseTrip(readBody(event)), user)));
    }
    if (parts.length === 2) {
      if (method === 'GET') return json(200, toApiTrip(await getTrip(tripId)));
      if (method === 'PUT') return json(200, toApiTrip(await store.updateTrip(tripId, parseTrip(readBody(event)), user)));
      if (method === 'DELETE') {
        await store.deleteTrip(tripId);
        return json(200, { deleted: tripId });
      }
    }
    if (sub === 'share' && parts.length === 3) {
      if (method === 'POST') return json(200, toApiTrip(await store.shareTrip(tripId, user)));
      if (method === 'DELETE') return json(200, toApiTrip(await store.unshareTrip(tripId, user)));
    }
    if (sub === 'events') {
      if (parts.length === 3 && method === 'POST') {
        const { id, trip } = await store.addEvent(tripId, parseEvent(readBody(event)), user);
        return json(201, { eventId: id, trip: toApiTrip(trip) });
      }
      if (parts.length === 4 && method === 'PUT') {
        return json(200, { trip: toApiTrip(await store.updateEvent(tripId, eventId, parseEvent(readBody(event)), user)) });
      }
      if (parts.length === 4 && method === 'DELETE') {
        return json(200, { trip: toApiTrip(await store.deleteEvent(tripId, eventId, user)) });
      }
    }
    throw new HttpError(405, 'Method not allowed');
  }

  return async function handler(event) {
    const method = (event.requestContext && event.requestContext.http && event.requestContext.http.method) || 'GET';
    const path = event.rawPath || '/';
    const params = event.queryStringParameters || {};
    const siteUrl = process.env.SITE_URL;

    try {
      if (path.startsWith('/auth/')) {
        if (method !== 'GET') return json(405, { error: 'Method not allowed' });
        if (path === '/auth/logout') return redirect(auth.safeReturnPath(params.return), auth.logoutCookies());
        const config = await getConfig();
        if (path === '/auth/login') {
          const login = auth.startLogin(config, siteUrl, clock(), params.return);
          return redirect(login.location, login.cookies);
        }
        if (path === '/auth/callback') {
          const result = await auth.finishLogin(event, config, siteUrl, { fetchImpl, now: clock() });
          return result.location ? redirect(result.location, result.cookies) : errorPage(result.status, result.error, result.cookies);
        }
        return json(404, { error: 'Not found' });
      }
      if (!path.startsWith('/api/')) return json(404, { error: 'Not found' });
      return await api(method, path.slice('/api/'.length).split('/').filter(Boolean), event);
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { error: error.message });
      if (error instanceof BadRequest) return json(400, { error: error.message });
      if (error instanceof NotFound) return json(404, { error: error.message });
      if (error instanceof TooLarge) return json(413, { error: error.message });
      if (error instanceof NotConfigured) {
        console.error(JSON.stringify({ message: 'Sign-in not configured', path, error: error.message }));
        const text = 'Sign-in is not configured yet. Run "make set-secrets".';
        return path.startsWith('/auth/') ? errorPage(503, text) : json(503, { error: text });
      }
      console.error(JSON.stringify({ message: 'Request failed', method, path, error: error.message, stack: error.stack }));
      if (path.startsWith('/auth/')) return errorPage(500, 'Something went wrong while signing in.');
      return json(500, { error: 'Internal error' });
    }
  };
}

module.exports = { createHandler, handler: createHandler() };
