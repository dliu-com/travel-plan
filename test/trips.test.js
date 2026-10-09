'use strict';

const {
  BadRequest, SHARE_TOKEN, TRIP_ID, compareEvents, compareSummaries, newShareToken, nextTripId, newFileId, FILE_ID, parseUpload, parseFileUpdate,
  parseEvent, parseTrip, toApiTrip, toSharedTrip, toSummary,
} = require('../lambda/api/trips');

describe('parseTrip', () => {
  test('cleans and accepts a valid trip', () => {
    expect(parseTrip({ title: '  Kyoto \r\n', destination: 'Japan', startDate: '2026-11-12', endDate: '2026-11-16', intro: 'a\r\nb', extra: 1 }))
      .toEqual({ title: 'Kyoto', destination: 'Japan', startDate: '2026-11-12', endDate: '2026-11-16', intro: 'a\nb' });
  });

  test('requires a title', () => {
    expect(() => parseTrip({ title: '   ' })).toThrow(BadRequest);
    expect(() => parseTrip(null)).toThrow(BadRequest);
    expect(() => parseTrip([])).toThrow(BadRequest);
  });

  test('rejects bad and reversed dates', () => {
    expect(() => parseTrip({ title: 'x', startDate: '2026-02-30' })).toThrow(/valid date/);
    expect(() => parseTrip({ title: 'x', startDate: '12/11/2026' })).toThrow(/YYYY-MM-DD/);
    expect(() => parseTrip({ title: 'x', startDate: '2026-11-16', endDate: '2026-11-12' })).toThrow(/before/);
  });

  test('enforces lengths and types', () => {
    expect(() => parseTrip({ title: 'x'.repeat(121) })).toThrow(/at most 120/);
    expect(() => parseTrip({ title: 5 })).toThrow(/text/);
  });
});

describe('parseEvent', () => {
  test('accepts a full event and normalises the link', () => {
    expect(parseEvent({ date: '2026-11-13', time: '06:30', title: 'Inari', status: 'confirmed', place: 'Fushimi', notes: 'early', link: 'https://inari.jp' }))
      .toEqual({ date: '2026-11-13', time: '06:30', title: 'Inari', status: 'confirmed', place: 'Fushimi', notes: 'early', link: 'https://inari.jp/' });
  });

  test('allows undated, untimed events', () => {
    expect(parseEvent({ title: 'Maybe' })).toEqual({ date: '', time: '', title: 'Maybe', status: '', place: '', notes: '', link: '' });
  });

  test('only accepts known statuses', () => {
    for (const status of ['confirmed', 'planned', 'proposed', 'option']) expect(parseEvent({ title: 'x', status }).status).toBe(status);
    expect(() => parseEvent({ title: 'x', status: 'booked' })).toThrow(/Status/);
    expect(() => parseEvent({ title: 'x', status: 1 })).toThrow(/Status/);
  });

  test('rejects unsafe links and bad times', () => {
    expect(() => parseEvent({ title: 'x', link: 'javascript:alert(1)' })).toThrow(/http/);
    expect(() => parseEvent({ title: 'x', link: 'not a url' })).toThrow(/full URL/);
    expect(() => parseEvent({ title: 'x', time: '24:00' })).toThrow(/HH:MM/);
  });
});

describe('uploads', () => {
  test('uploads need a name and a sensible size; odd types become octet-stream', () => {
    expect(parseUpload({ name: ' ticket.pdf ', size: 10, type: 'application/pdf' })).toEqual({ name: 'ticket.pdf', size: 10, type: 'application/pdf', eventId: '' });
    expect(parseUpload({ name: 'x', size: 1, type: 'text/html"><script>' }).type).toBe('application/octet-stream');
    expect(parseUpload({ name: 'x', size: 1, type: '' }).type).toBe('application/octet-stream');
    expect(() => parseUpload({ name: '', size: 1 })).toThrow(/required/);
    expect(() => parseUpload({ name: 'x', size: 0 })).toThrow(/empty/);
    expect(() => parseUpload({ name: 'x', size: 51 * 1024 * 1024 })).toThrow(/50 MB/);
    expect(() => parseUpload({ name: 'x', size: 1, eventId: '../x' })).toThrow(/Unknown event/);
    expect(parseFileUpdate({ name: 'y', eventId: 'abcdefgh' })).toEqual({ name: 'y', eventId: 'abcdefgh' });
  });
});

