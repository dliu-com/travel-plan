'use strict';

// In-memory stand-in for lambda/api/s3.js. The dev server serves these objects under /dev-files/.
const { downloadParams, fileKey, uploadKey } = require('../lambda/api/s3');

function createMemoryFiles({ base = '' } = {}) {
  const objects = new Map();
  const url = (key, query) => `${base}/dev-files/${key}${query ? `?${new URLSearchParams(query)}` : ''}`;

  return {
    objects,
    origin: base,
    put(key, body, type) {
      objects.set(key, { body: Buffer.from(body), type: type || 'application/octet-stream' });
    },
    uploadUrl(tripId, fileId, { type }) {
      return { url: url(uploadKey(tripId, fileId)), headers: { 'content-type': type } };
    },
    downloadUrl(tripId, fileId, file, { download = false } = {}) {
      return url(fileKey(tripId, fileId), downloadParams(file, download));
    },
    async uploaded(tripId, fileId) {
      const object = objects.get(uploadKey(tripId, fileId));
      return object ? { size: object.body.length, type: object.type } : null;
    },
    async keep(tripId, fileId) {
      objects.set(fileKey(tripId, fileId), objects.get(uploadKey(tripId, fileId)));
      objects.delete(uploadKey(tripId, fileId));
    },
    async remove(tripId, fileId) {
      objects.delete(fileKey(tripId, fileId));
    },
    async removeTrip(tripId) {
      for (const key of [...objects.keys()]) if (key.startsWith(fileKey(tripId, ''))) objects.delete(key);
    },
  };
}

module.exports = { createMemoryFiles };
