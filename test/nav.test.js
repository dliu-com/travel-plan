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

test('the API docs page header has the Docs button, marked current, and the language switch', () => {
  const html = siteNav(web('docs-api.html'));
  const nav = links(html);
  expect(nav.map((a) => [a.href, a.text])).toEqual([['/docs', 'Docs']]);
  expect(nav[0].attrs).toContain('aria-current="page"');
  expect(html.trim().endsWith('</div></div>')).toBe(true);
  expect(html).toContain('<div class="dl-language"><button type="button" class="dl-button dl-language-toggle" aria-controls="dl-languages"');
  expect(web('docs-api.js')).toContain("localStorage.getItem(KEY)");
  expect(web('docs-api.js')).toContain("const KEY = 'plan-language';");
  expect(web('app.js')).toContain("const LANGUAGE_KEY = 'plan-language';");
});

test('every docs page has the same five tabs in the same order', () => {
  const want = [['/docs', 'Technical architecture'], ['/docs/cost', 'Cost'], ['/docs/security', 'Security'], ['/docs/api', 'API'], ['/docs/health', 'Health checks']];
  const html = web('docs-api.html').match(/<nav class="dl-tabs"[^>]*>([\s\S]*?)<\/nav>/)[1];
  expect([...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map(([, href, text]) => [href, text])).toEqual(want);
  expect(web('info.js')).toContain("[['/docs', t('技术架构', 'Technical architecture')], ['/docs/cost', t('运行成本', 'Cost')], ['/docs/security', t('安全', 'Security')], ['/docs/api', 'API'], ['/docs/health', t('测试', 'Health checks')]]");
});

test('the Docs label is localised with the rest of the header', () => {
  expect(web('app.js')).toContain(`document.querySelector('[data-nav="docs"]').textContent = t('文档', 'Docs');`);
});

test('every footer ends dliu.com · Docs, localised', () => {
  expect(web('index.html')).toContain('<a href="https://dliu.com">dliu.com</a> · <a href="/docs" data-footer="docs">Docs</a></footer>');
  expect(web('app.js')).toContain(`document.querySelector('[data-footer="docs"]').textContent = t('文档', 'Docs');`);
  expect(web('docs-api.html')).toContain('<a href="https://dliu.com">dliu.com</a> · <a href="/docs" data-zh="文档" data-en="Docs">Docs</a></footer>');
});
