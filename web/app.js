'use strict';

(() => {
  const main = document.getElementById('main');
  const statusEl = document.getElementById('status');
  // token: the share-link token from ?token=, which lets someone who isn't signed in view and edit one trip.
  const state = { me: { signedIn: false }, trip: null, editing: null, token: null };
  const isGuest = () => !state.me.signedIn && Boolean(state.token);
  const tripPath = (id) => `/plan/${id}`;
  const MAX_FILE_BYTES = 50 * 1024 * 1024;

  // ---------- language: 中文 / English, same switch as DL Weiqi ----------
  const LANGUAGE_KEY = 'plan-language';
  let language = (() => {
    let saved;
    try { saved = localStorage.getItem(LANGUAGE_KEY); } catch { /* storage unavailable */ }
    return ['zh', 'en'].includes(saved) ? saved : /^zh(?:-|$)/i.test(navigator.language || '') ? 'zh' : 'en';
  })();
  const t = (zh, en) => (language === 'zh' ? zh : en);
  const locale = () => (language === 'zh' ? 'zh-CN' : 'en-GB');
  // The API answers in English; show the common messages in Chinese too.
  const SERVER_MESSAGES_ZH = {
    'Sign in to do that': '请先登录。',
    'Trip not found': '找不到这个行程。',
    'Event not found': '找不到这个安排。',
    'This link is no longer shared': '此链接已停止分享。',
    'This link no longer works': '此链接已失效。',
    'File not found': '找不到这个文件。',
    'File is empty': '文件是空的。',
    'Unknown event': '找不到这个安排。',
    'Upload not found. Try again.': '上传未完成，请重试。',
    'Files can be at most 50 MB': '单个文件不能超过 50 MB。',
    'A trip can have at most 200 files': '每个行程最多 200 个文件。',
    'Cross-site request refused': '请求来源无效。',
    'Invalid JSON': '请求格式无效。',
    'Not found': '页面不存在。',
    'Method not allowed': '不支持此请求方法。',
    'Title is required': '请填写标题。',
    'End date is before the start date': '结束日期早于开始日期。',
    'Link must be a full URL starting with https://': '链接须为以 https:// 开头的完整网址。',
    'Link must start with http:// or https://': '链接须以 http:// 或 https:// 开头。',
  };

  // ---------- helpers ----------
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = String(value);
      else if (key === 'value') node.value = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of [].concat(children)) if (child != null && child !== false && child !== '') node.append(child);
    return node;
  }

  function setStatus(text, isError) {
    statusEl.textContent = text || '';
    statusEl.className = isError ? 'error' : '';
  }

  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function api(method, path, body) {
    const init = { method, credentials: 'same-origin', headers: { accept: 'application/json' } };
    if (state.token) init.headers['x-plan-token'] = state.token;
    if (method !== 'GET') {
      const payload = body === undefined ? '' : JSON.stringify(body);
      if (payload) {
        init.body = payload;
        init.headers['content-type'] = 'application/json';
      }
      // CloudFront signs requests to the Lambda origin (OAC) and needs the body hash from the browser.
      init.headers['x-amz-content-sha256'] = await sha256Hex(payload);
    }
    const response = await fetch(path, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error || t(`请求失败（${response.status}）`, `Request failed (${response.status})`);
      const error = new Error((language === 'zh' && SERVER_MESSAGES_ZH[message]) || message);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  // Dates are calendar days (YYYY-MM-DD), always handled in UTC so they never shift.
  const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
  const fmt = (iso, options) => toDate(iso).toLocaleDateString(locale(), { timeZone: 'UTC', ...options });
  const dayDiff = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
  const addDays = (iso, n) => new Date(toDate(iso).getTime() + n * 86400000).toISOString().slice(0, 10);
  const todayIso = () => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);
  };

  function dateRange(trip) {
    const { startDate: s, endDate: e } = trip;
    if (!s && !e) return '';
    if (!s || !e) return fmt(s || e, { day: 'numeric', month: 'short', year: 'numeric' });
    if (s === e) return fmt(s, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const sameYear = s.slice(0, 4) === e.slice(0, 4);
    const sameMonth = sameYear && s.slice(0, 7) === e.slice(0, 7);
    const days = dayDiff(s, e) + 1;
    if (language === 'zh') {
      const start = fmt(s, sameYear ? { month: 'long', day: 'numeric' } : { year: 'numeric', month: 'long', day: 'numeric' });
      return `${start} – ${fmt(e, { year: 'numeric', month: 'long', day: 'numeric' })} · ${days} 天`;
    }
    const startOptions = sameMonth ? { day: 'numeric' } : sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
    return `${fmt(s, startOptions)} – ${fmt(e, { day: 'numeric', month: 'short', year: 'numeric' })} · ${days} days`;
  }

  function when(trip) {
    const today = todayIso();
    const start = trip.startDate;
    const end = trip.endDate || trip.startDate;
    if (!start) return t('筹划中', 'Planning');
    if (today < start) {
      const n = dayDiff(today, start);
      return n === 1 ? t('明天', 'Tomorrow') : t(`${n} 天后`, `In ${n} days`);
    }
    return today <= end ? t('进行中', 'Happening now') : '';
  }

  function kicker(trip) {
    const status = when(trip);
    const range = dateRange(trip);
    return el('p', { class: 'kicker' }, [
      status && el('span', { class: 'when', text: status }),
      trip.destination && el('span', { text: trip.destination }),
      range && el('span', { text: range }),
      trip.shared && el('span', { class: 'badge', text: t('已分享', 'Shared') }),
    ]);
  }

  const mapsUrl = (place) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
  const safeLink = (url) => (/^https?:\/\//i.test(url || '') ? url : '');
  function linkLabel(url) {
    try {
      const u = new URL(url);
      const label = u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname : '');
      return label.length > 60 ? `${label.slice(0, 57)}…` : label;
    } catch {
      return url;
    }
  }
  function formatStamp(iso, by) {
    if (!iso) return '';
    const at = new Date(iso).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
    if (by === 'share-link') by = t('分享链接访客', 'someone with the link');
    return t(`最后更新：${at}${by ? `（${by}）` : ''}`, `Last updated ${at}${by ? ` by ${by}` : ''}`);
  }

  function renderAccount() {
    const account = document.getElementById('account');
    account.replaceChildren(state.me.signedIn
      ? el('span', {}, [`${state.me.name || state.me.user} · `, el('a', { href: '/auth/logout', text: t('退出登录', 'Sign out') })])
      : el('a', { href: `/auth/login?return=${encodeURIComponent(location.pathname)}`, text: t('登录', 'Sign in') }));
  }

  function show(...nodes) {
    main.replaceChildren(statusEl, ...nodes.filter(Boolean));
  }

  function microsoftLogo() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    for (const [k, v] of Object.entries({ width: 21, height: 21, viewBox: '0 0 21 21', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
    for (const [x, y, fill] of [[1, 1, '#f25022'], [11, 1, '#7fba00'], [1, 11, '#00a4ef'], [11, 11, '#ffb900']]) {
      const rect = document.createElementNS(ns, 'rect');
      for (const [k, v] of Object.entries({ x, y, width: 9, height: 9, fill })) rect.setAttribute(k, v);
      svg.append(rect);
    }
    return svg;
  }

  function signInCard(message) {
    return el('section', { class: 'signin' }, [
      el('h1', { text: t('我们的行程', 'Our trip plans') }),
      el('p', { text: message }),
      el('a', { class: 'ms-signin', href: `/auth/login?return=${encodeURIComponent(location.pathname)}` }, [
        microsoftLogo(),
        el('span', { text: t('使用 Microsoft 登录', 'Sign in with Microsoft') }),
      ]),
    ]);
  }

  // ---------- statuses & view preferences ----------
  const STATUSES = ['confirmed', 'planned', 'proposed', 'option'];
  const STATUS_TEXT = {
    confirmed: { zh: ['已确认', '已预订或已固定'], en: ['Confirmed', 'Booked or fixed'] },
    planned: { zh: ['计划', '已决定，尚未预订'], en: ['Planned', 'Decided, not booked yet'] },
    proposed: { zh: ['提议', '建议，尚未商定'], en: ['Proposed', 'Suggested, not agreed yet'] },
    option: { zh: ['待选', '多个备选之一'], en: ['Option', 'One of several alternatives'] },
  };
  const statusName = (s) => STATUS_TEXT[s][language][0];
  const statusHint = (s) => STATUS_TEXT[s][language][1];
  const statusLabel = (s) => (s === 'confirmed' ? `✓ ${statusName(s)}` : statusName(s));

  const prefs = {
    get(key, fallback) {
      try {
        const value = JSON.parse(localStorage.getItem(`plan.${key}`));
        return value == null ? fallback : value;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(`plan.${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ }
    },
  };
  // compact: one line per event; filter: show one status only; openEvents: expanded in compact view.
  const view = { compact: prefs.get('compact', true), filter: '', openEvents: new Set() };

  // ---------- forms ----------
  const field = (label, input) => el('label', {}, [label, input]);

  function form(title, inputs, layout, { submitLabel, onSave, onCancel, extra }) {
    const error = el('p', { class: 'form-error', hidden: true });
    const save = el('button', { class: 'primary', type: 'submit', text: submitLabel });
    const node = el('form', { class: 'panel' }, [
      el('h2', { text: title }),
      ...layout,
      error,
      el('div', { class: 'form-actions' }, [
        save,
        el('button', { type: 'button', text: t('取消', 'Cancel'), onclick: onCancel }),
        el('span', { class: 'spacer' }),
        extra,
      ]),
    ]);
    node.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      error.hidden = true;
      try {
        await onSave(Object.fromEntries(Object.entries(inputs).map(([k, input]) => [k, input.value])));
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        save.disabled = false;
      }
    });
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') onCancel();
    });
    setTimeout(() => {
      inputs.title.focus();
      node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 0);
    return node;
  }

  function tripForm(trip, options) {
    const inputs = {
      title: el('input', { required: true, maxlength: 120, value: trip.title || '', placeholder: t('京都之秋', 'Autumn in Kyoto') }),
      destination: el('input', { maxlength: 120, value: trip.destination || '', placeholder: t('日本京都', 'Kyoto, Japan') }),
      startDate: el('input', { type: 'date', value: trip.startDate || '' }),
      endDate: el('input', { type: 'date', value: trip.endDate || '' }),
      intro: el('textarea', { maxlength: 10000, rows: 6, placeholder: t('介绍这次旅行：谁同行、大致想法、住宿、注意事项…', 'What the trip is about — who is coming, the idea, where you stay, things to know…') }),
    };
    inputs.intro.value = trip.intro || '';
    inputs.startDate.addEventListener('change', () => {
      const s = inputs.startDate.value;
      if (s && (!inputs.endDate.value || inputs.endDate.value < s)) inputs.endDate.value = s;
    });
    return form(options.title, inputs, [
      field(t('标题', 'Title'), inputs.title),
      el('div', { class: 'fields' }, [
        field(t('目的地', 'Destination'), inputs.destination),
        field(t('开始', 'From'), inputs.startDate),
        field(t('结束', 'To'), inputs.endDate),
      ]),
      field(t('行程描述', 'Description'), inputs.intro),
    ], { submitLabel: t('保存', 'Save'), ...options });
  }

  function statusSelect(current, props = {}) {
    const select = el('select', props, [
      el('option', { value: '', text: t('无状态', 'No status') }),
      ...STATUSES.map((s) => el('option', { value: s, text: `${statusLabel(s)} — ${statusHint(s)}` })),
    ]);
    select.value = current || '';
    return select;
  }

  function eventForm(event, options) {
    const inputs = {
      date: el('input', { type: 'date', value: event.date || '' }),
      time: el('input', { type: 'time', value: event.time || '' }),
      title: el('input', { required: true, maxlength: 200, value: event.title || '', placeholder: t('日出时去伏见稻荷', 'Fushimi Inari at sunrise') }),
      place: el('input', { maxlength: 200, value: event.place || '', placeholder: t('京都伏见稻荷大社', 'Fushimi Inari Taisha, Kyoto') }),
      link: el('input', { type: 'url', maxlength: 2000, value: event.link || '', placeholder: 'https://…' }),
      notes: el('textarea', { maxlength: 4000, rows: 3, placeholder: t('细节、集合地点、要带的东西…', 'Details, meeting point, what to bring…') }),
      status: statusSelect(event.status),
    };
    inputs.notes.value = event.notes || '';
    return form(options.title, inputs, [
      el('div', { class: 'fields' }, [field(t('日期', 'Date'), inputs.date), field(t('时间', 'Time'), inputs.time), field(t('状态', 'Status'), inputs.status)]),
      field(t('事项', 'What'), inputs.title),
      el('div', { class: 'fields' }, [field(t('地点', 'Where'), inputs.place), field(t('链接', 'Link'), inputs.link)]),
      field(t('备注', 'Notes'), inputs.notes),
    ], { submitLabel: t('保存安排', 'Save event'), ...options });
  }

  // ---------- attachments ----------
  // Shown as thumbnails; other files get an icon. Files open through the API, which redirects to private storage.
  const PREVIEW_TYPES = /^image\/(png|jpe?g|gif|webp|avif)$/;
  const formatSize = (bytes) => (bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`);
  const fileIcon = (type) => (type.startsWith('image/') ? '🖼️' : type === 'application/pdf' ? '📕' : type.startsWith('video/') ? '🎞️' : type.startsWith('audio/') ? '🎵' : '📄');

  function fileUrl(trip, file, download) {
    const query = new URLSearchParams();
    // Images and links can't send headers, so people using a share link pass the token in the address.
    if (isGuest()) query.set('token', state.token);
    if (download) query.set('download', '1');
    const q = query.toString();
    return `/api/trips/${trip.id}/files/${file.id}${q ? `?${q}` : ''}`;
  }

  function fileList(trip, files, editable) {
    if (!files.length) return null;
    return el('ul', { class: 'files' }, files.map((file) => el('li', { class: 'file' }, [
      el('a', { class: 'file-open', href: fileUrl(trip, file), target: '_blank', rel: 'noopener noreferrer', title: file.name }, [
        PREVIEW_TYPES.test(file.type)
          ? el('img', { class: 'thumb', src: fileUrl(trip, file), alt: '', loading: 'lazy' })
          : el('span', { class: 'file-icon', 'aria-hidden': 'true', text: fileIcon(file.type) }),
        el('span', { class: 'file-name', text: file.name }),
        el('span', { class: 'file-size', text: formatSize(file.size) }),
      ]),
      el('a', { class: 'file-action', href: fileUrl(trip, file, true), title: t('下载', 'Download'), 'aria-label': t(`下载 ${file.name}`, `Download ${file.name}`), text: '⤓' }),
      editable && el('button', {
        type: 'button',
        class: 'file-action danger',
        title: t('删除文件', 'Remove file'),
        'aria-label': t(`删除 ${file.name}`, `Remove ${file.name}`),
        text: '✕',
        onclick: () => deleteFile(file),
      }),
    ])));
  }

  function putFile(url, headers, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(t(`上传失败（${xhr.status}）`, `Upload failed (${xhr.status})`))));
      xhr.onerror = () => reject(new Error(t('上传失败，请检查网络。', 'Upload failed. Check your connection.')));
      xhr.send(file);
    });
  }

  // Each file: ask the API for an upload URL, send the bytes straight to storage, then tell the API to keep it.
  let uploading = false;
  async function uploadFiles(list) {
    const files = [...list];
    if (!files.length) return;
    if (uploading) {
      setStatus(t('请等当前上传完成。', 'Wait for the current upload to finish.'), true);
      return;
    }
    uploading = true;
    let done = 0;
    try {
      for (const file of files) {
        const label = files.length > 1 ? `${file.name} (${done + 1}/${files.length})` : file.name;
        if (!file.size) throw new Error(t(`“${file.name}”是空文件。`, `“${file.name}” is empty.`));
        if (file.size > MAX_FILE_BYTES) throw new Error(t(`“${file.name}”超过 50 MB。`, `“${file.name}” is larger than 50 MB.`));
        setStatus(t(`正在上传 ${label}…`, `Uploading ${label}…`));
        const tripId = state.trip.id;
        const upload = await api('POST', `/api/trips/${tripId}/files`, { name: file.name, size: file.size, type: file.type });
        await putFile(upload.uploadUrl, upload.uploadHeaders, file, (part) => {
          setStatus(t(`正在上传 ${label}… ${Math.round(part * 100)}%`, `Uploading ${label}… ${Math.round(part * 100)}%`));
        });
        const { trip } = await api('PUT', `/api/trips/${tripId}/files/${upload.fileId}`, { name: file.name });
        state.trip = trip;
        done += 1;
      }
      rerender();
      setStatus(done === 1 ? t('文件已上传。', 'File uploaded.') : t(`已上传 ${done} 个文件。`, `Uploaded ${done} files.`));
    } catch (error) {
      if (done) rerender();
      setStatus(error.message, true);
    } finally {
      uploading = false;
    }
  }

  async function deleteFile(file) {
    if (!confirm(t(`删除文件“${file.name}”？`, `Remove “${file.name}”?`))) return;
    try {
      const { trip } = await api('DELETE', `/api/trips/${state.trip.id}/files/${file.id}`);
      state.trip = trip;
      rerender();
      setStatus(t('文件已删除。', 'File removed.'));
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function attachButton(text) {
    const input = el('input', {
      type: 'file',
      multiple: true,
      hidden: true,
      onchange: (e) => { uploadFiles(e.target.files); e.target.value = ''; },
    });
    return el('span', { class: 'attach' }, [input, el('button', { type: 'button', class: 'link', text, onclick: () => input.click() })]);
  }

  // Drop files on the trip's file section to attach them.
  function dropTarget(node) {
    const hasFiles = (e) => [...(e.dataTransfer ? e.dataTransfer.types : [])].includes('Files');
    node.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      node.classList.add('dropping');
    });
    node.addEventListener('dragleave', (e) => { if (!node.contains(e.relatedTarget)) node.classList.remove('dropping'); });
    node.addEventListener('drop', (e) => {
      node.classList.remove('dropping');
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      e.stopPropagation();
      uploadFiles(e.dataTransfer.files);
    });
    return node;
  }
  // A file dropped anywhere else shouldn't make the browser leave the page.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  function tripFiles(trip, editable) {
    const files = trip.files || [];
    if (!files.length && !editable) return null;
    const section = el('section', { class: 'trip-files' }, [
      el('div', { class: 'section-head' }, [
        el('h2', { text: t('文件', 'Files') }),
        files.length > 0 && el('span', { class: 'count', text: String(files.length) }),
        el('span', { class: 'spacer' }),
        editable && attachButton(t('📎 添加文件', '📎 Attach files')),
      ]),
      fileList(trip, files, editable)
        || el('p', { class: 'hint', text: t('机票、酒店确认单、地图……拖放文件到这里，或点“添加文件”。', 'Tickets, bookings, maps… Drop files here or use “Attach files”.') }),
    ]);
    return editable ? dropTarget(section) : section;
  }

  // ---------- trip post ----------
  function groupByDay(trip, { includeEmptyDays }) {
    const groups = new Map();
    const { startDate: s, endDate: e } = trip;
    if (includeEmptyDays && s && e && dayDiff(s, e) < 120) {
      for (let d = s; d <= e; d = addDays(d, 1)) groups.set(d, []);
    }
    for (const event of trip.events) {
      if (!groups.has(event.date)) groups.set(event.date, []);
      groups.get(event.date).push(event);
    }
    return [...groups.entries()].sort(([a], [b]) => (a === b ? 0 : a === '' ? 1 : b === '' ? -1 : a < b ? -1 : 1));
  }

  function dayHeading(trip, date) {
    if (!date) return { title: t('待定', 'Anytime'), sub: t('尚未确定日期', 'Not tied to a day yet') };
    const sub = fmt(date, { weekday: 'long', day: 'numeric', month: 'long' });
    if (trip.startDate && date >= trip.startDate && (!trip.endDate || date <= trip.endDate)) {
      const n = dayDiff(trip.startDate, date) + 1;
      return { title: t(`第 ${n} 天`, `Day ${n}`), sub };
    }
    return { title: fmt(date, { weekday: 'short' }), sub: fmt(date, { day: 'numeric', month: 'long', year: 'numeric' }) };
  }

  const rerender = () => renderTrip();
  const closeForm = () => { state.editing = null; rerender(); };

  // Back-to-back options on a day are alternatives to pick from: label them A, B, C…
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

  function statusBadge(event, letter) {
    if (!event.status) return null;
    const label = event.status === 'option' && letter ? `${statusName('option')} ${letter}` : statusLabel(event.status);
    return el('span', { class: 'status', 'data-status': event.status, title: statusHint(event.status), text: label });
  }

  async function saveEvent(trip, event, changes) {
    const { id, ...fields } = event;
    const { trip: updated } = await api('PUT', `/api/trips/${trip.id}/events/${id}`, { ...fields, ...changes });
    state.trip = updated;
  }

  function eventItem(trip, event, editable, letter) {
    const link = safeLink(event.link);
    const hasMore = Boolean(event.notes || link || editable);
    const li = el('li', { class: 'event', 'data-status': event.status || 'none' }, [
      el('div', { class: 'time', text: event.time || '' }),
      el('div', { class: 'body' }, [
        el('div', { class: 'head' }, [
          statusBadge(event, letter),
          el('h3', { text: event.title }),
          event.place && el('p', { class: 'place' }, [
            el('a', { href: mapsUrl(event.place), target: '_blank', rel: 'noopener noreferrer', text: `📍 ${event.place}` }),
          ]),
        ]),
        event.notes && el('p', { class: 'notes', text: event.notes }),
        link && el('a', { class: 'ext', href: link, target: '_blank', rel: 'noopener noreferrer', text: `${linkLabel(link)} ↗` }),
        editable && el('div', { class: 'actions' }, [
          el('button', { class: 'link', type: 'button', text: t('编辑', 'Edit'), onclick: () => { state.editing = event.id; rerender(); } }),
          el('button', { class: 'link danger', type: 'button', text: t('删除', 'Delete'), onclick: () => deleteEvent(event) }),
          statusSelect(event.status, {
            class: 'quick-status',
            'aria-label': t('状态', 'Status'),
            onchange: async (e) => {
              e.target.disabled = true;
              try {
                await saveEvent(trip, event, { status: e.target.value });
                rerender();
                const name = e.target.value ? statusName(e.target.value) : t('无状态', 'no status');
                setStatus(t(`已将“${event.title}”标记为${name}。`, `Marked “${event.title}” as ${name.toLowerCase()}.`));
              } catch (error) {
                e.target.disabled = false;
                e.target.value = event.status || '';
                setStatus(error.message, true);
              }
            },
          }),
        ]),
      ]),
    ]);
    if (hasMore) li.classList.add('has-more');
    if (view.openEvents.has(event.id)) li.classList.add('open');
    // Compact view: tap an event to see its notes, link and edit actions.
    const toggle = () => {
      if (!view.compact || !hasMore) return;
      const open = li.classList.toggle('open');
      if (open) view.openEvents.add(event.id);
      else view.openEvents.delete(event.id);
    };
    li.addEventListener('click', (e) => {
      if (e.target.closest('a, button, select, input, textarea, form') || String(getSelection())) return;
      toggle();
    });
    if (hasMore) {
      li.tabIndex = 0;
      li.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === li) {
          e.preventDefault();
          toggle();
        }
      });
    }
    if (editable && state.editing === event.id) {
      li.append(eventForm(event, {
        title: t('编辑安排', 'Edit event'),
        onCancel: closeForm,
        onSave: async (values) => {
          await saveEvent(trip, event, values);
          closeForm();
          setStatus(t('安排已保存。', 'Event saved.'));
        },
      }));
    }
    return li;
  }

  function newEventForm(date) {
    return eventForm({ date }, {
      title: t('添加安排', 'Add event'),
      onCancel: closeForm,
      onSave: async (values) => {
        const { trip } = await api('POST', `/api/trips/${state.trip.id}/events`, values);
        state.trip = trip;
        closeForm();
        setStatus(t(`已添加“${values.title}”。`, `Added “${values.title}”.`));
      },
    });
  }

  function openNewEvent(date) {
    state.editing = `new:${date}`;
    rerender();
  }

  // Which days are folded, remembered per trip (or per share link) in this browser.
  const foldKey = (trip) => `folded:${trip.id || location.pathname}`;
  function foldedDays(trip) {
    const saved = prefs.get(foldKey(trip), null);
    if (Array.isArray(saved)) return new Set(saved);
    // First visit during the trip: fold the days that are already over.
    const today = todayIso();
    const inProgress = trip.startDate && trip.startDate <= today && today <= (trip.endDate || trip.startDate);
    return new Set(inProgress ? trip.events.map((e) => e.date).filter((d) => d && d < today) : []);
  }
  function saveFolds(trip) {
    prefs.set(foldKey(trip), [...main.querySelectorAll('details.day:not([open])')].map((d) => d.dataset.date));
  }

  function viewBar(trip) {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const event of trip.events) if (event.status) counts[event.status] += 1;
    const segment = (compact, text) => el('button', {
      type: 'button',
      text,
      'aria-pressed': String(view.compact === compact),
      onclick: () => { view.compact = compact; prefs.set('compact', compact); rerender(); },
    });
    const foldAll = (fold) => () => {
      prefs.set(foldKey(trip), fold ? groupByDay(trip, { includeEmptyDays: true }).map(([d]) => d) : []);
      rerender();
    };
    const chips = STATUSES.filter((s) => counts[s]).map((s) => el('button', {
      type: 'button',
      class: 'chip',
      'data-status': s,
      title: t(`${statusHint(s)}——只看这些`, `${statusHint(s)} — show only these`),
      'aria-pressed': String(view.filter === s),
      onclick: () => { view.filter = view.filter === s ? '' : s; rerender(); },
    }, [el('span', { class: 'dot', 'data-status': s }), `${statusName(s)} `, el('b', { text: counts[s] })]));
    return el('div', { class: 'viewbar' }, [
      el('div', { class: 'segmented', role: 'group', 'aria-label': t('视图', 'View') }, [segment(true, t('简洁', 'Compact')), segment(false, t('详细', 'Detailed'))]),
      el('button', { type: 'button', class: 'link', text: t('全部展开', 'Expand all'), onclick: foldAll(false) }),
      el('button', { type: 'button', class: 'link', text: t('全部折叠', 'Collapse all'), onclick: foldAll(true) }),
      chips.length > 0 && el('div', { class: 'chips' }, [
        ...chips,
        view.filter && el('button', { type: 'button', class: 'link', text: t('显示全部', 'Show all'), onclick: () => { view.filter = ''; rerender(); } }),
      ]),
    ]);
  }

  function postBody(trip, { editable }) {
    const days = groupByDay(trip, { includeEmptyDays: editable && !view.filter });
    // A new event for a day that isn't listed yet (e.g. "Anytime") gets its own section.
    if (editable && typeof state.editing === 'string' && state.editing.startsWith('new:')) {
      const date = state.editing.slice(4);
      if (!days.some(([d]) => d === date)) days.push([date, []]);
    }
    const folded = foldedDays(trip);
    const nodes = [];
    for (const [date, allEvents] of days) {
      const letters = optionLetters(allEvents);
      const events = view.filter ? allEvents.filter((e) => e.status === view.filter) : allEvents;
      const adding = editable && state.editing === `new:${date}`;
      if (view.filter && !events.length && !adding) continue;
      const { title, sub } = dayHeading(trip, date);
      const open = Boolean(view.filter) || adding || events.some((e) => e.id === state.editing) || !folded.has(date);
      nodes.push(el('details', { class: 'day', 'data-date': date, open }, [
        el('summary', { class: 'day-head', onclick: () => setTimeout(() => saveFolds(trip), 0) }, [
          el('div', { class: 'day-title' }, [
            el('h2', { text: title }),
            el('span', { class: 'date', text: sub }),
            el('span', { class: 'dots', 'aria-hidden': 'true' }, allEvents.map((e) => el('span', { class: 'dot', 'data-status': e.status || 'none' }))),
            editable && el('button', {
              class: 'link',
              type: 'button',
              text: t('+ 添加', '+ Add'),
              onclick: (e) => { e.preventDefault(); e.stopPropagation(); openNewEvent(date); },
            }),
          ]),
          events.length > 0 && el('p', {
            class: 'day-peek',
            text: events.map((e) => [e.time, letters.has(e.id) ? `${letters.get(e.id)}.` : '', e.title].filter(Boolean).join(' ')).join('  ·  '),
          }),
        ]),
        events.length
          ? el('ol', { class: 'events' }, events.map((event) => eventItem(trip, event, editable, letters.get(event.id))))
          : el('p', { class: 'nothing', text: t('暂无安排。', 'Nothing planned yet.') }),
        adding && newEventForm(date),
      ]));
    }
    if (!nodes.length) nodes.push(el('p', { class: 'empty', text: editable ? t('还没有安排——添加第一个吧。', 'No events yet — add the first one.') : t('暂无安排。', 'Nothing planned yet.') }));
    const list = el('div', { class: `days${view.compact ? ' compact' : ''}` }, nodes);
    return trip.events.length ? [viewBar(trip), list] : [list];
  }

  async function deleteEvent(event) {
    if (!confirm(t(`删除“${event.title}”？`, `Delete “${event.title}”?`))) return;
    try {
      const { trip } = await api('DELETE', `/api/trips/${state.trip.id}/events/${event.id}`);
      state.trip = trip;
      rerender();
      setStatus(t('安排已删除。', 'Event deleted.'));
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  async function setShare(method) {
    state.trip = await api(method, `/api/trips/${state.trip.id}/share`);
  }

  function shareAction(action, message) {
    return async () => {
      try {
        await action();
        rerender();
        setStatus(message);
      } catch (error) {
        setStatus(error.message, true);
      }
    };
  }

  function sharePanel(trip) {
    if (!trip.shareToken) {
      return el('div', { class: 'share' }, [
        el('p', { text: t('只有登录的成员能看到这个行程。创建链接后，朋友无需登录即可查看和编辑这个行程。', 'Only signed-in people can see this trip. Create a link to let friends view and edit it without signing in.') }),
        el('div', { class: 'row' }, [el('button', {
          class: 'primary',
          text: t('创建分享链接', 'Create share link'),
          onclick: shareAction(() => setShare('POST'), t('分享链接已创建。', 'Share link ready.')),
        })]),
      ]);
    }
    const url = `${location.origin}${tripPath(trip.id)}?token=${trip.shareToken}`;
    const input = el('input', { readonly: true, value: url, 'aria-label': t('分享链接', 'Share link'), onfocus: (e) => e.target.select() });
    return el('div', { class: 'share' }, [
      el('p', { text: t('任何人拿到此链接都无需登录即可查看和编辑这个行程（包括文件），但看不到其他行程，也不能删除行程或更改链接。', 'Anyone with this link can view and edit this trip (including files) without signing in. They can’t see other trips, delete this one or change the link.') }),
      el('div', { class: 'row' }, [
        input,
        el('button', {
          class: 'primary',
          type: 'button',
          text: t('复制', 'Copy'),
          onclick: async (e) => {
            const button = e.currentTarget;
            input.focus();
            input.select();
            let copied = false;
            try {
              // execCommand copies the selected text synchronously and works where the async API is blocked.
              copied = document.execCommand('copy');
            } catch { /* fall through */ }
            if (!copied && navigator.clipboard) {
              try {
                await navigator.clipboard.writeText(url);
                copied = true;
              } catch { /* fall through */ }
            }
            button.textContent = copied ? t('已复制 ✓', 'Copied ✓') : t('请按 ⌘C', 'Press ⌘C');
            setTimeout(() => { button.textContent = t('复制', 'Copy'); }, 2500);
          },
        }),
        el('button', {
          text: t('新链接', 'New link'),
          title: t('让当前链接失效并创建新链接', 'Stop the current link working and create a new one'),
          onclick: () => confirm(t('创建新链接？当前链接将失效。', 'Create a new link? The current link will stop working.'))
            && shareAction(async () => { await setShare('DELETE'); await setShare('POST'); }, t('新分享链接已创建。', 'New share link ready.'))(),
        }),
        el('button', {
          class: 'danger',
          text: t('停止分享', 'Stop sharing'),
          onclick: () => confirm(t('停止分享？链接将立即失效。', 'Stop sharing? The link will stop working immediately.'))
            && shareAction(() => setShare('DELETE'), t('已停止分享。', 'Sharing stopped.'))(),
        }),
      ]),
    ]);
  }

  const brand = () => t('DL 旅行计划', 'DL Travel Plan');

  function renderTrip() {
    const trip = state.trip;
    const guest = isGuest();
    const editingTrip = state.editing === 'trip';
    const editTrip = () => { state.editing = 'trip'; rerender(); };
    document.title = `${trip.title} · ${brand()}`;
    const head = editingTrip
      ? tripForm(trip, {
        title: t('编辑行程', 'Edit trip'),
        onCancel: closeForm,
        onSave: async (values) => {
          state.trip = await api('PUT', `/api/trips/${trip.id}`, values);
          closeForm();
          setStatus(t('行程已保存。', 'Trip saved.'));
        },
        extra: !guest && el('button', {
          type: 'button',
          class: 'danger',
          text: t('删除行程', 'Delete trip'),
          onclick: async () => {
            if (!confirm(t(`删除“${trip.title}”及其所有安排和文件？此操作无法撤销。`, `Delete “${trip.title}” with all its events and files? This cannot be undone.`))) return;
            try {
              await api('DELETE', `/api/trips/${trip.id}`);
              location.href = '/';
            } catch (error) {
              setStatus(error.message, true);
            }
          },
        }),
      })
      : el('header', { class: 'post-head' }, [
        kicker(trip),
        el('h1', { text: trip.title }),
        trip.intro
          ? el('div', { class: 'intro', text: trip.intro })
          : el('button', { type: 'button', class: 'link add-description', text: t('+ 添加行程描述', '+ Add a description'), onclick: editTrip }),
        el('p', { class: 'meta', text: formatStamp(trip.updatedAt, trip.updatedBy) }),
      ]);
    show(el('article', { class: 'post' }, [
      head,
      !editingTrip && el('div', { class: 'toolbar' }, [
        !guest && el('a', { class: 'button', href: '/', text: t('← 全部行程', '← All trips') }),
        el('button', { text: t('编辑行程', 'Edit trip'), onclick: editTrip }),
        el('button', { class: 'primary', text: t('+ 添加安排', '+ Add event'), onclick: () => openNewEvent(trip.startDate || '') }),
      ]),
      guest && !editingTrip && el('p', { class: 'guest-note' }, [
        t('你正通过分享链接查看和编辑此行程。', 'You’re viewing and editing this trip through a share link. '),
        el('a', { href: `/auth/login?return=${encodeURIComponent(location.pathname)}`, text: t('成员登录', 'Members sign in') }),
      ]),
      !editingTrip && !guest && sharePanel(trip),
      tripFiles(trip, true),
      ...postBody(trip, { editable: true }),
    ]));
  }

  // ---------- index ----------
  async function renderIndex() {
    if (!state.me.signedIn) {
      show(signInCard(state.me.configured === false
        ? t('尚未配置登录。', 'Sign-in is not configured yet.')
        : t('行程不公开。请使用 dliu.com 的 Microsoft 账号登录——朋友可通过分享链接查看。', 'Trips are private. Sign in with your dliu.com Microsoft account — friends open trips through share links.')));
      return;
    }
    const { trips } = await api('GET', '/api/trips');
    const formSlot = el('div');
    const newButton = el('button', { class: 'primary', text: t('+ 新行程', '+ New trip') });
    newButton.addEventListener('click', () => {
      newButton.hidden = true;
      formSlot.replaceChildren(tripForm({}, {
        title: t('新行程', 'New trip'),
        onCancel: () => { formSlot.replaceChildren(); newButton.hidden = false; },
        onSave: async (values) => {
          const trip = await api('POST', '/api/trips', values);
          location.href = tripPath(trip.id);
        },
      }));
    });
    show(
      el('div', { class: 'page-head' }, [el('h1', { text: t('行程', 'Trips') }), newButton]),
      formSlot,
      trips.length
        ? el('ul', { class: 'posts' }, trips.map((trip) => el('li', {}, [
          el('a', { class: 'post-card', href: tripPath(trip.id) }, [
            kicker(trip),
            el('h2', { text: trip.title }),
            trip.excerpt && el('p', { text: trip.excerpt }),
          ]),
        ])))
        : el('p', { class: 'empty', text: t('还没有行程，开始计划一个吧！', 'No trips yet. Start planning one!') }),
    );
  }

  // ---------- routing ----------
  // Trips created before /plan/<YYYYMMNN> addresses.
  const LEGACY_IDS = { 'spain-ibiza-67mrt9qxtc': '20261000' };

  // /about and /security are public; the account line still shows who is signed in.
  function renderInfo(page) {
    state.trip = null;
    show(page === 'about' ? window.PlanInfo.about(t) : window.PlanInfo.security(t));
    document.title = `${page === 'about' ? t('关于', 'About') : t('安全', 'Security')} · ${brand()}`;
    api('GET', '/api/me').then((me) => { state.me = me; renderAccount(); }).catch(() => {});
  }

  async function start() {
    const path = location.pathname;
    const info = path.match(/^\/(about|security)\/?$/);
    markNav(info && info[1]);
    main.classList.toggle('wide', Boolean(info));
    if (info) {
      renderInfo(info[1]);
      return;
    }
    const legacyShare = path.match(/^\/s\/([A-Za-z0-9_-]{24})\/?$/);
    const legacyTrip = path.match(/^\/trips\/([a-z0-9-]+)\/?$/);
    const plan = path.match(/^\/plan\/(\d{8})\/?$/);
    const token = new URLSearchParams(location.search).get('token') || '';
    state.token = plan && /^[A-Za-z0-9_-]{24}$/.test(token) ? token : null;
    try {
      // Old share links (/s/<token>) now open the trip itself with the token.
      if (legacyShare) {
        const { id } = await api('GET', `/api/shared/${legacyShare[1]}`);
        location.replace(`${tripPath(id)}?token=${legacyShare[1]}`);
        return;
      }
      if (legacyTrip) {
        const id = LEGACY_IDS[legacyTrip[1]] || (/^\d{8}$/.test(legacyTrip[1]) ? legacyTrip[1] : '');
        if (id) {
          location.replace(tripPath(id));
          return;
        }
        throw Object.assign(new Error('Trip not found'), { status: 404 });
      }
      state.me = await api('GET', '/api/me');
      renderAccount();
      if (plan) {
        if (!state.me.signedIn && !state.token) {
          show(signInCard(t('登录后可查看和编辑此行程。朋友可通过分享链接打开。', 'Sign in to see and edit this trip. Friends open trips through share links.')));
          return;
        }
        setStatus(t('正在载入…', 'Loading…'));
        state.trip = await api('GET', `/api/trips/${plan[1]}`);
        setStatus('');
        renderTrip();
        return;
      }
      await renderIndex();
    } catch (error) {
      show();
      if (error.status === 404) setStatus(legacyShare ? t('此链接已停止分享。', 'This link isn’t shared any more.') : t('找不到这个行程。', 'Trip not found.'), true);
      else if (error.status === 403 && state.token) setStatus(t('此分享链接已失效。请向行程成员索取新链接，或登录。', 'This share link no longer works. Ask for a new one, or sign in.'), true);
      else setStatus(error.message, true);
    }
  }

  // Print the whole plan: every day unfolded, every note in full.
  window.addEventListener('beforeprint', () => {
    main.querySelectorAll('details.day').forEach((d) => { d.open = true; });
    main.querySelectorAll('.days.compact').forEach((d) => d.classList.remove('compact'));
  });
  window.addEventListener('afterprint', () => { if (state.trip) rerender(); });

  // ---------- language switch ----------
  const languageToggle = document.querySelector('.language-toggle');
  const languages = document.getElementById('site-languages');
  const setLanguagesOpen = (open) => {
    languages.classList.toggle('is-open', open);
    languageToggle.setAttribute('aria-expanded', String(open));
  };
  function markNav(page) {
    for (const a of document.querySelectorAll('[data-nav]')) {
      if (a.dataset.nav === page) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }
  function applyLanguage() {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    document.querySelector('[data-nav="about"]').textContent = t('关于', 'About');
    document.querySelector('[data-nav="security"]').textContent = t('安全', 'Security');
    document.querySelector('.brand').textContent = brand();
    document.title = state.trip ? `${state.trip.title} · ${brand()}` : brand();
    languageToggle.setAttribute('aria-label', t('语言', 'Language'));
    for (const button of languages.querySelectorAll('[data-language]')) button.setAttribute('aria-pressed', String(button.dataset.language === language));
  }
  languages.addEventListener('click', (event) => {
    const button = event.target.closest('[data-language]');
    if (!button) return;
    setLanguagesOpen(false);
    if (button.dataset.language === language) return;
    language = button.dataset.language;
    try { localStorage.setItem(LANGUAGE_KEY, language); } catch { /* storage unavailable */ }
    applyLanguage();
    renderAccount();
    setStatus('');
    if (state.trip) rerender();
    else start();
  });
  languageToggle.addEventListener('click', () => setLanguagesOpen(!languages.classList.contains('is-open')));
  document.addEventListener('click', (event) => {
    if (languages.classList.contains('is-open') && !languages.contains(event.target) && !languageToggle.contains(event.target)) setLanguagesOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && languages.classList.contains('is-open')) {
      setLanguagesOpen(false);
      languageToggle.focus();
    }
  });
  applyLanguage();

  start();
})();
