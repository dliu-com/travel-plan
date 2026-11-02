const fs = require('fs');
const path = require('path');

// plan.dliu.com uses the shared dliu.com look: https://files.dliu.com/dliu.com/README.md
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const DL_CSS = '<link rel="stylesheet" href="https://files.dliu.com/dliu.com/ui/v1/dl.css">';
const DL_DOCS_CSS = '<link rel="stylesheet" href="https://files.dliu.com/dliu.com/ui/v1/dl-docs.css">';
const DL_ICON = 'https://files.dliu.com/dliu.com/favicon.png';
const PAGES = ['index', 'docs-api'];

test('every page loads the shared stylesheets before its own', () => {
  for (const html of PAGES) {
    const page = read(`web/${html}.html`);
    const own = page.indexOf('<link rel="stylesheet" href="/style.css">');
    expect(page.indexOf(DL_CSS)).toBeGreaterThan(0);
    expect(page.indexOf(DL_CSS)).toBeLessThan(page.indexOf(DL_DOCS_CSS));
    expect(page.indexOf(DL_DOCS_CSS)).toBeLessThan(own);
    expect(page).toContain('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
  }
});

test('every page has the shared header with the DL icon, and the shared footer', () => {
  for (const html of PAGES) {
    const page = read(`web/${html}.html`);
    expect(page).toContain('<link rel="icon" type="image/png" sizes="64x64" href="/icon.png">');
    expect(page).toContain('<body class="dl-page">');
    expect(page).toContain('<header class="dl-header">');
    // The app's own logo and name, top left; the shared DL logo starts the footer.
    expect(page).toContain('<a class="dl-brand" href="/"><img class="dl-logo" src="/icon.png" alt="" width="32" height="32">DL Travel Plan</a>');
    expect(page).toContain('<nav class="dl-nav" aria-label="Site">');
    expect(page).toMatch(/<main class="dl-main[" ]/);
    expect(page).toContain(`<footer class="dl-footer"><a class="dl-footer-logo" href="https://dliu.com" aria-label="dliu.com"><img src="${DL_ICON}" alt="" width="24" height="24"></a> <a href="https://dliu.com">dliu.com</a>`);
  }
  expect(fs.existsSync(path.join(__dirname, '..', 'web/icon.png'))).toBe(true);
  // The script translates the name without dropping the logo.
  expect(read('web/app.js')).toContain("document.querySelector('.dl-brand').lastChild.nodeValue = brand();");
});

test('the app uses the shared language switcher, last in the menu', () => {
  const page = read('web/index.html');
  const nav = page.match(/<nav class="dl-nav" aria-label="Site">([\s\S]*?)<\/nav>/)[1];
  expect(nav.trim().endsWith('</div></div>')).toBe(true);
  expect(nav).toContain('<div class="dl-language"><button type="button" class="dl-button dl-language-toggle" aria-controls="dl-languages" aria-expanded="false" aria-label="Language / 语言">文/A</button><div id="dl-languages" class="dl-languages" role="group" aria-label="Language / 语言"><button type="button" data-language="zh" lang="zh-CN" aria-pressed="true">中文</button><button type="button" data-language="en" lang="en" aria-pressed="false">English</button></div></div>');
  const app = read('web/app.js');
  expect(app).toContain("document.querySelector('.dl-language-toggle')");
  expect(app).toContain("document.getElementById('dl-languages')");
});

test('docs pages use the shared docs layout and tabs', () => {
  const page = read('web/docs-api.html');
  expect(page).toContain('<main class="dl-main dl-docs-main" id="main">');
  expect(page).toContain('<nav class="dl-tabs" aria-label="Docs sections">');
  expect(page).toContain('<article class="dl-docs">');
  // /about and /security are rendered into the app shell with the same pieces.
  const info = read('web/info.js');
  expect(info).toContain("el('nav', 'dl-tabs')");
  expect(info).toContain("t('文档栏目', 'Docs sections')");
  expect(info).toContain("el('article', 'dl-docs')");
  expect(read('web/app.js')).toContain("main.classList.toggle('dl-docs-main', kind === 'docs')");
});

test('the app uses the shared buttons and sign-in', () => {
  const app = read('web/app.js');
  expect(app).not.toMatch(/class: '(primary|small|danger|link)['\s]/);
  expect(app).toContain("class: 'dl-ms-signin'");
  expect(app).toContain("class: 'dl-button dl-button-primary'");
});

test('the app stylesheet leaves the header, buttons, tabs and palette to the shared stylesheets', () => {
  const css = read('web/style.css');
  expect(css).not.toMatch(/header\.site|\.brand\b|\.site-nav|\.languages?\b|\.language-toggle|^\s*button|\.button\b|\.info-tabs|\.ms-signin|footer\./m);
  expect(css).not.toMatch(/--(bg|card|text|muted|accent|accent-soft|line|danger|gold|gold-soft):/);
  expect(css).not.toMatch(/var\(--(bg|card|text|muted|accent|accent-soft|line|danger|gold|gold-soft)\)/);
  expect(css).not.toMatch(/prefers-color-scheme/);
  // dl.css styles every field, date and time included.
  expect(css).not.toMatch(/^input\[type=(date|time)/m);
  // The diagram kit comes from dl-docs.css; only the larger card icon is the app's own.
  expect(css.match(/^\.dg[-\w]*/gm).sort()).toEqual(['.dg-icon-large', '.dg-icon-large']);
});
