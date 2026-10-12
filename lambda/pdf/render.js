'use strict';

// Lays out a travel plan as an A4 PDF: a header and a footer on every page, the plan's details, then the days.
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const fontkit = require('fontkit');

const COLORS = {
  text: '#1f2328',
  body: '#374151',
  muted: '#6b7280',
  line: '#e7e2d9',
  accent: '#b4532a',
  confirmed: '#2f7d4f',
  planned: '#2f6690',
  proposed: '#a86b00',
  option: '#7a4fa3',
};
const MARGINS = { top: 74, bottom: 66, left: 56, right: 56 };
const MAX_EMPTY_DAYS = 120;

const TEXT = {
  en: {
    locale: 'en-GB',
    brand: 'DL Travel Plan',
    when: 'When',
    where: 'Where',
    who: "Who's going",
    files: (n) => `Files (${n})`,
    anytime: 'Anytime',
    anytimeSub: 'Not tied to a day yet',
    nothing: 'Nothing planned yet.',
    noEvents: 'No events yet.',
    day: (n) => `Day ${n}`,
    days: (n) => `${n} days`,
    page: (i, n) => `Page ${i} of ${n}`,
    exported: (at) => `Exported ${at}`,
    updated: (at, by) => `Last updated ${at}${by ? ` by ${by}` : ''}`,
    guest: 'someone with the link',
    names: ', ',
    status: { confirmed: '✓ Confirmed', planned: 'Planned', proposed: 'Proposed', option: 'Option' },
  },
  zh: {
    locale: 'zh-CN',
    brand: 'DL 旅行计划',
    when: '日期',
    where: '目的地',
    who: '同行',
    files: (n) => `文件（${n}）`,
    anytime: '待定',
    anytimeSub: '尚未确定日期',
    nothing: '暂无安排。',
    noEvents: '还没有安排。',
    day: (n) => `第 ${n} 天`,
    days: (n) => `${n} 天`,
    page: (i, n) => `第 ${i} 页，共 ${n} 页`,
    exported: (at) => `导出于 ${at}`,
    updated: (at, by) => `最后更新：${at}${by ? `（${by}）` : ''}`,
    guest: '分享链接访客',
    names: '、',
    status: { confirmed: '✓ 已确认', planned: '计划', proposed: '提议', option: '待选' },
  },
};

// Noto Sans SC covers Latin, Chinese and Japanese kana. Loaded once per Lambda container.
let fonts;
function loadFonts() {
  if (!fonts) {
    const regular = fs.readFileSync(path.join(__dirname, 'fonts', 'NotoSansSC-Regular.ttf'));
    const bold = fs.readFileSync(path.join(__dirname, 'fonts', 'NotoSansSC-Bold.ttf'));
    fonts = { regular, bold, coverage: fontkit.create(regular) };
  }
  return fonts;
}

// Drops characters the font can't draw (emoji, for example) so they don't print as empty boxes.
function clean(value) {
  const { coverage } = loadFonts();
  let out = '';
  for (const ch of String(value || '')) {
    if (ch === '\n') out += ch;
    else if (ch === '\t') out += ' ';
    else if (coverage.hasGlyphForCodePoint(ch.codePointAt(0))) out += ch;
  }
  // The CJK font draws ’ full-width; inside English words (don't, it's) a straight apostrophe reads better.
  return out.replace(/(?<=[A-Za-z])’(?=[A-Za-z])/g, "'").replace(/ {2,}/g, ' ').replace(/^ +| +$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

function safeTimeZone(zone) {
  if (typeof zone === 'string' && zone.length <= 64) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone });
      return zone;
    } catch { /* fall through */ }
  }
  return 'UTC';
}

// Calendar days (YYYY-MM-DD) are always handled in UTC so they never shift, as on the website.
const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const dayDiff = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
const addDays = (iso, n) => new Date(toDate(iso).getTime() + n * 86400000).toISOString().slice(0, 10);

