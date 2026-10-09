'use strict';

(() => {
  const main = document.getElementById('main');
  const statusEl = document.getElementById('status');
  const state = { me: { signedIn: false }, trip: null, editing: null };

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
      const error = new Error(data.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  // Dates are calendar days (YYYY-MM-DD), always handled in UTC so they never shift.
  const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
  const fmt = (iso, options) => toDate(iso).toLocaleDateString('en-GB', { timeZone: 'UTC', ...options });
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
    const startOptions = sameMonth ? { day: 'numeric' } : sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
    return `${fmt(s, startOptions)} – ${fmt(e, { day: 'numeric', month: 'short', year: 'numeric' })} · ${dayDiff(s, e) + 1} days`;
  }

  function when(trip) {
    const today = todayIso();
    const start = trip.startDate;
    const end = trip.endDate || trip.startDate;
    if (!start) return 'Planning';
    if (today < start) {
      const n = dayDiff(today, start);
      return n === 1 ? 'Tomorrow' : `In ${n} days`;
    }
    return today <= end ? 'Happening now' : '';
  }

  function kicker(trip) {
    const status = when(trip);
    const range = dateRange(trip);
    return el('p', { class: 'kicker' }, [
      status && el('span', { class: 'when', text: status }),
      trip.destination && el('span', { text: trip.destination }),
      range && el('span', { text: range }),
      trip.shared && el('span', { class: 'badge', text: 'Shared' }),
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
  const formatStamp = (iso, by) => (iso
    ? `Last updated ${new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}${by ? ` by ${by}` : ''}`
    : '');

  function renderAccount() {
    const account = document.getElementById('account');
    account.replaceChildren(state.me.signedIn
      ? el('span', {}, [`${state.me.name || state.me.user} · `, el('a', { href: '/auth/logout', text: 'Sign out' })])
      : el('a', { href: `/auth/login?return=${encodeURIComponent(location.pathname)}`, text: 'Sign in' }));
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
      el('h1', { text: 'Our trip plans' }),
      el('p', { text: message }),
      el('a', { class: 'ms-signin', href: `/auth/login?return=${encodeURIComponent(location.pathname)}` }, [
        microsoftLogo(),
        el('span', { text: 'Sign in with Microsoft' }),
      ]),
    ]);
  }

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
        el('button', { type: 'button', text: 'Cancel', onclick: onCancel }),
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
      title: el('input', { required: true, maxlength: 120, value: trip.title || '', placeholder: 'Autumn in Kyoto' }),
      destination: el('input', { maxlength: 120, value: trip.destination || '', placeholder: 'Kyoto, Japan' }),
      startDate: el('input', { type: 'date', value: trip.startDate || '' }),
      endDate: el('input', { type: 'date', value: trip.endDate || '' }),
      intro: el('textarea', { maxlength: 10000, rows: 4, placeholder: 'A few words about the trip — who is coming, the idea, what to expect.' }),
    };
    inputs.intro.value = trip.intro || '';
    inputs.startDate.addEventListener('change', () => {
      const s = inputs.startDate.value;
      if (s && (!inputs.endDate.value || inputs.endDate.value < s)) inputs.endDate.value = s;
    });
    return form(options.title, inputs, [
      field('Title', inputs.title),
      el('div', { class: 'fields' }, [field('Destination', inputs.destination), field('From', inputs.startDate), field('To', inputs.endDate)]),
      field('Intro', inputs.intro),
    ], { submitLabel: 'Save', ...options });
  }

  function eventForm(event, options) {
    const inputs = {
      date: el('input', { type: 'date', value: event.date || '' }),
      time: el('input', { type: 'time', value: event.time || '' }),
      title: el('input', { required: true, maxlength: 200, value: event.title || '', placeholder: 'Fushimi Inari at sunrise' }),
      place: el('input', { maxlength: 200, value: event.place || '', placeholder: 'Fushimi Inari Taisha, Kyoto' }),
      link: el('input', { type: 'url', maxlength: 2000, value: event.link || '', placeholder: 'https://…' }),
      notes: el('textarea', { maxlength: 4000, rows: 3, placeholder: 'Details, meeting point, what to bring…' }),
    };
    inputs.notes.value = event.notes || '';
    return form(options.title, inputs, [
      el('div', { class: 'fields' }, [field('Date', inputs.date), field('Time', inputs.time)]),
      field('What', inputs.title),
      el('div', { class: 'fields' }, [field('Where', inputs.place), field('Link', inputs.link)]),
      field('Notes', inputs.notes),
    ], { submitLabel: 'Save event', ...options });
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
    if (!date) return { title: 'Anytime', sub: 'Not tied to a day yet' };
    const sub = fmt(date, { weekday: 'long', day: 'numeric', month: 'long' });
    if (trip.startDate && date >= trip.startDate && (!trip.endDate || date <= trip.endDate)) {
      return { title: `Day ${dayDiff(trip.startDate, date) + 1}`, sub };
    }
    return { title: fmt(date, { weekday: 'short' }), sub: fmt(date, { day: 'numeric', month: 'long', year: 'numeric' }) };
  }

  const rerender = () => renderTrip();
  const closeForm = () => { state.editing = null; rerender(); };

  function eventItem(trip, event, editable) {
    const link = safeLink(event.link);
    const li = el('li', { class: 'event' }, [
      el('div', { class: 'time', text: event.time || '' }),
      el('div', { class: 'body' }, [
        el('h3', { text: event.title }),
        event.place && el('p', { class: 'place' }, [
          el('a', { href: mapsUrl(event.place), target: '_blank', rel: 'noopener noreferrer', text: `📍 ${event.place}` }),
        ]),
        event.notes && el('p', { class: 'notes', text: event.notes }),
        link && el('a', { class: 'ext', href: link, target: '_blank', rel: 'noopener noreferrer', text: `${linkLabel(link)} ↗` }),
        editable && el('div', { class: 'actions' }, [
          el('button', { class: 'link', text: 'Edit', onclick: () => { state.editing = event.id; rerender(); } }),
          el('button', { class: 'link danger', text: 'Delete', onclick: () => deleteEvent(event) }),
        ]),
      ]),
    ]);
    if (editable && state.editing === event.id) {
      li.append(eventForm(event, {
        title: 'Edit event',
        onCancel: closeForm,
        onSave: async (values) => {
          const { trip: updated } = await api('PUT', `/api/trips/${trip.id}/events/${event.id}`, values);
          state.trip = updated;
          closeForm();
          setStatus('Event saved.');
        },
      }));
    }
    return li;
  }

  function newEventForm(date) {
    return eventForm({ date }, {
      title: 'Add event',
      onCancel: closeForm,
      onSave: async (values) => {
        const { trip } = await api('POST', `/api/trips/${state.trip.id}/events`, values);
        state.trip = trip;
        closeForm();
        setStatus(`Added “${values.title}”.`);
      },
    });
  }

  function openNewEvent(date) {
    state.editing = `new:${date}`;
    rerender();
  }

  function postBody(trip, { editable }) {
    const days = groupByDay(trip, { includeEmptyDays: editable });
    // A new event for a day that isn't listed yet (e.g. "Anytime") gets its own section.
    if (editable && typeof state.editing === 'string' && state.editing.startsWith('new:')) {
      const date = state.editing.slice(4);
      if (!days.some(([d]) => d === date)) days.push([date, []]);
    }
    const nodes = days.map(([date, events]) => {
      const { title, sub } = dayHeading(trip, date);
      return el('section', { class: 'day' }, [
        el('div', { class: 'day-head' }, [
          el('h2', { text: title }),
          el('span', { class: 'date', text: sub }),
          editable && el('button', { class: 'link', text: '+ Add', onclick: () => openNewEvent(date) }),
        ]),
        events.length
          ? el('ol', { class: 'events' }, events.map((event) => eventItem(trip, event, editable)))
          : el('p', { class: 'nothing', text: 'Nothing planned yet.' }),
        editable && state.editing === `new:${date}` && newEventForm(date),
      ]);
    });
    if (!nodes.length) nodes.push(el('p', { class: 'empty', text: editable ? 'No events yet — add the first one.' : 'Nothing planned yet.' }));
    return nodes;
  }

  async function deleteEvent(event) {
    if (!confirm(`Delete “${event.title}”?`)) return;
    try {
      const { trip } = await api('DELETE', `/api/trips/${state.trip.id}/events/${event.id}`);
      state.trip = trip;
      rerender();
      setStatus('Event deleted.');
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
        el('p', { text: 'Only signed-in people can see this trip. Create a link to let friends view it (read-only) without signing in.' }),
        el('div', { class: 'row' }, [el('button', { class: 'primary', text: 'Create share link', onclick: shareAction(() => setShare('POST'), 'Share link ready.') })]),
      ]);
    }
    const url = `${location.origin}/s/${trip.shareToken}`;
    const input = el('input', { readonly: true, value: url, 'aria-label': 'Share link', onfocus: (e) => e.target.select() });
    return el('div', { class: 'share' }, [
      el('p', { text: 'Anyone with this link can view the trip (read-only) without signing in.' }),
      el('div', { class: 'row' }, [
        input,
        el('button', {
          class: 'primary',
          type: 'button',
          text: 'Copy',
          onclick: async (e) => {
            try {
              await navigator.clipboard.writeText(url);
              e.target.textContent = 'Copied ✓';
            } catch {
              input.select();
            }
          },
        }),
        el('a', { class: 'button', href: `/s/${trip.shareToken}`, target: '_blank', rel: 'noopener', text: 'Preview' }),
        el('button', {
          text: 'New link',
          title: 'Stop the current link working and create a new one',
          onclick: () => confirm('Create a new link? The current link will stop working.')
            && shareAction(async () => { await setShare('DELETE'); await setShare('POST'); }, 'New share link ready.')(),
        }),
        el('button', {
          class: 'danger',
          text: 'Stop sharing',
          onclick: () => confirm('Stop sharing? The link will stop working immediately.')
            && shareAction(() => setShare('DELETE'), 'Sharing stopped.')(),
        }),
      ]),
    ]);
  }

  function renderTrip() {
    const trip = state.trip;
    const editingTrip = state.editing === 'trip';
    document.title = `${trip.title} · Plan`;
    const head = editingTrip
      ? tripForm(trip, {
        title: 'Edit trip',
        onCancel: closeForm,
        onSave: async (values) => {
          state.trip = await api('PUT', `/api/trips/${trip.id}`, values);
          closeForm();
          setStatus('Trip saved.');
        },
        extra: el('button', {
          type: 'button',
          class: 'danger',
          text: 'Delete trip',
          onclick: async () => {
            if (!confirm(`Delete “${trip.title}” and all its events? This cannot be undone.`)) return;
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
        trip.intro && el('div', { class: 'intro', text: trip.intro }),
        el('p', { class: 'meta', text: formatStamp(trip.updatedAt, trip.updatedBy) }),
      ]);
    show(el('article', { class: 'post' }, [
      head,
      !editingTrip && el('div', { class: 'toolbar' }, [
        el('a', { class: 'button', href: '/', text: '← All trips' }),
        el('button', { text: 'Edit trip', onclick: () => { state.editing = 'trip'; rerender(); } }),
        el('button', { class: 'primary', text: '+ Add event', onclick: () => openNewEvent(trip.startDate || '') }),
      ]),
      !editingTrip && sharePanel(trip),
      ...postBody(trip, { editable: true }),
    ]));
  }

  function renderShared(trip) {
    document.title = `${trip.title} · Plan`;
    show(el('article', { class: 'post' }, [
      el('header', { class: 'post-head' }, [
        kicker(trip),
        el('h1', { text: trip.title }),
        trip.intro && el('div', { class: 'intro', text: trip.intro }),
      ]),
      ...postBody(trip, { editable: false }),
      el('footer', { class: 'shared', text: formatStamp(trip.updatedAt) }),
    ]));
  }

  // ---------- index ----------
  async function renderIndex() {
    if (!state.me.signedIn) {
      show(signInCard(state.me.configured === false
        ? 'Sign-in is not configured yet.'
        : 'Trips are private. Sign in with your dliu.com Microsoft account — friends open trips through share links.'));
      return;
    }
    const { trips } = await api('GET', '/api/trips');
    const formSlot = el('div');
    const newButton = el('button', { class: 'primary', text: '+ New trip' });
    newButton.addEventListener('click', () => {
      newButton.hidden = true;
      formSlot.replaceChildren(tripForm({}, {
        title: 'New trip',
        onCancel: () => { formSlot.replaceChildren(); newButton.hidden = false; },
        onSave: async (values) => {
          const trip = await api('POST', '/api/trips', values);
          location.href = `/trips/${trip.id}`;
        },
      }));
    });
    show(
      el('div', { class: 'page-head' }, [el('h1', { text: 'Trips' }), newButton]),
      formSlot,
      trips.length
        ? el('ul', { class: 'posts' }, trips.map((trip) => el('li', {}, [
          el('a', { class: 'post-card', href: `/trips/${trip.id}` }, [
            kicker(trip),
            el('h2', { text: trip.title }),
            trip.excerpt && el('p', { text: trip.excerpt }),
          ]),
        ])))
        : el('p', { class: 'empty', text: 'No trips yet. Start planning one!' }),
    );
  }

  // ---------- routing ----------
  async function start() {
    const path = location.pathname;
    const shared = path.match(/^\/s\/([A-Za-z0-9_-]+)\/?$/);
    const trip = path.match(/^\/trips\/([a-z0-9-]+)\/?$/);
    try {
      if (shared) {
        setStatus('Loading…');
        const data = await api('GET', `/api/shared/${shared[1]}`);
        setStatus('');
        renderShared(data);
        return;
      }
      state.me = await api('GET', '/api/me');
      renderAccount();
      if (trip) {
        if (!state.me.signedIn) {
          show(signInCard('Sign in to see and edit this trip. Friends open trips through share links.'));
          return;
        }
        setStatus('Loading…');
        state.trip = await api('GET', `/api/trips/${trip[1]}`);
        setStatus('');
        renderTrip();
        return;
      }
      await renderIndex();
    } catch (error) {
      show();
      if (error.status === 404) setStatus(shared ? 'This link isn’t shared any more.' : 'Trip not found.', true);
      else setStatus(error.message, true);
    }
  }

  start();
})();
