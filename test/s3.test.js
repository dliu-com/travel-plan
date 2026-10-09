'use strict';

const { createFiles, downloadParams, presignUrl } = require('../lambda/api/s3');

test('presigned URLs match the AWS SigV4 example', () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
  const url = presignUrl({
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    key: 'test.txt',
    region: 'us-east-1',
    credentials: { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
    expires: 86400,
    date: new Date('2013-05-24T00:00:00Z'),
  });
  expect(url).toBe('https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256'
    + '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z'
    + '&X-Amz-Expires=86400&X-Amz-SignedHeaders=host'
    + '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});

test('upload URLs are short-lived and pin the size and type', () => {
  const files = createFiles({
    bucket: 'b',
    region: 'eu-west-1',
    credentials: () => ({ accessKeyId: 'AK', secretAccessKey: 'SK', sessionToken: 'TOKEN' }),
    now: () => new Date('2026-10-01T00:00:00Z'),
  });
  const { url, headers } = files.uploadUrl('20261000', 'abcdefghijklmnop', { size: 123, type: 'image/png' });
  const parsed = new URL(url);
  expect(parsed.host).toBe('b.s3.eu-west-1.amazonaws.com');
  expect(parsed.pathname).toBe('/pending/20261000/abcdefghijklmnop');
  expect(parsed.searchParams.get('X-Amz-Expires')).toBe('900');
  expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
  expect(parsed.searchParams.get('X-Amz-Security-Token')).toBe('TOKEN');
  expect(headers).toEqual({ 'content-type': 'image/png' });
  expect(files.origin).toBe('https://b.s3.eu-west-1.amazonaws.com');
});

test('only safe types open in the browser; everything else downloads', () => {
  expect(downloadParams({ name: 'a.png', type: 'image/png' })).toEqual({
    'response-content-disposition': 'inline; filename="a.png"; filename*=UTF-8\'\'a.png',
    'response-content-type': 'image/png',
  });
  for (const type of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/javascript', 'application/octet-stream']) {
    expect(downloadParams({ name: 'x', type })).toMatchObject({ 'response-content-type': 'application/octet-stream' });
    expect(downloadParams({ name: 'x', type })['response-content-disposition']).toMatch(/^attachment;/);
  }
  expect(downloadParams({ name: 'a.png', type: 'image/png' }, true)['response-content-disposition']).toMatch(/^attachment;/);
  expect(downloadParams({ name: '行程 "x".pdf', type: 'application/pdf' })['response-content-disposition'])
    .toBe('inline; filename="__ _x_.pdf"; filename*=UTF-8\'\'%E8%A1%8C%E7%A8%8B%20%22x%22.pdf');
});
