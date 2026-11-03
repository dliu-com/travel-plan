'use strict';

// Renders /docs/api.md on /docs/api. Only headings, paragraphs, lists, tables and fenced code;
// all text goes in through textContent, so the Markdown can never inject HTML.
(() => {
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  }

  function inline(node, text) {
    const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
    let start = 0;
    for (const match of text.matchAll(pattern)) {
      node.append(text.slice(start, match.index));
      if (match[1]) node.append(el('code', {}, match[1]));
      else if (match[4]) node.append(el('strong', {}, match[4]));
      else if (/^(https?:\/\/|\/(?!\/)|#)/.test(match[3])) node.append(el('a', { href: match[3] }, match[2]));
      else node.append(match[0]);
      start = match.index + match[0].length;
    }
    node.append(text.slice(start));
    return node;
  }

  function render(markdown) {
    const root = el('div');
    let titled = false;
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const block = (line) => /^(#{1,3} |```|\||- |\d+\. )/.test(line);
    const cells = (line) => line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
    for (let i = 0; i < lines.length;) {
      const line = lines[i];
      if (!line.trim()) { i += 1; continue; }
      if (line.startsWith('```')) {
        const content = [];
        i += 1;
        while (i < lines.length && !lines[i].startsWith('```')) content.push(lines[i++]);
        if (i === lines.length) throw new Error('Unclosed code block in API reference');
        root.append(el('pre', { class: 'code' }, content.join('\n')));
        i += 1;
      } else if (/^#{1,3} /.test(line)) {
        const [, hashes, text] = /^(#{1,3}) (.+)$/.exec(line);
        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        // The page's <h1> already carries the document's title.
        if (hashes.length > 1 || titled) root.append(inline(el(`h${Math.max(hashes.length, 2)}`, { id }), text));
        titled = true;
        i += 1;
      } else if (line.startsWith('|')) {
        const headers = cells(line);
        if (!lines[i + 1] || !cells(lines[i + 1]).every((cell) => /^:?-{3,}:?$/.test(cell))) throw new Error('Invalid table in API reference');
        const header = el('tr', {}, ...headers.map((text) => inline(el('th', { scope: 'col' }), text)));
        const body = el('tbody');
        i += 2;
        while (i < lines.length && lines[i].startsWith('|')) {
          const row = cells(lines[i++]);
          if (row.length !== headers.length) throw new Error('Invalid table row in API reference');
          body.append(el('tr', {}, ...row.map((text) => inline(el('td'), text))));
        }
        root.append(el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, header), body)));
      } else if (/^(- |\d+\. )/.test(line)) {
        const ordered = /^\d+\. /.test(line);
        const list = el(ordered ? 'ol' : 'ul');
        const marker = ordered ? /^\d+\. / : /^- /;
        while (i < lines.length && marker.test(lines[i])) list.append(inline(el('li'), lines[i++].replace(marker, '')));
        root.append(list);
      } else {
        const content = [line];
        i += 1;
        while (i < lines.length && lines[i].trim() && !block(lines[i])) content.push(lines[i++]);
        root.append(inline(el('p'), content.join(' ')));
      }
    }
    return root;
  }

  async function load(root) {
    try {
      const response = await fetch('/docs/api.md', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      root.replaceChildren(render(await response.text()));
      if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
    } catch (error) {
      root.replaceChildren(el('p', { class: 'dl-error', role: 'alert' },
        `Could not load the API reference: ${error.message}. `, el('a', { href: '/docs/api.md' }, 'Read the Markdown directly')));
    }
  }

  // 中文 / English: the same shared switch and saved choice as the app pages. The reference itself is English.
  function setupLanguage() {
    const KEY = 'plan-language';
    const toggle = document.querySelector('.dl-language-toggle');
    const languages = document.getElementById('dl-languages');
    if (!toggle || !languages) return;
    let language;
    try { language = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
    if (!['zh', 'en'].includes(language)) language = /^zh(?:-|$)/i.test(navigator.language || '') ? 'zh' : 'en';
    const setOpen = (open) => {
      languages.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    };
    const apply = () => {
      const zh = language === 'zh';
      document.documentElement.lang = zh ? 'zh-CN' : 'en';
      for (const node of document.querySelectorAll('[data-zh]')) node.textContent = zh ? node.dataset.zh : node.dataset.en;
      for (const node of document.querySelectorAll('[data-label-zh]')) node.setAttribute('aria-label', zh ? node.dataset.labelZh : node.dataset.labelEn);
      for (const node of document.querySelectorAll('[data-lang]')) node.hidden = node.dataset.lang !== language;
      document.querySelector('.dl-brand').lastChild.nodeValue = zh ? 'DL 旅行计划' : 'DL Travel Plan'; // keep the logo image
      document.title = `API · ${zh ? 'DL 旅行计划' : 'DL Travel Plan'}`;
      for (const button of languages.querySelectorAll('[data-language]')) button.setAttribute('aria-pressed', String(button.dataset.language === language));
    };
    languages.addEventListener('click', (event) => {
      const button = event.target.closest('[data-language]');
      if (!button) return;
      setOpen(false);
      language = button.dataset.language;
      try { localStorage.setItem(KEY, language); } catch { /* storage unavailable */ }
      apply();
    });
    toggle.addEventListener('click', () => setOpen(!languages.classList.contains('is-open')));
    document.addEventListener('click', (event) => {
      if (languages.classList.contains('is-open') && !languages.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && languages.classList.contains('is-open')) {
        setOpen(false);
        toggle.focus();
      }
    });
    apply();
  }

  if (typeof module === 'object' && module.exports) module.exports = { render };
  else {
    setupLanguage();
    const root = document.getElementById('api-doc');
    if (root) load(root);
  }
})();
