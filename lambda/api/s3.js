'use strict';

// Attachments live in a private bucket. Browsers upload and download directly with short-lived presigned URLs;
// the Lambda only signs, copies and deletes.
const crypto = require('crypto');

const UPLOAD_PREFIX = 'pending/';
const FILE_PREFIX = 'trips/';
const UPLOAD_SECONDS = 15 * 60;
const DOWNLOAD_SECONDS = 5 * 60;
// Shown in the browser; anything else (and anything that could run script) downloads instead.
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|avif|heic|heif)|application\/pdf|text\/plain|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/;

const uploadKey = (tripId, fileId) => `${UPLOAD_PREFIX}${tripId}/${fileId}`;
const fileKey = (tripId, fileId) => `${FILE_PREFIX}${tripId}/${fileId}`;
const tripPrefix = (tripId) => `${FILE_PREFIX}${tripId}/`;

// RFC 3986 encoding, as SigV4 expects.
const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const sha256 = (data) => crypto.createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();

// SigV4 query-string signing (https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html).
function presignUrl({ method, host, key, region, credentials, expires, date, query = {}, headers = {} }) {
  const amzDate = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const signed = { host, ...Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value).trim()])) };
  const names = Object.keys(signed).sort();
  const params = {
    ...query,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${credentials.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': names.join(';'),
    ...(credentials.sessionToken ? { 'X-Amz-Security-Token': credentials.sessionToken } : {}),
  };
  const canonicalQuery = Object.entries(params)
    .map(([name, value]) => [encode(name), encode(value)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  const path = `/${key.split('/').map(encode).join('/')}`;
  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    names.map((name) => `${name}:${signed[name]}\n`).join(''),
    names.join(';'),
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = ['s3', 'aws4_request'].reduce(hmac, hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), region));
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// Content-Disposition with a plain-ASCII fallback name and the real (UTF-8) name.
function contentDisposition(kind, name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encode(name)}`;
}

function downloadParams({ name, type }, download) {
  const inline = !download && INLINE_TYPES.test(type);
  return {
    'response-content-disposition': contentDisposition(inline ? 'inline' : 'attachment', name),
    'response-content-type': inline ? type : 'application/octet-stream',
  };
}

function createFiles({
  bucket = process.env.FILES_BUCKET,
  region = process.env.AWS_REGION,
  client,
  credentials = () => ({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  }),
  now = () => new Date(),
} = {}) {
  let s3;
  const lib = () => require('@aws-sdk/client-s3');
  const send = (command) => {
    s3 = s3 || client || new (lib().S3Client)({ region });
    return s3.send(command);
  };
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const sign = (options) => presignUrl({ host, region, credentials: credentials(), date: now(), ...options });

  return {
    origin: `https://${host}`,

    uploadUrl(tripId, fileId, { size, type }) {
      return {
        url: sign({ method: 'PUT', key: uploadKey(tripId, fileId), expires: UPLOAD_SECONDS, headers: { 'content-length': size, 'content-type': type } }),
        headers: { 'content-type': type },
      };
    },

    downloadUrl(tripId, fileId, file, { download = false } = {}) {
      return sign({ method: 'GET', key: fileKey(tripId, fileId), expires: DOWNLOAD_SECONDS, query: downloadParams(file, download) });
    },

    // Size and type of a finished upload, or null if nothing arrived.
    async uploaded(tripId, fileId) {
      try {
        const head = await send(new (lib().HeadObjectCommand)({ Bucket: bucket, Key: uploadKey(tripId, fileId) }));
        return { size: head.ContentLength, type: head.ContentType || 'application/octet-stream' };
      } catch (error) {
        if (error.name === 'NotFound' || error.name === 'NoSuchKey' || (error.$metadata && error.$metadata.httpStatusCode === 404)) return null;
        throw error;
      }
    },

    // Move a finished upload out of pending/ (which expires after a day) into the trip's folder.
    async keep(tripId, fileId) {
      const { CopyObjectCommand, DeleteObjectCommand } = lib();
      await send(new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${uploadKey(tripId, fileId)}`,
        Key: fileKey(tripId, fileId),
      }));
      await send(new DeleteObjectCommand({ Bucket: bucket, Key: uploadKey(tripId, fileId) }));
    },

    async remove(tripId, fileId) {
      await send(new (lib().DeleteObjectCommand)({ Bucket: bucket, Key: fileKey(tripId, fileId) }));
    },

    async removeTrip(tripId) {
      const { DeleteObjectsCommand, ListObjectsV2Command } = lib();
      let ContinuationToken;
      do {
        const page = await send(new ListObjectsV2Command({ Bucket: bucket, Prefix: tripPrefix(tripId), ContinuationToken }));
        const objects = (page.Contents || []).map(({ Key }) => ({ Key }));
        if (objects.length) await send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }));
        ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (ContinuationToken);
    },
  };
}

module.exports = { createFiles, downloadParams, fileKey, presignUrl, uploadKey, UPLOAD_PREFIX };
