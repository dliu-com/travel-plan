'use strict';

const { MAX_EVENTS, newEventId, newShareToken, newTripId } = require('./trips');

const SHARE_INDEX = 'byShareToken';

class NotFound extends Error {}
class TooLarge extends Error {}

let defaultClient;
function documentClient() {
  if (!defaultClient) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
    defaultClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return defaultClient;
}

const isConditionFailure = (error) => error && error.name === 'ConditionalCheckFailedException';
const isTooLarge = (error) => error && error.name === 'ValidationException' && /size/i.test(error.message || '');

function createStore({ client, table = process.env.TABLE_NAME, now = () => new Date().toISOString() } = {}) {
  const lib = require('@aws-sdk/lib-dynamodb');
  const send = (command) => (client || documentClient()).send(command);

  async function write(command) {
    try {
      return await send(command);
    } catch (error) {
      if (isConditionFailure(error)) throw new NotFound('Not found');
      if (isTooLarge(error)) throw new TooLarge('This trip is too large to save more text');
      throw error;
    }
  }

  return {
    async listTrips() {
      const items = [];
      let ExclusiveStartKey;
      do {
        const page = await send(new lib.ScanCommand({
          TableName: table,
          ProjectionExpression: 'id, title, destination, startDate, endDate, intro, shareToken, updatedAt',
          ExclusiveStartKey,
        }));
        items.push(...(page.Items || []));
        ExclusiveStartKey = page.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return items;
    },

    async getTrip(id) {
      const result = await send(new lib.GetCommand({ TableName: table, Key: { id }, ConsistentRead: true }));
      return result.Item || null;
    },

    // The index is eventually consistent, so re-check the token on the item itself:
    // a revoked link stops working immediately.
    async getSharedTrip(token) {
      const result = await send(new lib.QueryCommand({
        TableName: table,
        IndexName: SHARE_INDEX,
        KeyConditionExpression: 'shareToken = :t',
        ExpressionAttributeValues: { ':t': token },
        Limit: 1,
      }));
      const key = (result.Items || [])[0];
      if (!key) return null;
      const item = await this.getTrip(key.id);
      return item && item.shareToken === token ? item : null;
    },

    async shareTrip(id, user) {
      const result = await write(new lib.UpdateCommand({
        TableName: table,
        Key: { id },
        ConditionExpression: 'attribute_exists(id)',
        UpdateExpression: 'SET shareToken = if_not_exists(shareToken, :t), updatedBy = :by',
        ExpressionAttributeValues: { ':t': newShareToken(), ':by': user },
        ReturnValues: 'ALL_NEW',
      }));
      return result.Attributes;
    },

    async unshareTrip(id, user) {
      const result = await write(new lib.UpdateCommand({
        TableName: table,
        Key: { id },
        ConditionExpression: 'attribute_exists(id)',
        UpdateExpression: 'REMOVE shareToken SET updatedBy = :by',
        ExpressionAttributeValues: { ':by': user },
        ReturnValues: 'ALL_NEW',
      }));
      return result.Attributes;
    },

    async createTrip(fields, user) {
      const at = now();
      const item = { id: newTripId(fields.title), ...fields, events: {}, createdAt: at, updatedAt: at, updatedBy: user };
      await write(new lib.PutCommand({ TableName: table, Item: item, ConditionExpression: 'attribute_not_exists(id)' }));
      return item;
    },

    async updateTrip(id, fields, user) {
      const names = Object.keys(fields);
      const result = await write(new lib.UpdateCommand({
        TableName: table,
        Key: { id },
        ConditionExpression: 'attribute_exists(id)',
        UpdateExpression: `SET ${names.map((_, i) => `#f${i} = :f${i}`).join(', ')}, updatedAt = :at, updatedBy = :by`,
        ExpressionAttributeNames: Object.fromEntries(names.map((name, i) => [`#f${i}`, name])),
        ExpressionAttributeValues: {
          ...Object.fromEntries(names.map((name, i) => [`:f${i}`, fields[name]])),
          ':at': now(),
          ':by': user,
        },
        ReturnValues: 'ALL_NEW',
      }));
      return result.Attributes;
    },

    async deleteTrip(id) {
      await write(new lib.DeleteCommand({ TableName: table, Key: { id }, ConditionExpression: 'attribute_exists(id)' }));
    },

    // Events live in a map keyed by id, so two people editing different events never overwrite each other.
    async addEvent(tripId, event, user) {
      const at = now();
      const id = newEventId();
      try {
        const result = await write(new lib.UpdateCommand({
          TableName: table,
          Key: { id: tripId },
          ConditionExpression: 'attribute_exists(id) AND size(events) < :max',
          UpdateExpression: 'SET events.#e = :event, updatedAt = :at, updatedBy = :by',
          ExpressionAttributeNames: { '#e': id },
          ExpressionAttributeValues: { ':event': { ...event, createdAt: at, updatedAt: at }, ':at': at, ':by': user, ':max': MAX_EVENTS },
          ReturnValues: 'ALL_NEW',
        }));
        return { id, trip: result.Attributes };
      } catch (error) {
        if (error instanceof NotFound && await this.getTrip(tripId)) {
          throw new TooLarge(`A trip can have at most ${MAX_EVENTS} events`);
        }
        throw error;
      }
    },

    async updateEvent(tripId, eventId, event, user) {
      const at = now();
      const names = Object.keys(event);
      const result = await write(new lib.UpdateCommand({
        TableName: table,
        Key: { id: tripId },
        ConditionExpression: 'attribute_exists(id) AND attribute_exists(events.#e)',
        UpdateExpression: `SET ${names.map((_, i) => `events.#e.#f${i} = :f${i}`).join(', ')}, events.#e.updatedAt = :at, updatedAt = :at, updatedBy = :by`,
        ExpressionAttributeNames: { '#e': eventId, ...Object.fromEntries(names.map((name, i) => [`#f${i}`, name])) },
        ExpressionAttributeValues: {
          ...Object.fromEntries(names.map((name, i) => [`:f${i}`, event[name]])),
          ':at': at,
          ':by': user,
        },
        ReturnValues: 'ALL_NEW',
      }));
      return result.Attributes;
    },

    async deleteEvent(tripId, eventId, user) {
      const result = await write(new lib.UpdateCommand({
        TableName: table,
        Key: { id: tripId },
        ConditionExpression: 'attribute_exists(id) AND attribute_exists(events.#e)',
        UpdateExpression: 'REMOVE events.#e SET updatedAt = :at, updatedBy = :by',
        ExpressionAttributeNames: { '#e': eventId },
        ExpressionAttributeValues: { ':at': now(), ':by': user },
        ReturnValues: 'ALL_NEW',
      }));
      return result.Attributes;
    },
  };
}

module.exports = { createStore, NotFound, SHARE_INDEX, TooLarge };
