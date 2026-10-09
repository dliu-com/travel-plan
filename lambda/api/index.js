'use strict';

const crypto = require('crypto');
const auth = require('./auth');
const { loadConfig, NotConfigured } = require('./config');
const { createFiles } = require('./s3');
const { createStore, NotFound, TooLarge } = require('./store');
const {
  BadRequest, EVENT_ID, FILE_ID, MAX_FILES, SHARE_TOKEN, TRIP_ID, compareSummaries, newFileId,
  parseEvent, parseFileUpdate, parseTrip, parseUpload, toApiTrip, toSummary,
} = require('./trips');

// Recorded as the editor when someone changes a trip through its share link.
const GUEST = 'share-link';

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

function sameToken(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function errorPage(statusCode, message, cookies) {
  return {
    statusCode,
    headers: { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8' },
    ...(cookies ? { cookies } : {}),
    body: `<!doctype html><meta charset="utf-8"><title>DL Travel Plan</title>
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
  const files = deps.files || createFiles();
  const fetchImpl = deps.fetchImpl || ((...args) => fetch(...args));
  const clock = deps.now || Date.now;

  async function optionalSession(event) {
    try {
      return auth.getSession(event, await getConfig(), clock());
    } catch (error) {
      if (error instanceof NotConfigured) return null;
      throw error;
    }
  }

  // Cookies are SameSite=Lax; also insist that writes come from our own pages.
  function requireSameOrigin(event) {
    if (header(event, 'origin') !== process.env.SITE_URL) throw new HttpError(403, 'Cross-site request refused');
  }

  // Signed-in members can do everything. Someone holding a trip's share link can view and edit that one trip,
  // but can't see other trips, delete it or change its link. The token comes in a header (or ?token= for images).
  async function access(event, tripId) {
    const session = await optionalSession(event);
    if (session) return { user: session.name || session.user, member: true };
    const token = header(event, 'x-plan-token') || (event.queryStringParameters || {}).token;
    if (!token || tripId === undefined) throw new HttpError(401, 'Sign in to do that');
    const item = SHARE_TOKEN.test(token) ? await store.getTrip(tripId) : null;
    if (!item || !item.shareToken || !sameToken(token, item.shareToken)) throw new HttpError(403, 'This link no longer works');
    return { user: GUEST, member: false };
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
    // Old /s/<token> links: find the trip so the page can move to /plan/<id>?token=<token>.
    if (parts[0] === 'shared' && parts.length === 2 && method === 'GET') {
      const item = SHARE_TOKEN.test(parts[1]) ? await store.getSharedTrip(parts[1]) : null;
      if (!item) throw new NotFound('This link is no longer shared');
      return json(200, { id: item.id });
    }
    if (parts[0] !== 'trips') throw new NotFound('Not found');
    const [, tripId, sub, subId] = parts;
    if (tripId !== undefined && !TRIP_ID.test(tripId)) throw new NotFound('Trip not found');
    if (sub === 'events' && subId !== undefined && !EVENT_ID.test(subId)) throw new NotFound('Event not found');
    if (sub === 'files' && subId !== undefined && !FILE_ID.test(subId)) throw new NotFound('File not found');

    if (method !== 'GET') requireSameOrigin(event);
    const { user, member } = await access(event, tripId);
    const membersOnly = () => {
      if (!member) throw new HttpError(403, 'Sign in to do that');
    };

    if (parts.length === 1) {
      membersOnly();
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
        membersOnly();
        await store.deleteTrip(tripId);
        await files.removeTrip(tripId);
        return json(200, { deleted: tripId });
      }
    }
    if (sub === 'share' && parts.length === 3) {
      membersOnly();
      if (method === 'POST') return json(200, toApiTrip(await store.shareTrip(tripId, user)));
      if (method === 'DELETE') return json(200, toApiTrip(await store.unshareTrip(tripId, user)));
    }
    if (sub === 'events') {
      if (parts.length === 3 && method === 'POST') {
        const { id, trip } = await store.addEvent(tripId, parseEvent(readBody(event)), user);
        return json(201, { eventId: id, trip: toApiTrip(trip) });
      }
      if (parts.length === 4 && method === 'PUT') {
        return json(200, { trip: toApiTrip(await store.updateEvent(tripId, subId, parseEvent(readBody(event)), user)) });
      }
      if (parts.length === 4 && method === 'DELETE') {
        return json(200, { trip: toApiTrip(await store.deleteEvent(tripId, subId, user)) });
      }
    }
    if (sub === 'files') {
      // 1. Ask for an upload URL, 2. PUT the bytes straight to storage, 3. PUT /files/<id> to keep it.
      if (parts.length === 3 && method === 'POST') {
        const upload = parseUpload(readBody(event));
        const item = await getTrip(tripId);
        if (Object.keys(item.files || {}).length >= MAX_FILES) throw new TooLarge(`A trip can have at most ${MAX_FILES} files`);
        const fileId = newFileId();
        const { url, headers } = files.uploadUrl(tripId, fileId, upload);
        return json(201, { fileId, uploadUrl: url, uploadHeaders: headers });
      }
      if (parts.length === 4 && method === 'GET') {
        const file = ((await getTrip(tripId)).files || {})[subId];
        if (!file) throw new NotFound('File not found');
        const params = event.queryStringParameters || {};
        return redirect(files.downloadUrl(tripId, subId, file, { download: params.download === '1' }));
      }
      if (parts.length === 4 && method === 'PUT') {
        const update = parseFileUpdate(readBody(event));
        const item = await getTrip(tripId);
        // Rename a kept file, or keep a finished upload.
        if ((item.files || {})[subId]) return json(200, { trip: toApiTrip(await store.updateFile(tripId, subId, update, user)) });
        const uploaded = await files.uploaded(tripId, subId);
        if (!uploaded) throw new NotFound('Upload not found. Try again.');
        const file = parseUpload({ ...update, size: uploaded.size, type: uploaded.type });
        await files.keep(tripId, subId);
        return json(201, { trip: toApiTrip(await store.addFile(tripId, subId, file, user)) });
      }
      if (parts.length === 4 && method === 'DELETE') {
        const trip = await store.deleteFile(tripId, subId, user);
        await files.remove(tripId, subId);
        return json(200, { trip: toApiTrip(trip) });
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
