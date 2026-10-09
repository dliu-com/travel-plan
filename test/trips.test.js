'use strict';

const {
  BadRequest, SHARE_TOKEN, TRIP_ID, compareEvents, compareSummaries, newShareToken, newTripId,
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
    expect(parseEvent({ date: '2026-11-13', time: '06:30', title: 'Inari', place: 'Fushimi', notes: 'early', link: 'https://inari.jp' }))
      .toEqual({ date: '2026-11-13', time: '06:30', title: 'Inari', place: 'Fushimi', notes: 'early', link: 'https://inari.jp/' });
  });

  test('allows undated, untimed events', () => {
    expect(parseEvent({ title: 'Maybe' })).toEqual({ date: '', time: '', title: 'Maybe', place: '', notes: '', link: '' });
  });

  test('rejects unsafe links and bad times', () => {
    expect(() => parseEvent({ title: 'x', link: 'javascript:alert(1)' })).toThrow(/http/);
    expect(() => parseEvent({ title: 'x', link: 'not a url' })).toThrow(/full URL/);
    expect(() => parseEvent({ title: 'x', time: '24:00' })).toThrow(/HH:MM/);
  });
});

describe('ids', () => {
  test('trip ids are readable slugs with a random suffix', () => {
    const id = newTripId('Autumn in Kyōto!', Buffer.alloc(8, 255));
    expect(id).toMatch(/^autumn-in-kyoto-[a-z0-9]{10}$/);
    expect(TRIP_ID.test(id)).toBe(true);
    expect(newTripId('東京')).toMatch(/^trip-[a-z0-9]{10}$/);
    expect(TRIP_ID.test(newTripId('x'.repeat(100)))).toBe(true);
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

  test('shared trips hide the id, token and editor', () => {
    const shared = toSharedTrip(item);
    expect(shared).not.toHaveProperty('id');
    expect(shared).not.toHaveProperty('shareToken');
    expect(shared).not.toHaveProperty('updatedBy');
    expect(shared.events).toHaveLength(2);
  });

  test('summaries carry a short excerpt and the shared flag', () => {
    const summary = toSummary(item);
    expect(summary.excerpt.length).toBeLessThanOrEqual(280);
    expect(summary.excerpt.endsWith('…')).toBe(true);
    expect(summary.shared).toBe(true);
    expect(summary).not.toHaveProperty('events');
  });
});
