'use strict';

// Small DOM/SVG diagram kit for the About and Security pages, ported from DL Weiqi.
// Callers pass already translated text; everything is set with textContent.
window.PlanDiagram = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    browser: ['#4b6575', [['rect', { x: 3, y: 4.5, width: 18, height: 15, rx: 2 }], ['path', { d: 'M3 9h18' }], ['circle', { cx: 6, cy: 6.8, r: 0.6, fill: '#fff' }], ['circle', { cx: 8.3, cy: 6.8, r: 0.6, fill: '#fff' }]]],
    cloudfront: ['#8c4fff', [['circle', { cx: 12, cy: 12, r: 8.5 }], ['ellipse', { cx: 12, cy: 12, rx: 3.6, ry: 8.5 }], ['path', { d: 'M3.5 12h17M5 7.5h14M5 16.5h14' }]]],
    lambda: ['#ed7100', [['path', { d: 'M6.5 4h3.5l8 16' }], ['path', { d: 'M12.3 10.6 6.5 20' }]]],
    s3: ['#7aa116', [['ellipse', { cx: 12, cy: 6, rx: 8, ry: 2.6 }], ['path', { d: 'M4 6l1.9 12.6c.3 1.6 2.9 2.6 6.1 2.6s5.8-1 6.1-2.6L20 6' }]]],
    dynamodb: ['#3b48cc', [['ellipse', { cx: 12, cy: 5.8, rx: 7, ry: 2.5 }], ['path', { d: 'M5 5.8v12.4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V5.8M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5' }]]],
    shield: ['#dd344c', [['path', { d: 'M12 2.8l7.5 3v5.4c0 4.8-3.2 8.7-7.5 10.1-4.3-1.4-7.5-5.3-7.5-10.1V5.8z' }], ['path', { d: 'M8.8 12.2l2.2 2.2 4.3-4.6' }]]],
    lock: ['#dd344c', [['rect', { x: 4.5, y: 10.5, width: 15, height: 10.5, rx: 2 }], ['path', { d: 'M8 10.5V7.8a4 4 0 0 1 8 0v2.7M12 14.5v3' }]]],
    key: ['#b07d12', [['circle', { cx: 8, cy: 12, r: 4 }], ['path', { d: 'M12 12h9M18 12v3.5M21 12v2.5' }]]],
    user: ['#4b6575', [['circle', { cx: 12, cy: 8, r: 3.8 }], ['path', { d: 'M4.5 20.5c.9-4.2 4-6.6 7.5-6.6s6.6 2.4 7.5 6.6' }]]],
    users: ['#805719', [['circle', { cx: 9, cy: 8.5, r: 3.2 }], ['path', { d: 'M2.8 19.5c.6-3.5 3.2-5.5 6.2-5.5s5.6 2 6.2 5.5' }], ['circle', { cx: 16.6, cy: 9, r: 2.6 }], ['path', { d: 'M16.4 14.2c2.5.1 4.3 1.9 4.9 4.8' }]]],
    entra: ['#0078d4', [['path', { d: 'M12 3l8 9-8 9-8-9z' }], ['path', { d: 'M12 3v18M4 12h16' }]]],
    bot: ['#7b2d2d', [['rect', { x: 4.5, y: 8, width: 15, height: 11.5, rx: 3 }], ['path', { d: 'M12 8V4.5M9.5 16h5' }], ['circle', { cx: 9.2, cy: 12.3, r: 1.2, fill: '#fff' }], ['circle', { cx: 14.8, cy: 12.3, r: 1.2, fill: '#fff' }]]],
    file: ['#b3462e', [['path', { d: 'M6 2.5h8.5l4 4V21.5H6z' }], ['path', { d: 'M14.5 2.5v4h4M9 11h6.5M9 14.5h6.5M9 18h4' }]]],
    upload: ['#7aa116', [['path', { d: 'M12 16V4M7 9l5-5 5 5' }], ['path', { d: 'M4 15v4.5h16V15' }]]],
    link: ['#147cab', [['path', { d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1' }], ['path', { d: 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' }]]],
    check: ['#2e8540', [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M8 12.3l2.7 2.7L16 9.6' }]]],
    budget: ['#2e8540', [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M14.8 8.6c-.5-1.1-1.6-1.7-2.9-1.7-1.6 0-2.8.9-2.8 2.1 0 2.9 5.9 1.6 5.9 4.7 0 1.3-1.3 2.3-3 2.3-1.4 0-2.6-.6-3.1-1.8M12 5v1.9M12 16v2.9' }]]],
    power: ['#2e8540', [['path', { d: 'M12 3v8.5' }], ['path', { d: 'M7.2 6.6a7.5 7.5 0 1 0 9.6 0' }]]],
    gauge: ['#dd344c', [['path', { d: 'M3.8 17a8.5 8.5 0 1 1 16.4 0' }], ['path', { d: 'M12 15.5l4.2-5' }], ['circle', { cx: 12, cy: 15.5, r: 1.3, fill: '#fff' }]]],
    eye: ['#147cab', [['path', { d: 'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z' }], ['circle', { cx: 12, cy: 12, r: 3 }]]],
    chart: ['#147cab', [['path', { d: 'M4 4v16h16' }], ['path', { d: 'M7 15l4-5 3 3 5.5-7' }]]],
    clock: ['#147cab', [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M12 7.5V12l3.2 2' }]]],
    globe: ['#4b6575', [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M3.5 12h17M12 3.5c2.5 2.3 3.6 5.1 3.6 8.5s-1.1 6.2-3.6 8.5c-2.5-2.3-3.6-5.1-3.6-8.5s1.1-6.2 3.6-8.5z' }]]],
    stack: ['#e7157b', [['path', { d: 'M12 3.5l8.5 4.5-8.5 4.5L3.5 8z' }], ['path', { d: 'M3.5 12.3l8.5 4.5 8.5-4.5M3.5 16.3l8.5 4.5 8.5-4.5' }]]],
    map: ['#01a88d', [['path', { d: 'M3.5 6l5.5-2.5 6 2.5 5.5-2.5v14.5L15 20.5 9 18l-5.5 2.5z' }], ['path', { d: 'M9 3.5V18M15 6v14.5' }]]],
  };

  const svgNode = (tag, attrs) => {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  function icon(name, size = '') {
    const [colour, parts] = ICONS[name] || ICONS.browser;
    const box = el('span', `dg-icon${size ? ` dg-icon-${size}` : ''}`);
    box.style.setProperty('--dg', colour);
    box.setAttribute('aria-hidden', 'true');
    const svg = svgNode('svg', { viewBox: '0 0 24 24', focusable: 'false' });
    for (const [tag, attrs] of parts) svg.append(svgNode(tag, attrs));
    box.append(svg);
    return box;
  }

  function arrow() {
    const span = el('span', 'dg-arrow');
    const svg = svgNode('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    svg.append(svgNode('path', { d: 'M4 12h15M13 6l6 6-6 6' }));
    span.append(svg);
    return span;
  }

  function card(step, className, number) {
    const node = el(step.href ? 'a' : 'div', className);
    if (step.href) node.href = step.href;
    if (number != null) node.append(el('span', 'dg-num', String(number)));
    if (step.icon) node.append(icon(step.icon));
    const text = el('span', 'dg-text');
    text.append(el('strong', '', step.title));
    if (step.text) text.append(el('small', '', step.text));
    node.append(text);
    return node;
  }

  function frame(title, className) {
    const figure = el('figure', `dg${className ? ` ${className}` : ''}`);
    if (title) figure.append(el('figcaption', '', title));
    return figure;
  }
  const withNote = (figure, text) => {
    if (text) figure.append(el('p', 'dg-note', text));
    return figure;
  };

  function flow({ title, steps, note, numbered = false }) {
    const figure = frame(title);
    const list = el('div', 'dg-flow');
    list.setAttribute('role', 'list');
    steps.forEach((step, index) => {
      if (index) list.append(arrow());
      const item = card(step, `dg-step${step.tone ? ` dg-${step.tone}` : ''}`, numbered ? index + 1 : null);
      item.setAttribute('role', 'listitem');
      list.append(item);
    });
    figure.append(list);
    return withNote(figure, note);
  }

  function tiers({ title, rows, note }) {
    const figure = frame(title, 'dg-tiers');
    rows.forEach((row, index) => {
      if (index && row.link !== null) {
        const link = el('div', 'dg-link');
        link.append(arrow());
        if (row.link) link.append(el('span', '', row.link));
        figure.append(link);
      }
      const tier = el('div', `dg-tier${row.tone ? ` dg-${row.tone}` : ''}`);
      const label = el('div', 'dg-tier-label');
      if (row.badge) label.append(el('span', 'dg-badge', row.badge));
      label.append(el('strong', '', row.label));
      tier.append(label);
      const nodes = el('div', 'dg-tier-nodes');
      for (const node of row.nodes) nodes.append(card(node, 'dg-node'));
      tier.append(nodes);
      figure.append(tier);
    });
    return withNote(figure, note);
  }

  function stats(items) {
    const grid = el('div', 'dg-stats');
    for (const [value, label, name] of items) {
      const box = el('div', 'dg-stat');
      if (name) box.append(icon(name));
      const text = el('span', 'dg-text');
      text.append(el('strong', '', value), el('small', '', label));
      box.append(text);
      grid.append(box);
    }
    return grid;
  }

  function callout(name, text) {
    const box = el('p', 'dg-callout');
    box.append(icon(name), el('span', '', text));
    return box;
  }

  function more(summary, ...content) {
    const details = el('details', 'dg-more');
    details.append(el('summary', '', summary), ...content);
    return details;
  }

  // rows: arrays of cells; a cell is text or { text, tone } for a coloured pill.
  function table(head, rows, className = '') {
    const wrap = el('div', 'info-table-wrap');
    const tableEl = el('table', `info-table${className ? ` ${className}` : ''}`);
    const thead = el('thead');
    const headRow = el('tr');
    for (const cell of head) headRow.append(el('th', '', cell));
    thead.append(headRow);
    const tbody = el('tbody');
    for (const row of rows) {
      const tr = el('tr');
      row.forEach((cell, index) => {
        const td = el(index === 0 ? 'th' : 'td');
        if (index === 0) td.scope = 'row';
        if (cell && typeof cell === 'object') td.append(el('span', `pill pill-${cell.tone}`, cell.text));
        else td.textContent = cell;
        tr.append(td);
      });
      tbody.append(tr);
    }
    tableEl.append(thead, tbody);
    wrap.append(tableEl);
    return wrap;
  }

  return { icon, flow, tiers, stats, callout, more, table };
})();
