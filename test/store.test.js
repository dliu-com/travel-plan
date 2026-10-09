'use strict';

const { createStore, NotFound, SHARE_INDEX, TooLarge } = require('../lambda/api/store');

function fakeClient(responses = []) {
  const sent = [];
  return {
    sent,
    async send(command) {
      sent.push({ name: command.constructor.name, input: command.input });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next || {};
    },
  };
}

const conditionFailed = () => Object.assign(new Error('failed'), { name: 'ConditionalCheckFailedException' });
const now = () => '2026-10-01T00:00:00.000Z';

test('getSharedTrip re-checks the token on the item', async () => {
  const token = 'T'.repeat(24);
  const client = fakeClient([
    { Items: [{ id: 'kyoto-abcdefghij' }] },
    { Item: { id: 'kyoto-abcdefghij', shareToken: 'other' } },
  ]);
  const store = createStore({ client, table: 'Trips', now });
  expect(await store.getSharedTrip(token)).toBeNull();
  expect(client.sent[0]).toMatchObject({ name: 'QueryCommand', input: { IndexName: SHARE_INDEX, ExpressionAttributeValues: { ':t': token } } });
  expect(client.sent[1]).toMatchObject({ name: 'GetCommand', input: { ConsistentRead: true } });
});

test('shareTrip keeps an existing token', async () => {
  const client = fakeClient([{ Attributes: { id: 'x' } }]);
  await createStore({ client, table: 'Trips', now }).shareTrip('kyoto-abcdefghij', 'Dewei');
  expect(client.sent[0].input.UpdateExpression).toContain('if_not_exists(shareToken');
});

test('updateEvent sets fields individually so createdAt survives', async () => {
  const client = fakeClient([{ Attributes: {} }]);
  await createStore({ client, table: 'Trips', now }).updateEvent('kyoto-abcdefghij', 'evt12345', { title: 'a', date: '' }, 'Dewei');
  const { input } = client.sent[0];
  expect(input.UpdateExpression).toMatch(/^SET events\.#e\.#f0 = :f0, events\.#e\.#f1 = :f1, events\.#e\.updatedAt = :at/);
  expect(input.ConditionExpression).toContain('attribute_exists(events.#e)');
  expect(input.ExpressionAttributeNames).toEqual({ '#e': 'evt12345', '#f0': 'title', '#f1': 'date' });
});

test('missing trips become NotFound', async () => {
  const store = createStore({ client: fakeClient([conditionFailed()]), table: 'Trips', now });
  await expect(store.deleteTrip('kyoto-abcdefghij')).rejects.toBeInstanceOf(NotFound);
});

test('addEvent reports a full trip as TooLarge', async () => {
  const client = fakeClient([conditionFailed(), { Item: { id: 'kyoto-abcdefghij' } }]);
  await expect(createStore({ client, table: 'Trips', now }).addEvent('kyoto-abcdefghij', { title: 'x' }, 'Dewei'))
    .rejects.toBeInstanceOf(TooLarge);
});

test('listTrips pages through the table without loading events', async () => {
  const client = fakeClient([{ Items: [{ id: 'a' }], LastEvaluatedKey: { id: 'a' } }, { Items: [{ id: 'b' }] }]);
  expect(await createStore({ client, table: 'Trips', now }).listTrips()).toEqual([{ id: 'a' }, { id: 'b' }]);
  expect(client.sent[0].input.ProjectionExpression).not.toContain('events');
  expect(client.sent[1].input.ExclusiveStartKey).toEqual({ id: 'a' });
});
