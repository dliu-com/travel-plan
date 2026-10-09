'use strict';

const crypto = require('crypto');

const MAX_EVENTS = 300;
const MAX_FILES = 200;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
// Trip ids are the month the trip was created plus a counter: 20261000, 20261001, …
const TRIP_ID = /^\d{8}$/;
const FILE_ID = /^[A-Za-z0-9_-]{16}$/;
const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const EVENT_ID = /^[A-Za-z0-9_-]{8,32}$/;
const SHARE_TOKEN = /^[A-Za-z0-9_-]{24}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// Where an event stands: booked/fixed, decided but not booked, suggested, or one of several alternatives.
const STATUSES = ['confirmed', 'planned', 'proposed', 'option'];

class BadRequest extends Error {}

function text(value, field, max, { required = false } = {}) {
  if (value == null) value = '';
  if (typeof value !== 'string') throw new BadRequest(`${field} must be text`);
  const clean = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (required && !clean) throw new BadRequest(`${field} is required`);
  if (clean.length > max) throw new BadRequest(`${field} must be at most ${max} characters`);
  return clean;
}

function date(value, field) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || !DATE.test(value)) throw new BadRequest(`${field} must be a date (YYYY-MM-DD)`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new BadRequest(`${field} is not a valid date`);
  return value;
}

function time(value, field) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || !TIME.test(value)) throw new BadRequest(`${field} must be a time (HH:MM)`);
  return value;
}

function link(value) {
  const clean = text(value, 'Link', 2000);
  if (!clean) return '';
  let url;
  try {
    url = new URL(clean);
  } catch {
    throw new BadRequest('Link must be a full URL starting with https://');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BadRequest('Link must start with http:// or https://');
  return url.toString();
}

function status(value) {
  if (value == null || value === '') return '';
  if (!STATUSES.includes(value)) throw new BadRequest(`Status must be one of: ${STATUSES.join(', ')}`);
  return value;
}

function parseTrip(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequest('Expected a JSON object');
  const trip = {
    title: text(input.title, 'Title', 120, { required: true }),
    destination: text(input.destination, 'Destination', 120),
    startDate: date(input.startDate, 'Start date'),
    endDate: date(input.endDate, 'End date'),
    intro: text(input.intro, 'Description', 10000),
  };
  if (trip.startDate && trip.endDate && trip.endDate < trip.startDate) throw new BadRequest('End date is before the start date');
  return trip;
}

function parseEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequest('Expected a JSON object');
  return {
    date: date(input.date, 'Date'),
    time: time(input.time, 'Time'),
    title: text(input.title, 'Title', 200, { required: true }),
    status: status(input.status),
    place: text(input.place, 'Place', 200),
    notes: text(input.notes, 'Notes', 4000),
    link: link(input.link),
  };
}

// The next id for a trip created at `nowIso`: YYYYMM plus one more than the highest number used that month.
// Numbers are never reused while a later trip from the same month exists. Returns null when the month is full.
function nextTripId(existingIds, nowIso) {
  const prefix = nowIso.slice(0, 4) + nowIso.slice(5, 7);
  let highest = -1;
  for (const id of existingIds) {
    if (TRIP_ID.test(id) && id.startsWith(prefix)) highest = Math.max(highest, Number(id.slice(6)));
  }
  return highest >= 99 ? null : `${prefix}${String(highest + 1).padStart(2, '0')}`;
}

const newEventId = () => crypto.randomBytes(9).toString('base64url');
const newShareToken = () => crypto.randomBytes(18).toString('base64url');
const newFileId = () => crypto.randomBytes(12).toString('base64url');

function eventRef(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || !EVENT_ID.test(value)) throw new BadRequest('Unknown event');
  return value;
}

// A file the browser is about to upload: what it is called, how big it is and where it belongs.
function parseUpload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequest('Expected a JSON object');
  const name = text(input.name, 'File name', 200, { required: true });
  if (!Number.isSafeInteger(input.size) || input.size < 1) throw new BadRequest('File is empty');
  if (input.size > MAX_FILE_BYTES) throw new BadRequest(`Files can be at most ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  const type = typeof input.type === 'string' && input.type.length <= 100 && MIME_TYPE.test(input.type)
    ? input.type.toLowerCase() : 'application/octet-stream';
  return { name, size: input.size, type, eventId: eventRef(input.eventId) };
}

function parseFileUpdate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequest('Expected a JSON object');
  return { name: text(input.name, 'File name', 200, { required: true }), eventId: eventRef(input.eventId) };
}

// Undated events go last; within a day, events without a time come first (all-day), then by time.
function compareEvents(a, b) {
  if (a.date !== b.date) {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? -1 : 1;
  }
  if (a.time !== b.time) {
    if (!a.time) return -1;
    if (!b.time) return 1;
    return a.time < b.time ? -1 : 1;
  }
  return (a.createdAt || '').localeCompare(b.createdAt || '');
}

function toApiTrip(item) {
  const events = Object.entries(item.events || {})
    .map(([id, event]) => ({
      id,
      date: event.date || '',
      time: event.time || '',
      title: event.title || '',
      status: STATUSES.includes(event.status) ? event.status : '',
      place: event.place || '',
      notes: event.notes || '',
      link: event.link || '',
      createdAt: event.createdAt,
    }))
    .sort(compareEvents)
    .map(({ createdAt, ...event }) => event);
  const files = Object.entries(item.files || {})
    .map(([id, file]) => ({
      id,
      name: file.name || 'file',
      size: file.size || 0,
      type: file.type || 'application/octet-stream',
      // A file whose event is gone shows up with the trip's own files.
      eventId: file.eventId && item.events && item.events[file.eventId] ? file.eventId : '',
      createdAt: file.createdAt || '',
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
  return {
    id: item.id,
    title: item.title,
    destination: item.destination || '',
    startDate: item.startDate || '',
    endDate: item.endDate || '',
    intro: item.intro || '',
    events,
    files,
    shareToken: item.shareToken || '',
    updatedAt: item.updatedAt,
    updatedBy: item.updatedBy || '',
  };
}

function toSummary(item) {
  const intro = item.intro || '';
  return {
    id: item.id,
    title: item.title,
    destination: item.destination || '',
    startDate: item.startDate || '',
    endDate: item.endDate || '',
    excerpt: intro.length > 280 ? `${intro.slice(0, 277).trimEnd()}…` : intro,
    shared: Boolean(item.shareToken),
    updatedAt: item.updatedAt,
  };
}

// Blog order: trips still being planned (no dates) first, then newest start date first.
function compareSummaries(a, b) {
  if (a.startDate !== b.startDate) {
    if (!a.startDate) return -1;
    if (!b.startDate) return 1;
    return a.startDate < b.startDate ? 1 : -1;
  }
  return (b.updatedAt || '').localeCompare(a.updatedAt || '');
}

module.exports = {
  BadRequest,
  EVENT_ID,
  FILE_ID,
  MAX_EVENTS,
  MAX_FILES,
  MAX_FILE_BYTES,
  SHARE_TOKEN,
  STATUSES,
  TRIP_ID,
  compareEvents,
  compareSummaries,
  newEventId,
  newShareToken,
  newFileId,
  nextTripId,
  parseEvent,
  parseFileUpdate,
  parseUpload,
  parseTrip,
  toApiTrip,
  toSummary,
};
