'use strict';

// Who may read or change a trip. Shared by the API and the PDF export functions.
const crypto = require('crypto');
const apiAccess = require('./api-access');
const auth = require('./auth');
const { NotConfigured } = require('./config');
const { createGuestLimits } = require('./limits');
const { SHARE_TOKEN, shareLinkExpired } = require('./trips');

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

  const useGuest = createGuestLimits({ store, clock });

  // Signed-in members can do everything. Someone holding a trip's share link can view and edit that one trip
  // until the link expires (3 months, see trips.js), but can't see other trips, delete it or reset its link. The token comes in a header (or ?token= for images).
  // Guests also use up a daily allowance for the trip (see limits.js), so a leaked link can't run up the bill.
  // Managed API requests (Microsoft access tokens through API Gateway) are checked only by their token claims:
  // never by a cookie, share link or header, and never by the website's sign-in settings.
  async function access(event, tripId) {
    if (apiAccess.isManaged(event)) return managedAccess(event);
    const session = await optionalSession(event);
    if (session) return { user: session.name || session.user, member: true };
    const token = header(event, 'x-plan-token') || (event.queryStringParameters || {}).token;
    if (!token || tripId === undefined) throw new HttpError(401, 'Sign in to do that');
    const refused = new HttpError(403, 'This link no longer works');
    // Look the token up in the small keys-only index first, so guessing tokens never reads a whole trip.
    if (!SHARE_TOKEN.test(token) || await store.sharedTripId(token) !== tripId) throw refused;
    await useGuest(tripId, { requests: 1 });
    const item = await store.getTrip(tripId);
    if (!item || !item.shareToken || !sameToken(token, item.shareToken)) throw refused;
    if (shareLinkExpired(item, new Date(clock()).toISOString())) throw refused;
    return { user: GUEST, member: false };
  }

  return { access, optionalSession, useGuest };
}

// Microsoft-token callers are members: like signed-in website members they can read and change every trip
// (there is no per-trip owner). The gateway route decides which scope is needed.
function managedAccess(event) {
  const route = apiAccess.routeFor(event);
  if (!route) throw new HttpError(404, 'Not found');
  const result = apiAccess.authorize(event, route.scope);
  if (result.status) throw new HttpError(result.status, result.error);
  return { user: result.name, id: result.user, name: result.name, member: true, managed: true, route };
}

module.exports = { GUEST, HttpError, createAccess, header, managedAccess, sameToken };
