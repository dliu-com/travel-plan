const fs = require('fs');
const path = require('path');

const web = (file) => fs.readFileSync(path.join(__dirname, '..', 'web', file), 'utf8');
const siteNav = (html) => html.match(/<nav class="dl-nav" aria-label="Site">([\s\S]*?)<\/nav>/)[1];
const links = (nav) => [...nav.matchAll(/<a class="([^"]+)" href="([^"]+)"([^>]*)>([^<]*)<\/a>/g)].map(([, cls, href, attrs, text]) => ({ cls, href, attrs, text }));

test('the app header links to About and the Docs page once each', () => {
  const nav = links(siteNav(web('index.html')));
  expect(nav.map((a) => [a.href, a.text])).toEqual([['/about', 'About'], ['/docs/api', 'Docs']]);
  expect(nav.map((a) => a.cls)).toEqual(['dl-nav-link', 'dl-button']);
  expect(nav[1].attrs).toContain('data-nav="docs"');
});

test('the app header keeps Sign in / Sign out between Docs and the language switch', () => {
  const nav = siteNav(web('index.html'));
  expect(nav.indexOf('data-nav="docs"')).toBeLessThan(nav.indexOf('id="account"'));
  expect(nav.indexOf('id="account"')).toBeLessThan(nav.indexOf('class="dl-language"'));
  const app = web('app.js');
  expect(app).toContain("class: 'dl-button dl-signin'");
  expect(app).toContain("class: 'dl-account'");
});

test('the Docs page header marks Docs as current, not About', () => {
  const nav = links(siteNav(web('docs-api.html')));
  expect(nav.map((a) => [a.href, a.text])).toEqual([['/about', 'About'], ['/docs/api', 'Docs']]);
  expect(nav[0].attrs).not.toContain('aria-current');
  expect(nav[1].attrs).toContain('aria-current="page"');
});

test('the Docs label is localised with the rest of the header', () => {
  expect(web('app.js')).toContain(`document.querySelector('[data-nav="docs"]').textContent = t('文档', 'Docs');`);
});

test('the footer About link is localised too', () => {
  expect(web('index.html')).toContain('<a href="/about" data-footer="about">About</a></footer>');
  expect(web('app.js')).toContain(`document.querySelector('[data-footer="about"]').textContent = t('关于', 'About');`);
});