describe('ids', () => {
  test('trip ids are the creation month plus a counter', () => {
    const at = '2026-10-09T02:26:15.896Z';
    expect(nextTripId([], at)).toBe('20261000');
    expect(nextTripId(['20261000', '20261001', '20260905'], at)).toBe('20261002');
    // A gap left by a deleted trip is not reused while later numbers exist.
    expect(nextTripId(['20261000', '20261007'], at)).toBe('20261008');
    expect(nextTripId(['20260999', 'old-slug-abcdefghij'], at)).toBe('20261000');
    expect(nextTripId(['20261099'], at)).toBeNull();
    expect(TRIP_ID.test('20261000')).toBe(true);
    expect(TRIP_ID.test('spain-ibiza-67mrt9qxtc')).toBe(false);
  });

  test('file ids match their route pattern', () => {
    expect(FILE_ID.test(newFileId())).toBe(true);
  });

  test('share tokens are unguessable and match the route pattern', () => {
    const a = newShareToken();
    expect(SHARE_TOKEN.test(a)).toBe(true);
    expect(a).not.toBe(newShareToken());
  });
});

describe('ordering', () => {
  test('events sort by day, all-day first, then time; undated last', () => {
    const events = [
      { date: '', time: '', createdAt: '1' },
      { date: '2026-11-13', time: '09:00', createdAt: '2' },
      { date: '2026-11-12', time: '19:00', createdAt: '3' },
      { date: '2026-11-13', time: '', createdAt: '4' },
    ].sort(compareEvents);
    expect(events.map((e) => e.createdAt)).toEqual(['3', '4', '2', '1']);
  });

  test('trips list undated plans first, then newest start date', () => {
    const trips = [
      { startDate: '2025-05-01', updatedAt: 'a' },
      { startDate: '', updatedAt: 'b' },
      { startDate: '2026-11-12', updatedAt: 'c' },
    ].sort(compareSummaries);
    expect(trips.map((t) => t.updatedAt)).toEqual(['b', 'c', 'a']);
  });
});

describe('serialisation', () => {
  const item = {
    id: 'kyoto-abcdefghij',
    title: 'Kyoto',
    intro: 'x'.repeat(400),
    shareToken: 'T'.repeat(24),
    updatedAt: '2026-01-01T00:00:00Z',
    updatedBy: 'Dewei',
    events: {
      b: { date: '2026-11-13', title: 'Second', createdAt: '2' },
      a: { date: '2026-11-12', title: 'First', createdAt: '1' },
    },
  };

  test('api trips list events in order with ids', () => {
    const trip = toApiTrip(item);
    expect(trip.events.map((e) => [e.id, e.title])).toEqual([['a', 'First'], ['b', 'Second']]);
    expect(trip.events[0]).not.toHaveProperty('createdAt');
    expect(trip.shareToken).toBe(item.shareToken);
  });

  test('files are listed oldest first and fall back to the trip when their event is gone', () => {
    const trip = toApiTrip({
      ...item,
      files: {
        f2: { name: 'b.pdf', size: 2, type: 'application/pdf', eventId: 'gone', createdAt: '2' },
        f1: { name: 'a.png', size: 1, type: 'image/png', eventId: 'a', createdAt: '1', createdBy: 'Dewei' },
      },
    });
    expect(trip.files).toEqual([
      { id: 'f1', name: 'a.png', size: 1, type: 'image/png', eventId: 'a', createdAt: '1' },
      { id: 'f2', name: 'b.pdf', size: 2, type: 'application/pdf', eventId: '', createdAt: '2' },
    ]);
    expect(toApiTrip({ ...item, files: undefined }).files).toEqual([]);
  });

  test('summaries carry a short excerpt and the shared flag', () => {
    const summary = toSummary(item);
    expect(summary.excerpt.length).toBeLessThanOrEqual(280);
    expect(summary.excerpt.endsWith('…')).toBe(true);
    expect(summary.shared).toBe(true);
    expect(summary).not.toHaveProperty('events');
  });
});