function dates(lang) {
  const L = TEXT[lang];
  const fmt = (iso, options) => toDate(iso).toLocaleDateString(L.locale, { timeZone: 'UTC', ...options });
  function range(trip) {
    const { startDate: s, endDate: e } = trip;
    if (!s && !e) return '';
    if (!s || !e) return fmt(s || e, { day: 'numeric', month: 'short', year: 'numeric' });
    if (s === e) return fmt(s, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const sameYear = s.slice(0, 4) === e.slice(0, 4);
    const sameMonth = sameYear && s.slice(0, 7) === e.slice(0, 7);
    const days = L.days(dayDiff(s, e) + 1);
    if (lang === 'zh') {
      const start = fmt(s, sameYear ? { month: 'long', day: 'numeric' } : { year: 'numeric', month: 'long', day: 'numeric' });
      return `${start} – ${fmt(e, { year: 'numeric', month: 'long', day: 'numeric' })} · ${days}`;
    }
    const startOptions = sameMonth ? { day: 'numeric' } : sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
    return `${fmt(s, startOptions)} – ${fmt(e, { day: 'numeric', month: 'short', year: 'numeric' })} · ${days}`;
  }
  function heading(trip, date) {
    if (!date) return { title: L.anytime, sub: L.anytimeSub };
    const sub = fmt(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (trip.startDate && date >= trip.startDate && (!trip.endDate || date <= trip.endDate)) {
      return { title: L.day(dayDiff(trip.startDate, date) + 1), sub };
    }
    return { title: fmt(date, { weekday: 'short' }), sub };
  }
  return { range, heading };
}

// Every day of the trip (empty ones too), then any other dated days, then "Anytime".
function groupByDay(trip) {
  const groups = new Map();
  const { startDate: s, endDate: e } = trip;
  if (s && e && dayDiff(s, e) < MAX_EMPTY_DAYS) {
    for (let d = s; d <= e; d = addDays(d, 1)) groups.set(d, []);
  }
  for (const event of trip.events) {
    if (!groups.has(event.date)) groups.set(event.date, []);
    groups.get(event.date).push(event);
  }
  return [...groups.entries()].sort(([a], [b]) => (a === b ? 0 : a === '' ? 1 : b === '' ? -1 : a < b ? -1 : 1));
}

// Back-to-back options on a day are alternatives to pick from: A, B, C…
function optionLetters(events) {
  const letters = new Map();
  let run = [];
  const flush = () => {
    if (run.length > 1) run.forEach((event, i) => letters.set(event.id, String.fromCharCode(65 + i)));
    run = [];
  };
  for (const event of events) {
    if (event.status === 'option') run.push(event);
    else flush();
  }
  flush();
  return letters;
}

function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function linkLabel(url) {
  try {
    const u = new URL(url);
    const label = u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname : '');
    return label.length > 80 ? `${label.slice(0, 77)}…` : label;
  } catch {
    return url;
  }
}

function pdfFileName(trip, lang = 'en') {
  // Title and dates, without the "· 5 days" suffix.
  const name = `${trip.title} ${dates(lang).range(trip).split(' · ')[0]}`
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${name || 'travel-plan'}.pdf`;
}

function renderPdf(trip, { lang = 'en', timeZone, now = new Date(), siteUrl = 'https://plan.dliu.com' } = {}) {
  const L = TEXT[lang] || TEXT.en;
  const zone = safeTimeZone(timeZone);
  const { range, heading } = dates(lang);
  const stamp = (date) => new Date(date).toLocaleString(L.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone });
  const { regular, bold } = loadFonts();

  const doc = new PDFDocument({
    size: 'A4',
    margins: MARGINS,
    bufferPages: true,
    lang: L.locale,
    displayTitle: true,
    info: { Title: clean(trip.title), Author: L.brand, Creator: siteUrl.replace(/^https?:\/\//, '') },
  });
  doc.registerFont('regular', regular);
  doc.registerFont('bold', bold);

  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = MARGINS.left;
  const width = doc.page.width - MARGINS.left - MARGINS.right;
  const right = left + width;
  const bottom = () => doc.page.height - MARGINS.bottom;
  const use = (font, size, color) => doc.font(font).fontSize(size).fillColor(color);
  const ensureSpace = (height) => {
    if (doc.y + height > bottom() && height < bottom() - MARGINS.top) doc.addPage();
  };
  const rule = (y, color, lineWidth) => doc.save().moveTo(left, y).lineTo(right, y).lineWidth(lineWidth).strokeColor(color).stroke().restore();

  // ---------- title and details ----------
  use('bold', 24, COLORS.text).text(clean(trip.title), left, MARGINS.top, { width, lineGap: 2 });
  doc.moveDown(0.6);

  const labelWidth = 84;
  const facts = [
    [L.when, range(trip)],
    [L.where, clean(trip.destination)],
    [L.who, (trip.travellers || []).map(clean).filter(Boolean).join(L.names)],
  ].filter(([, value]) => value);
  for (const [label, value] of facts) {
    const y = doc.y;
    use('bold', 9.5, COLORS.muted).text(label, left, y + 2.5, { width: labelWidth - 8 });
    const labelEnd = doc.y;
    use('regular', 12.5, COLORS.text).text(value, left + labelWidth, y, { width: width - labelWidth, lineGap: 1 });
    doc.y = Math.max(doc.y, labelEnd) + 5;
  }

  const intro = clean(trip.intro);
  if (intro) {
    doc.moveDown(0.5);
    use('regular', 10.5, COLORS.body).text(intro, left, doc.y, { width, lineGap: 3 });
  }

  if (trip.updatedAt) {
    doc.moveDown(0.5);
    const by = trip.updatedBy === 'share-link' ? L.guest : clean(trip.updatedBy);
    use('regular', 8.5, COLORS.muted).text(L.updated(stamp(trip.updatedAt), by), left, doc.y, { width });
  }

  if (trip.files && trip.files.length) {
    doc.moveDown(0.9);
    ensureSpace(40);
    use('bold', 9.5, COLORS.muted).text(L.files(trip.files.length), left, doc.y, { width });
    doc.moveDown(0.2);
    for (const file of trip.files) {
      use('regular', 9.5, COLORS.body).text(`•  ${clean(file.name)} · ${fileSize(file.size)}`, left + 4, doc.y, { width: width - 4, lineGap: 1 });
    }
  }

  // ---------- days ----------
  doc.moveDown(1.2);
  const days = groupByDay(trip);
  if (!days.length) use('regular', 10.5, COLORS.muted).text(L.noEvents, left, doc.y, { width });

  const timeWidth = 44;
  const contentX = left + timeWidth + 14;
  const contentWidth = right - contentX;

  for (const [date, events] of days) {
    const { title, sub } = heading(trip, date);
    ensureSpace(events.length ? 80 : 50);
    const y = doc.y;
    use('bold', 15, COLORS.text);
    const titleWidth = doc.widthOfString(title);
    doc.text(title, left, y, { lineBreak: false });
    use('regular', 10, COLORS.muted).text(sub, left + titleWidth + 10, y + 4.5, { width: width - titleWidth - 10, lineBreak: false });
    rule(y + 24, COLORS.text, 1.2);
    doc.x = left;
    doc.y = y + 32;

    if (!events.length) {
      use('regular', 9.5, COLORS.muted).text(L.nothing, contentX, doc.y, { width: contentWidth });
      doc.y += 14;
      continue;
    }

    const letters = optionLetters(events);
    for (const event of events) {
      const name = [letters.has(event.id) ? `${letters.get(event.id)}.` : '', clean(event.title)].filter(Boolean).join(' ');
      const place = clean(event.place);
      const notes = clean(event.notes);
      const statusText = event.status ? L.status[event.status] : '';
      const meta = [statusText, place].filter(Boolean).join(' · ');

      // Keep an event on one page when it fits.
      let height = use('bold', 11.5, COLORS.text).heightOfString(name, { width: contentWidth });
      if (meta) height += use('regular', 9, COLORS.muted).heightOfString(meta, { width: contentWidth }) + 2;
      if (notes) height += use('regular', 10, COLORS.body).heightOfString(notes, { width: contentWidth, lineGap: 2 }) + 3;
      if (event.link) height += 14;
      ensureSpace(Math.max(height, event.endTime ? 26 : 0) + 4);

      const page = doc.page;
      const top = doc.y;
      use('bold', 10, COLORS.text).text(event.time || '', left, top + 1.5, { width: timeWidth, lineBreak: false });
      if (event.endTime) use('regular', 9, COLORS.muted).text(`– ${event.endTime}`, left, top + 14, { width: timeWidth, lineBreak: false });
      use('bold', 11.5, COLORS.text).text(name, contentX, top, { width: contentWidth });
      if (meta) {
        doc.y += 1;
        if (statusText) {
          use('bold', 9, COLORS[event.status]).text(statusText, contentX, doc.y, { width: contentWidth, continued: Boolean(place) });
          if (place) use('regular', 9, COLORS.muted).text(` · ${place}`);
        } else {
          use('regular', 9, COLORS.muted).text(place, contentX, doc.y, { width: contentWidth });
        }
      }
      if (notes) {
        doc.y += 3;
        use('regular', 10, COLORS.body).text(notes, contentX, doc.y, { width: contentWidth, lineGap: 2 });
      }
      if (event.link) {
        doc.y += 2;
        const href = /^https?:\/\//i.test(event.link) ? event.link : null;
        use('regular', 9, COLORS.accent).text(clean(linkLabel(event.link)) || clean(event.link), contentX, doc.y, { width: contentWidth, link: href, underline: Boolean(href) });
      }
      if (event.endTime && doc.page === page) doc.y = Math.max(doc.y, top + 26);
      const end = doc.y;

      // The status bar down the left of the event, dashed for ideas that aren't decided yet.
      if (event.status && doc.page === page) {
        doc.save().lineWidth(2).strokeColor(COLORS[event.status]);
        if (event.status === 'proposed' || event.status === 'option') doc.dash(3, { space: 2 });
        doc.moveTo(contentX - 8, top + 2).lineTo(contentX - 8, end - 1).stroke().undash().restore();
      }
      doc.x = left;
      doc.y = end + 10;
    }
    doc.y += 8;
  }

  // ---------- header and footer on every page ----------
  const host = siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const shortTitle = (() => {
    const title = clean(trip.title).replace(/\n/g, ' ');
    return title.length > 60 ? `${title.slice(0, 57)}…` : title;
  })();
  const exported = L.exported(stamp(now));
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i += 1) {
    doc.switchToPage(i);
    // Writing in the margins must not start new pages.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    use('bold', 8.5, COLORS.accent).text(L.brand, left, 34, { width: width / 2, lineBreak: false });
    use('regular', 8.5, COLORS.muted).text(shortTitle, left + width / 2, 34, { width: width / 2, align: 'right', lineBreak: false });
    rule(50, COLORS.line, 0.6);
    const footerY = doc.page.height - 44;
    rule(footerY - 9, COLORS.line, 0.6);
    use('regular', 8, COLORS.muted).text(`${host}/plan/${trip.id} · ${exported}`, left, footerY, { width: width * 0.72, lineBreak: false });
    use('regular', 8, COLORS.muted).text(L.page(i - start + 1, count), left + width * 0.72, footerY, { width: width * 0.28, align: 'right', lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
  return done;
}

module.exports = { clean, pdfFileName, renderPdf, safeTimeZone };
