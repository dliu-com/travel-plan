'use strict';

// In-memory stand-in for lambda/api/store.js, used by the tests and the local dev server.
const { NotFound, TooLarge } = require('../lambda/api/store');
const { MAX_EVENTS, newEventId, newShareToken, newTripId } = require('../lambda/api/trips');

function createMemoryStore({ now = () => new Date().toISOString() } = {}) {
  const trips = new Map();
  const clone = (value) => (value == null ? value : structuredClone(value));
  const need = (id) => {
    const trip = trips.get(id);
    if (!trip) throw new NotFound('Not found');
    return trip;
  };
  const touch = (trip, user) => Object.assign(trip, { updatedAt: now(), updatedBy: user });

  return {
    trips,
    async listTrips() {
      return [...trips.values()].map(clone);
    },
    async getTrip(id) {
      return clone(trips.get(id) || null);
    },
    async getSharedTrip(token) {
      return clone([...trips.values()].find((trip) => trip.shareToken === token) || null);
    },
    async shareTrip(id, user) {
      const trip = need(id);
      trip.shareToken = trip.shareToken || newShareToken();
      trip.updatedBy = user;
      return clone(trip);
    },
    async unshareTrip(id, user) {
      const trip = need(id);
      delete trip.shareToken;
      trip.updatedBy = user;
      return clone(trip);
    },
    async createTrip(fields, user) {
      const at = now();
      const item = { id: newTripId(fields.title), ...fields, events: {}, createdAt: at, updatedAt: at, updatedBy: user };
      trips.set(item.id, item);
      return clone(item);
    },
    async updateTrip(id, fields, user) {
      return clone(touch(Object.assign(need(id), fields), user));
    },
    async deleteTrip(id) {
      need(id);
      trips.delete(id);
    },
    async addEvent(tripId, event, user) {
      const trip = need(tripId);
      if (Object.keys(trip.events).length >= MAX_EVENTS) throw new TooLarge(`A trip can have at most ${MAX_EVENTS} events`);
      const id = newEventId();
      const at = now();
      trip.events[id] = { ...event, createdAt: at, updatedAt: at };
      return { id, trip: clone(touch(trip, user)) };
    },
    async updateEvent(tripId, eventId, event, user) {
      const trip = need(tripId);
      if (!trip.events[eventId]) throw new NotFound('Not found');
      Object.assign(trip.events[eventId], event, { updatedAt: now() });
      return clone(touch(trip, user));
    },
    async deleteEvent(tripId, eventId, user) {
      const trip = need(tripId);
      if (!trip.events[eventId]) throw new NotFound('Not found');
      delete trip.events[eventId];
      return clone(touch(trip, user));
    },
  };
}

module.exports = { createMemoryStore };
