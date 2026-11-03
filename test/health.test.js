const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createHandler } = require('../lambda/api/index');
const { FUNCTIONS, CHECK_TIMEOUT_MS, health, probesFor } = require('../lambda/api/health');
const { createFiles } = require('../lambda/api/s3');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const KEYS = FUNCTIONS.map((f) => f.key);

// ------------------------------------------------------------------ the /health endpoint
const ok = { store: { getTrip: async () => null }, files: { reachable: async () => {} }, loadConfig: async () => ({ tenantId: 't', clientId: 'c', clientSecret: 's' }) };

// An event that throws if the handler touches anything a caller could send.
function sealedEvent(method = 'GET') {
  const forbidden = new Set(['headers', 'cookies', 'queryStringParameters', 'rawQueryString', 'body', 'isBase64Encoded', 'pathParameters']);
  return new Proxy({ rawPath: '/health', requestContext: { http: { method } } }, {
    get(target, key) {
      if (forbidden.has(key)) throw new Error(`/health read event.${String(key)}`);
      return target[key];
    },
  });
}

test('/health passes with every function and the health+json format, cached for 60 s', async () => {
  const handler = createHandler({ ...ok, now: () => Date.parse('2026-11-03T23:00:00.123Z') });
  const res = await handler(sealedEvent());
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toBe('application/health+json');
  expect(res.headers['cache-control']).toBe('public, max-age=60');
  expect(res.cookies).toBeUndefined();
  const body = JSON.parse(res.body);
  expect(body).toEqual({ status: 'pass', time: '2026-11-03T23:00:00Z', functions: FUNCTIONS.map((f) => ({ ...f, status: 'pass' })) });
  expect((await handler(sealedEvent('HEAD'))).statusCode).toBe(200);
});

test('/health reads no cookies, Authorization header, query string or body', async () => {
  // A cookie or token would make the sealed event throw; the source must not look at the event either.
  await expect(createHandler(ok)(sealedEvent())).resolves.toMatchObject({ statusCode: 200 });
  const source = read('lambda/api/health.js');
  expect(source).not.toMatch(/event|cookie|authorization|queryString/i);
  const index = read('lambda/api/index.js');
  const start = index.indexOf("if (path === '/health'");
  expect(start).toBeGreaterThan(0);
  const route = index.slice(start, index.indexOf('const params =', start));
  expect(route).toContain('health({ probes: probesFor({ store, files, getConfig }), now: clock })');
  expect(route).not.toMatch(/header|cookie|params|event\.(?!requestContext|rawPath)/i);
});

test('/health is only for GET and HEAD on the website path, never through the managed API', async () => {
  const handler = createHandler(ok);
  const post = await handler({ rawPath: '/health', requestContext: { http: { method: 'POST' } }, headers: {} });
  expect(post.statusCode).toBe(404);
  const managed = await handler({ rawPath: '/health', requestContext: { http: { method: 'GET' }, apiId: 'x', routeKey: 'GET /health', authorizer: { jwt: {} } }, headers: {} });
  expect(managed.statusCode).toBe(404);
});

test('/health fails with 503 and a generic reason, never the error itself', async () => {
  const secret = 'AccessDenied arn:aws:dynamodb:eu-west-1:123456789012:table/TravelPlan-Trips';
  const handler = createHandler({ ...ok, store: { getTrip: async () => { throw new Error(secret); } } });
  const res = await handler(sealedEvent());
  expect(res.statusCode).toBe(503);
  const body = JSON.parse(res.body);
  expect(body.status).toBe('fail');
  expect(body.functions.find((f) => f.key === 'trips')).toEqual({ key: 'trips', name: 'Travel plan storage', status: 'fail', output: 'read failed' });
  expect(res.body).not.toMatch(/AccessDenied|arn:|TravelPlan|123456789012|stack/);
});

test('/health reports incomplete sign-in settings as a failure without saying which', async () => {
  const res = await createHandler({ ...ok, loadConfig: async () => ({ tenantId: 't', clientId: '' }) })(sealedEvent());
  expect(res.statusCode).toBe(503);
  expect(JSON.parse(res.body).functions.find((f) => f.key === 'signin')).toMatchObject({ status: 'fail', output: 'read failed' });
});

