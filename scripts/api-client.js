#!/usr/bin/env node
'use strict';

// Calls the travel plan managed API with a Microsoft access token from auth.dliu.com (see /docs/api).
// It never signs in, creates or writes credentials, follows redirects, prints presigned storage URLs,
// or sends the bearer token anywhere except the managed API origin.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const routes = require('../lambda/api/routes.json');

const USAGE = `Usage:
  node scripts/api-client.js GET|POST|PUT|DELETE /api/path [JSON]
  node scripts/api-client.js upload <tripId> <local-file> [name]
  node scripts/api-client.js download <tripId> <fileId> <new-local-file>
  node scripts/api-client.js pdf <tripId> <new-local-file> [en|zh] [time-zone]`;

const TYPES = {
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.heic': 'image/heic', '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.zip': 'application/zip',
};
const MAX_FILE_BYTES = 50 * 1024 * 1024;

function readConfig(env = process.env) {
  if (!env.TRIP_API_URL) throw new Error('Set TRIP_API_URL to the managed API origin from https://plan.dliu.com/docs/api');
  const endpoint = new URL(env.TRIP_API_URL);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password ||
      endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
    throw new Error('TRIP_API_URL must be an HTTPS API origin without a path or credentials');
  }
  if (Object.hasOwn(env, 'TRIP_API_ACCESS_TOKEN')) {
    if (typeof env.TRIP_API_ACCESS_TOKEN !== 'string' || !/^[A-Za-z0-9._~+/-]+=*$/.test(env.TRIP_API_ACCESS_TOKEN)) {
      throw new Error('TRIP_API_ACCESS_TOKEN must contain only bearer-token characters');
    }
    return { endpoint: endpoint.origin, accessToken: env.TRIP_API_ACCESS_TOKEN };
  }
  // Tokens come only from auth.dliu.com (copied, or saved with Save file); this client never signs in itself.
  const credentialFile = Object.hasOwn(env, 'TRIP_API_TOKEN_FILE') ? env.TRIP_API_TOKEN_FILE :
    path.join(env.HOME || os.homedir(), '.dliu_token');
  if (typeof credentialFile !== 'string' || !path.isAbsolute(credentialFile) || credentialFile.includes('\0')) {
    throw new Error('TRIP_API_TOKEN_FILE must be an absolute credential-file path');
  }
  return { endpoint: endpoint.origin, credentialFile };
}

const FILE_FORMAT = 'Credential file needs exactly one token= line and one expires_at= UTC line; use Save file at auth.dliu.com';
const JWT_FORMAT = 'Credential file token must be a JWT access token with an integer exp; save a fresh file at auth.dliu.com';

