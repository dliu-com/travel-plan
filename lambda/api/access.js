'use strict';

// Who may read or change a trip. Shared by the API and the PDF export functions.
const crypto = require('crypto');
const auth = require('./auth');
const { NotConfigured } = require('./config');
const { SHARE_TOKEN } = require('./trips');

// Recorded as the editor when someone changes a trip through its share link.
const GUEST = 'share-link';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function header(event, name) {
  const headers = event.headers || {};
  return headers[name] || headers[name.toLowerCase()];
}

function sameToken(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function createAccess({ getConfig, store, clock }) {
  async function optionalSession(event) {
    try {
      return auth.getSession(event, await getConfig(), clock());
    } catch (error) {
      if (error instanceof NotConfigured) return null;
      throw error;
    }
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

  return { access, optionalSession };
}

module.exports = { GUEST, HttpError, createAccess, header, sameToken };
