'use strict';

// GET /api/trips/<id>/pdf: the travel plan as a PDF download.
// Same access rules as the API: members, or the plan's share link (x-plan-token header).
const { HttpError, createAccess } = require('../api/access');
const { loadConfig, NotConfigured } = require('../api/config');
const { createStore } = require('../api/store');
const { TRIP_ID, toApiTrip } = require('../api/trips');
const { pdfFileName, renderPdf } = require('./render');

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};
// Function URL responses are capped at 6 MB, and the body is base64 (4/3 larger).
const MAX_PDF_BYTES = 4 * 1024 * 1024;
const PDF_PATH = /^\/api\/trips\/([^/]+)\/pdf$/;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

// ASCII fallback plus the UTF-8 name (RFC 6266), so Chinese titles survive.
function disposition(name, id) {
  return `attachment; filename="plan-${id}.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function createHandler(deps = {}) {
  const getConfig = deps.loadConfig || loadConfig;
  const store = deps.store || createStore();
  const clock = deps.now || Date.now;
  const { access } = createAccess({ getConfig, store, clock });

  return async function handler(event) {
    const method = (event.requestContext && event.requestContext.http && event.requestContext.http.method) || 'GET';
    const path = event.rawPath || '/';
    try {
      const match = PDF_PATH.exec(path);
      if (!match) throw new HttpError(404, 'Not found');
      if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
      const id = match[1];
      if (!TRIP_ID.test(id)) throw new HttpError(404, 'Travel plan not found');
      await access(event, id);
      const item = await store.getTrip(id);
      if (!item) throw new HttpError(404, 'Travel plan not found');

      const trip = toApiTrip(item);
      const params = event.queryStringParameters || {};
      const lang = params.lang === 'zh' ? 'zh' : 'en';
      const pdf = await renderPdf(trip, { lang, timeZone: params.tz, now: new Date(clock()), siteUrl: process.env.SITE_URL });
      if (pdf.length > MAX_PDF_BYTES) throw new HttpError(413, 'This travel plan is too long to export as a PDF');
      return {
        statusCode: 200,
        headers: {
          ...SECURITY_HEADERS,
          'content-type': 'application/pdf',
          'content-disposition': disposition(pdfFileName(trip, lang), id),
        },
        body: pdf.toString('base64'),
        isBase64Encoded: true,
      };
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { error: error.message });
      if (error instanceof NotConfigured) return json(503, { error: 'Sign-in is not configured yet. Run "make set-secrets".' });
      console.error(JSON.stringify({ message: 'PDF export failed', method, path, error: error.message, stack: error.stack }));
      return json(500, { error: 'Internal error' });
    }
  };
}

module.exports = { createHandler, handler: createHandler() };