function readAccessToken(config, now = Date.now()) {
  if (config.accessToken) return config.accessToken;
  if (!config.credentialFile) throw new Error('Use a saved or copied token from auth.dliu.com for this request');
  let content;
  try {
    content = fs.readFileSync(config.credentialFile, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read credential file (${error.code || 'read failed'}); use Save file at auth.dliu.com`);
  }
  const fields = {};
  for (const line of content.split(/\r?\n/).filter((value) => value !== '')) {
    const index = line.indexOf('=');
    const name = line.slice(0, index);
    if (index < 1 || !['token', 'expires_at'].includes(name) || Object.hasOwn(fields, name)) throw new Error(FILE_FORMAT);
    fields[name] = line.slice(index + 1);
  }
  if (Object.keys(fields).length !== 2) throw new Error(FILE_FORMAT);
  const token = fields.token;
  const parts = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? token.split('.') : [];
  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0] || '', 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1] || '', 'base64url').toString('utf8'));
  } catch {
    throw new Error(JWT_FORMAT);
  }
  if (!header || typeof header.alg !== 'string' || !header.alg ||
      !claims || !Number.isSafeInteger(claims.exp) || claims.exp <= 0 || !Number.isSafeInteger(claims.exp * 1000)) {
    throw new Error(JWT_FORMAT);
  }
  const expiresAt = Date.parse(fields.expires_at);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(fields.expires_at) ||
      !Number.isFinite(expiresAt) || new Date(expiresAt).toISOString() !==
      (fields.expires_at.includes('.') ? fields.expires_at : fields.expires_at.replace('Z', '.000Z'))) {
    throw new Error('Credential file expires_at must be a valid ISO UTC timestamp; use Save file at auth.dliu.com');
  }
  // Local expiry checks do not verify the JWT signature or replace gateway authorization.
  if (Math.min(expiresAt, claims.exp * 1000) <= now) {
    throw new Error('Saved Microsoft access token has expired; obtain a fresh token and save the file again at auth.dliu.com');
  }
  return token;
}

// The managed route key ("PUT /api/trips/{tripId}") for a concrete method and path, or null.
function routeKey(method, apiPath) {
  for (const key of Object.keys(routes)) {
    const [routeMethod, pattern] = key.split(' ');
    const regex = new RegExp(`^${pattern.replace(/\{[^}]+\}/g, '[A-Za-z0-9_-]+')}$`);
    if (routeMethod === method && regex.test(apiPath)) return key;
  }
  return null;
}

// Presigned storage URLs carry their own authorization; refuse anything that isn't plain HTTPS S3.
function storageUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || !/(^|\.)s3[.-]([a-z0-9-]+\.)?amazonaws\.com$/.test(url.hostname)) {
    throw new Error('Unexpected storage URL from the API');
  }
  return url.href;
}

function createClient(config, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const token = async () => readAccessToken(config, (deps.now || Date.now)());

  async function call(method, apiPath, { body, query } = {}) {
    const key = routeKey(method, apiPath);
    if (!key) throw new Error('Unknown travel plan API method or path');
    const search = query ? `?${new URLSearchParams(query)}` : '';
    const response = await fetchImpl(config.endpoint + apiPath + search, {
      method,
      redirect: 'error',
      headers: { authorization: `Bearer ${await token()}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { key, response };
  }

  async function failure(response) {
    const text = await response.text();
    let result = {};
    try { result = JSON.parse(text); } catch { /* not JSON */ }
    return new Error(`Travel plan API ${response.status}: ${result.error || result.message || 'Request failed'}`);
  }

  async function request(method, apiPath, body) {
    const key = routeKey(method, apiPath);
    if (key === 'POST /api/trips/{tripId}/files') throw new Error('Use: upload <tripId> <local-file> [name]');
    if (key === 'GET /api/trips/{tripId}/files/{fileId}') throw new Error('Use: download <tripId> <fileId> <new-local-file>');
    if (key === 'GET /api/trips/{tripId}/pdf') throw new Error('Use: pdf <tripId> <new-local-file> [en|zh]');
    const { response } = await call(method, apiPath, { body });
    if (!response.ok) throw await failure(response);
    return response.json();
  }

  async function writeNew(output, bytes) {
    // 'wx': never overwrite an existing file.
    await fs.promises.writeFile(output, bytes, { flag: 'wx', mode: 0o600 });
    return { saved: output, bytes: bytes.length };
  }

  async function download(tripId, fileId, output) {
    const { response } = await call('GET', `/api/trips/${tripId}/files/${fileId}`);
    if (!response.ok) throw await failure(response);
    const { url, file } = await response.json();
    // Straight to storage, without the bearer token.
    const stored = await fetchImpl(storageUrl(url), { redirect: 'error' });
    if (!stored.ok) throw new Error(`Storage download failed (${stored.status})`);
    return { ...(await writeNew(output, Buffer.from(await stored.arrayBuffer()))), file };
  }

  async function pdf(tripId, output, lang = 'en', timeZone) {
    if (!['en', 'zh'].includes(lang)) throw new Error('Language must be en or zh');
    const { response } = await call('GET', `/api/trips/${tripId}/pdf`, { query: { lang, ...(timeZone ? { tz: timeZone } : {}) } });
    if (!response.ok) throw await failure(response);
    return writeNew(output, Buffer.from(await response.arrayBuffer()));
  }

  async function upload(tripId, localFile, name = path.basename(localFile)) {
    const bytes = await fs.promises.readFile(localFile);
    if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error('Files must be 1 byte to 50 MB');
    const type = TYPES[path.extname(localFile).toLowerCase()] || 'application/octet-stream';
    const started = await call('POST', `/api/trips/${tripId}/files`, { body: { name, size: bytes.length, type } });
    if (!started.response.ok) throw await failure(started.response);
    const { fileId, uploadUrl, uploadHeaders } = await started.response.json();
    // Straight to storage, without the bearer token; the URL is signed for this size and type.
    const put = await fetchImpl(storageUrl(uploadUrl), { method: 'PUT', redirect: 'error', headers: uploadHeaders, body: bytes });
    if (!put.ok) throw new Error(`Storage upload failed (${put.status})`);
    const kept = await call('PUT', `/api/trips/${tripId}/files/${fileId}`, { body: { name } });
    if (!kept.response.ok) throw await failure(kept.response);
    const { trip } = await kept.response.json();
    return { fileId, file: trip.files.find((file) => file.id === fileId) };
  }

  return { request, download, pdf, upload };
}

async function main(args = process.argv.slice(2), env = process.env, deps = {}) {
  const [command, ...rest] = args;
  const print = deps.print || ((value) => console.log(JSON.stringify(value, null, 2)));
  const client = createClient(readConfig(env), deps);
  if (command === 'upload' && (rest.length === 2 || rest.length === 3)) return print(await client.upload(...rest));
  if (command === 'download' && rest.length === 3) return print(await client.download(...rest));
  if (command === 'pdf' && rest.length >= 2 && rest.length <= 4) return print(await client.pdf(...rest));
  if (['GET', 'POST', 'PUT', 'DELETE'].includes(command) && rest.length >= 1 && rest.length <= 2) {
    return print(await client.request(command, rest[0], rest[1] === undefined ? undefined : JSON.parse(rest[1])));
  }
  throw new Error(USAGE);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { createClient, main, readAccessToken, readConfig, routeKey, storageUrl };
