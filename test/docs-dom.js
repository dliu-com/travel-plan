const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Renders a /docs tab from web/info.js with a tiny DOM, so tests can check what people see.
class Node {
  constructor(tag) {
    this.tagName = tag;
    this.attributes = {};
    this.children = [];
    this.styles = {};
    this.style = { setProperty: (key, value) => { this.styles[key] = value; } };
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

function renderDocs(page, language = 'en') {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const root = new Node('root');
  const window = {};
  const document = { createElement: (tag) => new Node(tag), createElementNS: (ns, tag) => new Node(tag) };
  const context = vm.createContext({ window, document });
  vm.runInContext(read('web/diagram.js'), context);
  vm.runInContext(read('web/info.js'), context);
  root.append(...window.PlanInfo[page]((zh, en) => (language === 'zh' ? zh : en)));
  return { root, info: window.PlanInfo };
}

// Exact technical details that belong only in the Markdown versions (/docs/*.md), never on the people's tabs.
const EXACT = [
  // A status code; a number with a unit (e.g. 200 files) is a limit, not a status code.
  /(?<![\d.])(200|201|204|301|302|400|401|403|404|413|415|500|503)(?![\d.]|\s*(files|个|KB|MB|GB))/,
  /application\/|text\/(html|markdown)|content-type|cache-control|authorization|bearer|user-agent/i,
  /\b(GetItem|HeadObject|max-age)\b/,
  /\{\s*"|":|https?:\/\//,
];

module.exports = { Node, renderDocs, EXACT };