test('a slow check is warn (still 200) and a hung one times out', async () => {
  let t = 0;
  const slow = await health({
    probes: { ...probesFor({ store: ok.store, files: ok.files, getConfig: ok.loadConfig }), files: async () => { t += 1500; } },
    clock: () => t,
  });
  expect(slow.statusCode).toBe(200);
  expect(JSON.parse(slow.body).status).toBe('warn');
  expect(JSON.parse(slow.body).functions.find((f) => f.key === 'files')).toMatchObject({ status: 'warn', output: 'slow' });

  jest.useFakeTimers();
  try {
    const pending = health({ probes: { ...probesFor({ store: ok.store, files: ok.files, getConfig: ok.loadConfig }), trips: () => new Promise(() => {}) } });
    await jest.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS + 1);
    const res = await pending;
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).functions.find((f) => f.key === 'trips')).toMatchObject({ status: 'fail', output: 'timeout' });
  } finally {
    jest.useRealTimers();
  }
});

test('the default checks are one GetItem of a fixed key and one HeadObject outside every plan', async () => {
  const keys = [];
  const store = { getTrip: async (id) => { keys.push(id); return null; } };
  const sent = [];
  const files = createFiles({ bucket: 'b', region: 'eu-west-1', client: { send: async (command) => {
    sent.push(command);
    throw Object.assign(new Error('NotFound'), { name: 'NotFound' });
  } } });
  const res = await health({ probes: probesFor({ store, files, getConfig: ok.loadConfig }) });
  expect(JSON.parse(res.body).status).toBe('pass');
  expect(keys).toEqual(['health-check']);
  expect(sent.map((c) => [c.constructor.name, c.input])).toEqual([['HeadObjectCommand', { Bucket: 'b', Key: 'health/health-check' }]]);
  // Any other S3 error is a failure.
  const denied = createFiles({ bucket: 'b', region: 'eu-west-1', client: { send: async () => { throw Object.assign(new Error('x'), { name: 'AccessDenied' }); } } });
  await expect(denied.reachable('health-check')).rejects.toThrow();
});

