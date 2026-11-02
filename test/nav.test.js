const fs = require('fs');
const path = require('path');

const web = (file) => fs.readFileSync(path.join(__dirname, '..', 'web', file), 'utf8');
const siteNav = (html) => html.match(/<nav class="site-nav"[^>]*>([\s\S]*?)<\/nav>/)[1];
const links = (nav) => [...nav.matchAll(/<a href="([^"]+)"([^>]*)>([^<]*)<\/a>/g)].map(([, href, attrs, text]) => ({ href, attrs, text }));

test('the app header links to About and the Docs page once each', () => {
  const nav = links(siteNav(web('index.html')));
  expect(nav.map((a) => [a.href, a.text])).toEqual([['/about', 'About'], ['/docs/api', 'Docs']]);
  expect(nav[1].attrs).toContain('data-nav="docs"');
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
