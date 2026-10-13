'use strict';

// What a leaked share link can cost. Guests (share-link users) get a daily allowance per travel plan,
// counted in a small DynamoDB table whose rows expire; members are not limited. Every plan, whoever
// uploads, also has a storage cap on top of the 200-file / 50 MB-per-file limits.
const MB = 1024 * 1024;
const GUEST_DAILY = {
  requests: 5000, // every API call made with the token (page loads, thumbnails, edits…)
  changes: 1000, // edits, new events, deletions, renames
  uploads: 50, // files started
  uploadBytes: 500 * MB,
  downloadBytes: 10 * 1024 * MB, // file opens and thumbnails
  pdfs: 50,
};
const MAX_TRIP_BYTES = 1024 * MB;
const LIMIT_MESSAGE = 'This share link has reached today’s limit for this travel plan. Try again tomorrow, or sign in.';

const tripBytes = (item) => Object.values((item && item.files) || {}).reduce((sum, file) => sum + (Number(file.size) || 0), 0);

class LimitReached extends Error {
  constructor() {
    super(LIMIT_MESSAGE);
    this.status = 429;
  }
}

function createGuestLimits({ store, clock = Date.now }) {
  // amounts: e.g. { requests: 1 } or { changes: 1 }. Throws LimitReached if any counter would pass its limit.
  return async function useGuest(tripId, amounts) {
    const used = Object.fromEntries(Object.entries(amounts).filter(([, n]) => n > 0));
    for (const [name, n] of Object.entries(used)) {
      if (!(name in GUEST_DAILY)) throw new Error(`Unknown limit ${name}`);
      if (n > GUEST_DAILY[name]) throw new LimitReached();
    }
    if (!Object.keys(used).length) return;
    const now = new Date(clock());
    const day = now.toISOString().slice(0, 10);
    // Keep each row a day after its day ends, then DynamoDB's TTL removes it.
    const expiresAt = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + 2 * 86400;
    const room = Object.fromEntries(Object.keys(used).map((name) => [name, GUEST_DAILY[name] - used[name]]));
    if (!await store.useQuota(`${tripId}#${day}`, used, room, expiresAt)) throw new LimitReached();
  };
}

module.exports = { GUEST_DAILY, LIMIT_MESSAGE, LimitReached, MAX_TRIP_BYTES, createGuestLimits, tripBytes };