// ------------------------------------------------------------------ /docs/health (rendered with a tiny DOM)
class Node {
  constructor(tag) {
    this.tagName = tag;
    this.attributes = {};
    this.children = [];
    this.style = { setProperty() {} };
  }
  set className(value) { this.attributes.class = value; }
  get className() { return this.attributes.class || ''; }
  set href(value) { this.attributes.href = value; }
  set rel(value) { this.attributes.rel = value; }
  set scope(value) { this.attributes.scope = value; }
  set textContent(value) { this.children = [String(value)]; }
  get textContent() { return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  append(...nodes) { this.children.push(...nodes.map((n) => (n instanceof Node ? n : String(n)))); }
  all(test, out = []) {
    for (const child of this.children) if (child instanceof Node) { if (test(child)) out.push(child); child.all(test, out); }
    return out;
  }
  has(cls) { return this.className.split(' ').includes(cls); }
}

function renderHealth() {
  const root = new Node('root');
  const window = {};
  const document = { createElement: (tag) => new Node(tag), createElementNS: (ns, tag) => new Node(tag) };
  const context = vm.createContext({ window, document });
  vm.runInContext(read('web/diagram.js'), context);
  vm.runInContext(read('web/info.js'), context);
  root.append(...window.PlanInfo.health((zh, en) => en));
  return { root, info: window.PlanInfo };
}

test('/docs/health is a docs tab with a diagram of how the site is tested', () => {
  const { root } = renderHealth();
  const tabs = root.all((n) => n.has('dl-tabs'))[0];
  const current = tabs.all((n) => n.attributes['aria-current'] === 'page');
  expect(current.map((n) => [n.attributes.href, n.textContent])).toEqual([['/docs/health', 'Health checks']]);
  const flows = root.all((n) => n.has('dg-flow'));
  expect(flows.length).toBeGreaterThanOrEqual(2);
  expect(root.all((n) => n.has('dg-step')).length).toBeGreaterThanOrEqual(6);
  expect(root.all((n) => n.has('dg-arrow')).length).toBeGreaterThanOrEqual(3);
  for (const tone of ['dg-good', 'dg-warn', 'dg-bad']) expect(root.all((n) => n.has(tone))).toHaveLength(1);
  expect(root.textContent).toContain('status.dliu.com');
  expect(root.textContent).toContain('What isn’t tested');
});

test('/docs/health folds every technical detail in closed <details> and links the Markdown', () => {
  const { root } = renderHealth();
  const details = root.all((n) => n.tagName === 'details');
  expect(details.length).toBeGreaterThanOrEqual(2);
  for (const d of details) expect(d.attributes.open).toBeUndefined();
  const folded = details.map((d) => d.textContent).join('\n');
  const unfolded = (node) => node.children.map((c) => (typeof c === 'string' ? c : c.tagName === 'details' ? '' : unfolded(c))).join('\n');
  const outside = unfolded(root);
  for (const detail of ['application/health+json', 'max-age=60', 'https://plan.dliu.com/auth/login', '302', '"status": "pass"', 'User-Agent', 'GetItem', 'HeadObject']) {
    expect(folded).toContain(detail);
    expect(outside).not.toContain(detail);
  }
  const md = root.all((n) => n.attributes.href === '/docs/health.md');
  expect(md.map((n) => n.textContent)).toEqual(['Full technical version (Markdown)']);
});

// ------------------------------------------------------------------ keys and checks stay in sync
const markdown = read('web/docs/health.md');
const mdTable = (heading) => {
  const start = markdown.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const lines = markdown.slice(start).split('\n');
  const first = lines.findIndex((l) => l.startsWith('|'));
  const rows = [];
  for (const line of lines.slice(first + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(line.split('|').slice(1, -1).map((c) => c.trim().replace(/^`|`$/g, '')));
  }
  return rows;
};

test('/docs/health.md is the full technical version and is served as Markdown', () => {
  expect(markdown.startsWith('# plan.dliu.com health checks\n')).toBe(true);
  for (const heading of ['## Functions', '## Guest checks', '## Health endpoint', '## Not tested', '## Rules']) expect(markdown).toContain(heading);
  for (const detail of ['application/health+json', 'Cache-Control: public, max-age=60', 'dliu-status-bot/1.0 (+https://status.dliu.com/docs)', '503']) expect(markdown).toContain(detail);
  expect(markdown).not.toMatch(/<details/);
  expect(read('lib/travel-plan-stack.ts')).toContain("export const HEALTH_DOCS = 'docs/health.md';");
});

test('function keys match across /docs/health, /docs/health.md and /health', () => {
  const { root, info } = renderHealth();
  const pageKeys = root.all((n) => n.attributes['data-function']).map((n) => n.attributes['data-function']);
  expect(pageKeys).toEqual(info.HEALTH_FUNCTIONS.map((f) => f.key));
  const mdFunctions = mdTable('## Functions');
  expect(mdFunctions.map((r) => r[0])).toEqual(pageKeys);
  // Names and "critical" agree too.
  expect(mdFunctions.map((r) => [r[0], r[1], r[3] === 'yes'])).toEqual(info.HEALTH_FUNCTIONS.map((f) => [f.key, f.name[1], f.critical]));
  // /health reports exactly the functions the page and the Markdown say it does.
  expect(info.HEALTH_FUNCTIONS.filter((f) => f.health).map((f) => f.key).sort()).toEqual([...KEYS].sort());
  expect(info.HEALTH_ENDPOINT).toEqual(FUNCTIONS.map((f) => [f.key, f.name]));
  expect(mdTable('| Function key | What the check reads |').map((r) => r[0])).toEqual(KEYS);
  const sample = JSON.parse(markdown.match(/```json\n([\s\S]*?)```/)[1]);
  expect(sample.functions.map((f) => [f.key, f.name])).toEqual(FUNCTIONS.map((f) => [f.key, f.name]));
  const pageSample = JSON.parse(root.all((n) => n.tagName === 'pre')[0].textContent);
  expect(pageSample.functions.map((f) => [f.key, f.name])).toEqual(FUNCTIONS.map((f) => [f.key, f.name]));
});

test('guest checks match between /docs/health and /docs/health.md', () => {
  const { info } = renderHealth();
  const md = mdTable('## Guest checks').map(([key, method, url, status, type, marker]) => [key, method, url, status, type, marker]);
  const page = info.GUEST_CHECKS.map(([key, method, p, status, type, marker]) => [key, method, `https://plan.dliu.com${p}`, status, type, marker]);
  const plain = (s) => s.replace(/`/g, '');
  expect(md.map((r) => r.slice(0, 5).map(plain))).toEqual(page.map((r) => r.slice(0, 5)));
  expect(md.map((r) => plain(r[5]))).toEqual(page.map((r) => r[5]));
  for (const [, method] of md) expect(['GET', 'HEAD']).toContain(method);
});
