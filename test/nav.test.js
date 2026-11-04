const fs = require('fs');
const path = require('path');

const web = (file) => fs.readFileSync(path.join(__dirname, '..', 'web', file), 'utf8');
const siteNav = (html) => html.match(/<nav class="dl-nav" aria-label="Site">([\s\S]*?)<\/nav>/)[1];
const links = (nav) => [...nav.matchAll(/<a class="([^"]+)" href="([^"]+)"([^>]*)>([^<]*)<\/a>/g)].map(([, cls, href, attrs, text]) => ({ cls, href, attrs, text }));

test('the app header has one docs entry: the Docs button to /docs', () => {
  const nav = links(siteNav(web('index.html')));
  expect(nav.map((a) => [a.href, a.text])).toEqual([['/docs', 'Docs']]);
  expect(nav.map((a) => a.cls)).toEqual(['dl-button']);
  expect(nav[0].attrs).toContain('data-nav="docs"');
  expect(web('index.html')).not.toMatch(/href="\/(about|security)"/);
});

test('the app header keeps Sign in / Sign out between Docs and the language switch', () => {
  const nav = siteNav(web('index.html'));
  expect(nav.indexOf('data-nav="docs"')).toBeLessThan(nav.indexOf('id="account"'));
  expect(nav.indexOf('id="account"')).toBeLessThan(nav.indexOf('class="dl-language"'));
  const app = web('app.js');
  expect(app).toContain("class: 'dl-button dl-signin'");
  expect(app).toContain("class: 'dl-account'");
});

test('every docs page is the app shell, so it has the same header, language switch and footer', () => {
  // /docs/api and /docs/health are now tabs on /docs (#api, #health); there is no separate docs page.
  expect(fs.existsSync(path.join(__dirname, '..', 'web', 'docs-api.html'))).toBe(false);
  expect(fs.existsSync(path.join(__dirname, '..', 'web', 'docs-api.js'))).toBe(false);
  expect(web('app.js')).toContain("const LANGUAGE_KEY = 'plan-language';");
});

test('every docs page has the same five tabs in the same order', () => {
  expect(web('info.js')).toContain("[['/docs', t('架构', 'Architecture')], ['/docs/cost', t('运行成本', 'Cost')], ['/docs/security', t('安全', 'Security')], ['/docs#api', 'API'], ['/docs#health', t('健康', 'Health')]]");
  expect(web('info.js')).not.toContain('Technical architecture');
  expect(web('app.js')).toContain("architecture: ['架构', 'Architecture']");
});

test('the Docs label is localised with the rest of the header', () => {
  expect(web('app.js')).toContain(`document.querySelector('[data-nav="docs"]').textContent = t('文档', 'Docs');`);
});

test('every footer ends dliu.com · Docs, localised', () => {
  expect(web('index.html')).toContain('<a href="https://dliu.com">dliu.com</a> · <a href="/docs" data-footer="docs">Docs</a></footer>');
  expect(web('app.js')).toContain(`document.querySelector('[data-footer="docs"]').textContent = t('文档', 'Docs');`);
});
