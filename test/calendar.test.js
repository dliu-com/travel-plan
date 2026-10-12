const { layout } = require('../web/calendar');
const { parseEvent, toApiTrip } = require('../lambda/api/trips');
const event = (time, endTime) => ({ title: 'Test', time, endTime });
test('overlapping groups use separate lanes and reclaim space afterwards', () => {
  const items = layout([event('10:00', '12:00'), event('10:30', '11:00'), event('11:00', '11:30'), event('12:00', '13:00')]);
  expect(items.map(i => [i.lane, i.lanes])).toEqual([[0, 2], [1, 2], [1, 2], [0, 1]]);
});
test('unset duration has a display block, and midnight clips at day end', () => {
  expect(layout([event('09:15')])[0]).toMatchObject({ start: 555, end: 585 });
  expect(layout([event('23:50')])[0]).toMatchObject({ start: 1430, end: 1440 });
});
test('end time validates and survives API serialization', () => {
  const parsed = parseEvent(event('18:00', '23:59'));
  expect(toApiTrip({ events: { e: parsed } }).events[0].endTime).toBe('23:59');
  for (const [start, end] of [['', '12:00'], ['12:00', '11:00'], ['12:00', '12:00'], ['12:00', '25:00']]) expect(() => parseEvent(event(start, end))).toThrow();
  expect(parseEvent(event('12:00', '')).endTime).toBe('');
  expect(layout([event('12:00', '12:10')])[0].end).toBe(730);
});
test('saving without an end time clears an old one', () => {
  expect(parseEvent({ title: 'Test', time: '09:00' })).toMatchObject({ time: '09:00', endTime: '' });
});
