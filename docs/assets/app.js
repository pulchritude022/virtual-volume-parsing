/* Stranraer Presbytery transcription archive — front-end.
   Zero dependencies. Fetches the JSON emitted by scripts/build_site.py and
   renders (a) the overview / wiki index and (b) the side-by-side page viewer.
   Served as static files; needs http:// (fetch), so run a local server for
   local review — see README. */

'use strict';

/* ------------------------------------------------------------------ utils */

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function getJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`);
  return res.json();
}

const qs = (k) => new URLSearchParams(location.search).get(k);

function slugNumber(slug) {
  const m = /(\d+)/.exec(slug || '');
  return m ? parseInt(m[1], 10) : null;
}

/* Highlight editorial marks in diplomatic text: [expansion], [?], [illeg.]. */
function markEditorial(text) {
  return esc(text).replace(/\[[^\]]*\]/g, (m) => `<span class="ed">${m}</span>`);
}

/* Confidence can be a scalar ("high") or a per-folio object; summarise it. */
function confSummary(conf) {
  if (!conf) return null;
  if (typeof conf === 'string') return conf;
  const vals = Object.values(conf).map((v) => String(v).split('#')[0].trim()).filter(Boolean);
  const rank = { high: 3, medium: 2, low: 1 };
  vals.sort((a, b) => (rank[a] || 0) - (rank[b] || 0));
  return vals[0] || null; // worst (most cautious) confidence
}

function confBadge(conf) {
  const c = confSummary(conf);
  if (!c) return null;
  const key = c.toLowerCase();
  return el('span', { class: `badge conf-${key}` }, `conf: ${c}`);
}

function statusBadge(status) {
  if (!status) return null;
  const cls = `badge status-${String(status).toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return el('span', { class: cls }, status.replace(/-/g, ' '));
}

/* Rewrite the wiki's two link conventions into real site hrefs:
   - [text](entity:kind/slug)  -> entity.html?vol=...&kind=...&slug=...
   - bare `img_0153` citation tokens -> a link into the viewer at that opening
   Applied to raw markdown *before* renderMarkdown, since both are plain-text
   rewrites (the img_NNNN form isn't valid markdown link syntax to begin with). */
function resolveWikiLinks(md, volId) {
  if (!md) return md;
  // Bracketed citation groups like "[img_153]" or "[img_4–10, img_153]" are
  // plain-text asides, not markdown links (no following "(...)") — swap their
  // brackets for parens first so the img_NNN auto-linking below can't nest a
  // markdown link inside an existing "[...]" and corrupt both.
  let out = md.replace(/\[(img_\d{1,4}[^\]]*)\]/g, '($1)');
  out = out.replace(/\(entity:(person|place|event)\/([a-z0-9-]+)\)/g,
    (_, kind, slug) => `(entity.html?vol=${encodeURIComponent(volId)}&kind=${kind}&slug=${encodeURIComponent(slug)})`);
  // Auto-link every remaining bare img_N / img_NNNN token. Wiki prose is
  // written with plain page numbers (img_153); the actual page slugs are
  // zero-padded to 4 digits (img_0153) — pad here rather than in every
  // citation, so authoring stays terse.
  out = out.replace(/\bimg_(\d{1,4})\b/g, (_, n) => {
    const slug = `img_${n.padStart(4, '0')}`;
    return `[img_${n}](viewer.html?vol=${encodeURIComponent(volId)}&img=${slug})`;
  });
  return out;
}

/* Tiny markdown renderer — enough for the Notes blocks (bold, code, links,
   headings, nested-ish bullet + numbered lists, paragraphs). Not general. */
function renderMarkdown(md) {
  if (!md) return '';
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // `text`/`href` here are already HTML-escaped (esc(s) ran over the whole
    // string above) — use them as-is; re-escaping would double-encode `&`.
    .replace(/\[([^\]]+)\]\(((?:https?:|entity\.html|viewer\.html)[^)]+)\)/g,
      (m, text, href) => `<a href="${href}"${/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`);

  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let list = null;       // 'ul' | 'ol' | null
  let para = [];
  const flushPara = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flushPara(); closeList(); continue; }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { flushPara(); closeList(); html += `<h3>${inline(h[2])}</h3>`; continue; }

    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ol || ul) {
      flushPara();
      const want = ol ? 'ol' : 'ul';
      if (list !== want) { closeList(); html += `<${want}>`; list = want; }
      html += `<li>${inline((ol || ul)[1])}</li>`;
      continue;
    }
    // continuation line inside a list item → append to previous <li>
    if (list && /^\s{2,}\S/.test(raw)) {
      html = html.replace(/<\/li>$/, ' ' + inline(line.trim()) + '</li>');
      continue;
    }
    para.push(line.trim());
  }
  flushPara(); closeList();
  return html;
}

/* ---------------------------------------------------------------- overview */

async function initHome() {
  const root = $('#home');
  try {
    const { volumes } = await getJSON('data/volumes.json');
    if (!volumes || !volumes.length) {
      root.replaceChildren(el('p', { class: 'empty' }, 'No volumes built yet. Run scripts/build_site.py.'));
      return;
    }
    // Primary volume drives the deep sections; others just get a card.
    const primary = volumes[0];
    HOME_VOL = primary.id;
    const index = await getJSON(`data/${primary.id}/index.json`);

    root.replaceChildren(
      renderHero(primary),
      renderCopyrightCallout(),
      renderVolumeCards(volumes),
      renderContentsLink(index),
      renderEntityIndex('Events & controversies', index.events, 'event'),
      renderEntityIndex('People', index.people, 'person'),
      renderEntityIndex('Places', index.places, 'place'),
      renderEntityIndex('Topics', index.topics, 'topic'),
      renderFooter(),
    );
  } catch (err) {
    root.replaceChildren(el('div', { class: 'callout' },
      el('b', {}, 'Could not load site data. '),
      'Did you run ', el('code', {}, 'python scripts/build_site.py'),
      ' and open this over http (not file://)? ', el('br'), err.message));
  }
}

function renderHero(v) {
  return el('div', { class: 'hero' },
    el('div', { class: 'eyebrow' }, 'ScotlandsPeople Virtual Volume · ' + (v.reference || '')),
    el('h1', {}, v.title || v.id),
    el('p', { class: 'sub' },
      'A working archive of transcriptions, translations, and — as the corpus grows — a ' +
      'cross-linked wiki of the people, places, and events of the ' +
      (v.place || 'Rhins of Galloway') + '. Each page pairs the original manuscript ' +
      'opening with a diplomatic transcription and a modern-English rendering.'),
  );
}

function renderCopyrightCallout() {
  return el('div', { class: 'callout', style: 'margin-bottom:28px' },
    el('b', {}, 'About the images. '),
    'The manuscript images are © National Records of Scotland (Crown copyright) and are ' +
    'not republished here. Each page links back to the original on ScotlandsPeople; the ' +
    'transcriptions and translations are the project’s own work.');
}

function renderVolumeCards(volumes) {
  return el('div', { class: 'grid cols-2', style: 'margin-bottom:8px' },
    ...volumes.map((v) => {
      const done = v.transcribed_count || 0;
      const total = v.total_images || 0;
      const pct = total ? Math.round((done / total) * 100) : 0;
      return el('a', { class: 'card volume-card', href: `viewer.html?vol=${encodeURIComponent(v.id)}` },
        el('h2', {}, v.title || v.id),
        el('div', { class: 'meta-line' }, [v.reference, v.period, v.place].filter(Boolean).join(' · ')),
        v.focus_case ? el('div', { class: 'kv' }, el('span', {}, el('b', {}, 'Focus: '), v.focus_case)) : null,
        el('div', { class: 'progress' },
          el('div', { class: 'progress-bar' }, el('span', { style: `width:${pct}%` })),
          el('div', { class: 'progress-label' }, `${done} of ${total} images transcribed · ${pct}%`)),
      );
    }));
}

/* Compact teaser on the overview page — the full page list now lives on its
   own page (contents.html) so the overview can stay focused on the wiki
   (events/people/places/topics). */
function renderContentsLink(index) {
  return el('div', { class: 'section' },
    el('h2', {}, 'Contents', el('span', { class: 'count' }, `${index.pages.length} transcribed`)),
    el('p', { class: 'hint' }, 'Every transcribed opening, grouped by the year its minutes begin.'),
    el('a', { class: 'btn primary', href: `contents.html?vol=${encodeURIComponent(index.id)}` },
      `Browse all ${index.pages.length} transcribed openings →`));
}

function renderContents(index) {
  const sec = el('div', { class: 'section' },
    el('h2', {}, 'Contents', el('span', { class: 'count' }, `${index.pages.length} transcribed`)),
    el('p', { class: 'hint' }, 'Every transcribed opening, grouped by the year its minutes begin. Click to open the side-by-side viewer.'));

  if (!index.pages.length) { sec.append(el('p', { class: 'empty' }, 'Nothing transcribed yet.')); return sec; }

  // Group pages by year using the volume's year_sections boundaries.
  const groups = groupByYear(index.pages, index.year_sections);
  for (const g of groups) {
    const list = el('ul', { class: 'page-list' });
    for (const p of g.pages) list.append(pageRow(index.id, p));
    sec.append(el('div', { class: 'year-group' },
      el('h3', {}, g.year != null ? String(g.year) : 'Undated'),
      list));
  }
  return sec;
}

function groupByYear(pages, yearSections) {
  // Prefer each page's own `year`; fall back to year_sections boundaries.
  const boundaries = Object.entries(yearSections || {})
    .map(([y, n]) => ({ year: parseInt(y, 10), start: n }))
    .sort((a, b) => a.start - b.start);
  const yearFor = (p) => {
    if (p.year != null) return p.year;
    const n = p.image_number;
    let y = null;
    for (const b of boundaries) if (n >= b.start) y = b.year;
    return y;
  };
  const map = new Map();
  for (const p of pages) {
    const y = yearFor(p);
    if (!map.has(y)) map.set(y, []);
    map.get(y).push(p);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] ?? 1e9) - (b[0] ?? 1e9))
    .map(([year, ps]) => ({ year, pages: ps.sort((a, b) => (a.image_number || 0) - (b.image_number || 0)) }));
}

function pageRow(volId, p) {
  const foliosTxt = Array.isArray(p.folios_ref) ? `folios ${p.folios_ref.join('–')}` : '';
  const sub = [foliosTxt, p.sitting_date].filter(Boolean).join(' · ');
  return el('a', { class: 'page-row', href: `viewer.html?vol=${encodeURIComponent(volId)}&img=${encodeURIComponent(p.slug)}` },
    el('span', { class: 'imgno' }, `#${p.image_number ?? '?'}`),
    el('span', { class: 'pt' },
      el('span', { class: 't' }, p.title || p.slug), el('br'),
      sub ? el('span', { class: 's' }, sub) : null),
    el('span', { class: 'side' },
      confBadge(p.confidence) || '',
      statusBadge(p.status) || '',
      p.image_available ? el('span', { class: 'badge plain' }, 'image') : ''),
  );
}

function renderEntityIndex(title, items, kind) {
  const sec = el('div', { class: 'section' },
    el('h2', {}, title, el('span', { class: 'count' }, items && items.length ? `${items.length} distinct` : '')),
    el('p', { class: 'hint' },
      kind === 'topic'
        ? 'Recurring themes across the minutes.'
        : `Named ${title.toLowerCase()} across the minutes — click any name for a consolidated, cross-linked page of every mention.`));
  if (!items || !items.length) { sec.append(el('p', { class: 'empty' }, 'None yet.')); return sec; }
  const chips = el('div', { class: 'chips' });
  const volId = HOME_VOL;
  for (const it of items) {
    const n = it.count > 1 ? el('span', { class: 'n' }, it.count) : null;
    if (kind !== 'topic' && it.slug && volId) {
      chips.append(el('a', {
        class: 'chip link',
        href: `entity.html?vol=${encodeURIComponent(volId)}&kind=${kind}&slug=${encodeURIComponent(it.slug)}`,
      }, cleanEntity(it.name), n));
    } else {
      chips.append(el('span', { class: kind === 'topic' ? 'chip topic' : 'chip' },
        cleanEntity(it.name), n));
    }
  }
  sec.append(chips);
  return sec;
}

let HOME_VOL = null;

/* Front-matter people sometimes carry an inline "# comment"; drop it for display. */
function cleanEntity(name) {
  return String(name).split('#')[0].replace(/\s+/g, ' ').trim();
}

function renderFooter() {
  return el('div', { class: 'footer' },
    'Transcriptions & translations by Claude Opus vision, under human review · ',
    'Manuscript images © National Records of Scotland (Crown copyright), shown via ScotlandsPeople · ',
    'Generated by ', el('code', {}, 'scripts/build_site.py'), '.');
}

/* ------------------------------------------------------------------ viewer */

let VIEWER = { volId: null, index: null, order: [], pos: 0, mode: 'both' };

async function initViewer() {
  const root = $('#viewer');
  const volId = qs('vol');
  if (!volId) {
    // No volume specified — send to the first available volume.
    try {
      const { volumes } = await getJSON('data/volumes.json');
      if (volumes && volumes.length) { location.replace(`viewer.html?vol=${encodeURIComponent(volumes[0].id)}`); return; }
    } catch { /* fall through to error */ }
    root.replaceChildren(el('div', { class: 'callout' }, 'No volume specified.'));
    return;
  }
  try {
    const index = await getJSON(`data/${volId}/index.json`);
    VIEWER.volId = volId;
    VIEWER.index = index;
    VIEWER.order = index.pages.slice().sort((a, b) => (a.image_number || 0) - (b.image_number || 0));
    if (!VIEWER.order.length) {
      root.replaceChildren(el('div', { class: 'callout' }, 'This volume has no transcribed pages yet.'));
      return;
    }
    const wanted = qs('img');
    VIEWER.pos = Math.max(0, VIEWER.order.findIndex((p) => p.slug === wanted));
    if (VIEWER.pos < 0) VIEWER.pos = 0;
    $('#brand-title').textContent = index.title || volId;
    $('#brand-ref').textContent = index.reference || '';
    document.addEventListener('keydown', onKey);
    await loadCurrent();
  } catch (err) {
    root.replaceChildren(el('div', { class: 'callout' },
      el('b', {}, 'Could not load the viewer. '),
      'Run ', el('code', {}, 'python scripts/build_site.py'), ' and open over http. ',
      el('br'), esc(err.message)));
  }
}

function onKey(e) {
  if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (e.key === 'ArrowLeft') go(-1);
  else if (e.key === 'ArrowRight') go(1);
}

function go(delta) {
  const next = VIEWER.pos + delta;
  if (next < 0 || next >= VIEWER.order.length) return;
  VIEWER.pos = next;
  loadCurrent();
}

async function loadCurrent() {
  const meta = VIEWER.order[VIEWER.pos];
  const page = await getJSON(`data/${VIEWER.volId}/pages/${meta.slug}.json`);
  // Reflect the current page in the URL without reloading.
  history.replaceState(null, '', `viewer.html?vol=${encodeURIComponent(VIEWER.volId)}&img=${encodeURIComponent(meta.slug)}`);
  renderViewer(page);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderViewer(page) {
  const root = $('#viewer');
  const hasPrev = VIEWER.pos > 0;
  const hasNext = VIEWER.pos < VIEWER.order.length - 1;

  const select = el('select', { class: 'page-select', onchange: (e) => { VIEWER.pos = +e.target.value; loadCurrent(); } });
  VIEWER.order.forEach((p, i) => select.append(
    el('option', { value: i, selected: i === VIEWER.pos ? 'selected' : null },
      `#${p.image_number ?? '?'} — ${p.title || p.slug}`)));

  const head = el('div', { class: 'viewer-head' },
    el('h1', {}, page.title || page.slug),
    el('div', { class: 'pager' },
      el('button', { class: 'btn', disabled: hasPrev ? null : 'disabled', onclick: () => go(-1) }, '← Prev'),
      select,
      el('button', { class: 'btn', disabled: hasNext ? null : 'disabled', onclick: () => go(1) }, 'Next →')));

  const meta = el('div', { class: 'meta-strip' },
    metaItem('Image', `#${page.image_number ?? '?'}`),
    Array.isArray(page.folios_ref) ? metaItem('Folios', page.folios_ref.join('–')) : null,
    page.sitting_date ? metaItem('Sitting', page.sitting_date) : null,
    page.year ? metaItem('Year', page.year) : null,
    page.languages ? metaItem('Language', page.languages.join(', ')) : null,
    el('span', { class: 'mi' }, statusBadge(page.status) || ''),
    el('span', { class: 'mi' }, confBadge(page.confidence) || ''));

  const split = el('div', { class: 'split' },
    renderImagePane(page),
    renderTxPane(page));

  const notes = page.notes
    ? el('div', { class: 'notes' }, el('details', { class: 'notes-details', open: 'open' },
        el('summary', {}, 'Notes & context'),
        el('div', { class: 'prose', html: renderMarkdown(page.notes) })))
    : null;

  const entities = renderPageEntities(page);

  root.replaceChildren(head, meta, split, notes || document.createComment('no notes'), entities || document.createComment('no entities'), renderFooter());
  ensureLightbox();
}

function metaItem(label, value) {
  return el('span', { class: 'mi' }, el('b', {}, label + ': '), String(value));
}

function renderImagePane(page) {
  const img = page.image || {};
  let body;
  if (img.available && img.href) {
    body = el('div', { class: 'image-frame' },
      el('img', { src: img.href, alt: `Manuscript image ${page.image_number}`, loading: 'lazy',
        onclick: (e) => openLightbox(e.target.src) }));
  } else {
    body = el('div', { class: 'image-frame' }, el('div', { class: 'image-missing' },
      el('div', { class: 'lock' }, '📖'),
      el('div', {}, el('b', {}, 'Open the original manuscript')),
      el('p', {}, `Image ${page.image_number ?? ''} of the volume on ScotlandsPeople. It opens in a new tab — keep it beside this page to read the two side by side. (Sign in to view; free to view once logged in.)`),
      img.source_url
        ? el('a', { class: 'btn primary', href: img.source_url, target: '_blank', rel: 'noopener' }, 'Open on ScotlandsPeople ↗')
        : el('span', { class: 'empty' }, 'source link unavailable')));
  }
  return el('div', { class: 'pane image-pane sticky' },
    el('div', { class: 'pane-head' }, el('span', {}, 'Manuscript'),
      img.available ? el('span', {}, 'click to zoom') : el('span', {}, 'opens in a new tab')),
    el('div', { class: 'pane-body' }, body));
}

function renderTxPane(page) {
  const seg = el('div', { class: 'segmented' },
    modeBtn('Diplomatic', 'diplomatic'),
    modeBtn('Modern', 'modern'),
    modeBtn('Both', 'both'));

  const blocks = el('div', {});
  for (const f of page.folios || []) blocks.append(renderFolio(f));
  if (!(page.folios || []).length) blocks.append(el('p', { class: 'empty' }, 'No transcription parsed for this page.'));

  return el('div', { class: 'pane' },
    el('div', { class: 'pane-head' }, el('span', {}, 'Transcription & translation'), seg),
    el('div', { class: 'pane-body' }, blocks));
}

function modeBtn(label, mode) {
  return el('button', { class: VIEWER.mode === mode ? 'active' : '', onclick: () => setMode(mode) }, label);
}

function setMode(mode) {
  VIEWER.mode = mode;
  // Re-render just the current page to apply the mode.
  const meta = VIEWER.order[VIEWER.pos];
  getJSON(`data/${VIEWER.volId}/pages/${meta.slug}.json`).then(renderViewer);
}

function renderFolio(f) {
  const showDip = VIEWER.mode !== 'modern';
  const showMod = VIEWER.mode !== 'diplomatic';
  return el('div', { class: 'folio-block' },
    el('h3', { class: 'folio-title' }, f.label || 'Folio', confBadge(f.confidence) || ''),
    f.intro ? el('div', { class: 'folio-intro' }, f.intro) : null,
    showDip && f.diplomatic ? el('div', {},
      el('div', { class: 'tx-label' }, 'Diplomatic'),
      el('div', { class: 'diplomatic', html: markEditorial(f.diplomatic) })) : null,
    showMod && f.modern ? el('div', {},
      el('div', { class: 'tx-label' }, 'Modern English'),
      el('div', { class: 'modern', html: renderMarkdown(f.modern) })) : null,
  );
}

function renderPageEntities(page) {
  const rows = [];
  const add = (label, items) => {
    if (!items || !items.length) return;
    rows.push(el('div', {},
      el('div', { class: 'lbl' }, label),
      el('div', { class: 'chips' }, ...items.map((it) =>
        el('span', { class: label === 'Topics' ? 'chip topic' : 'chip' }, cleanEntity(it))))));
  };
  add('People', page.people);
  add('Places', page.places);
  add('Money', page.money);
  add('Topics', page.topics);
  if (!rows.length) return null;
  return el('div', { class: 'entity-row' }, ...rows);
}

/* lightbox */
function ensureLightbox() {
  if ($('#lightbox')) return;
  const lb = el('div', { class: 'lightbox', id: 'lightbox', onclick: () => lb.classList.remove('open') },
    el('img', { src: '', alt: 'manuscript image, enlarged' }));
  document.body.append(lb);
}
function openLightbox(src) {
  const lb = $('#lightbox');
  if (!lb) return;
  $('img', lb).src = src;
  lb.classList.add('open');
}

/* ------------------------------------------------------------------ entity */

async function initEntity() {
  const root = $('#entity');
  const volId = qs('vol');
  const kind = qs('kind');            // 'person' | 'place'
  const slug = qs('slug');
  if (!volId || !kind || !slug) {
    root.replaceChildren(el('p', { class: 'empty' }, 'No entity specified.'));
    return;
  }
  try {
    const e = await getJSON(`data/${volId}/entities/${kind}/${slug}.json`);
    document.title = `${e.name} — Stranraer Presbytery Archive`;
    root.replaceChildren(renderEntity(volId, e));
  } catch (err) {
    root.replaceChildren(el('div', { class: 'callout' },
      el('b', {}, 'Could not load this entity. '), err.message));
  }
}

function entityChip(volId, r) {
  const n = r.count > 1 ? el('span', { class: 'n' }, r.count) : null;
  if (r.slug && r.kind) {
    return el('a', { class: 'chip link',
      href: `entity.html?vol=${encodeURIComponent(volId)}&kind=${r.kind}&slug=${encodeURIComponent(r.slug)}` },
      cleanEntity(r.name), n);
  }
  return el('span', { class: 'chip' }, cleanEntity(r.name), n);
}

const KIND_LABEL = { person: 'Person', place: 'Place', event: 'Event / controversy' };

function renderEntity(volId, e) {
  const kindLabel = KIND_LABEL[e.kind] || 'Entity';
  const head = el('div', { class: 'entity-head' },
    el('div', { class: 'crumbs' },
      el('a', { href: 'index.html' }, '← Overview'),
      el('span', {}, ' · '),
      el('span', {}, `${kindLabel} · ${e.count} opening${e.count === 1 ? '' : 's'}`)),
    el('h1', {}, e.name));

  // Variant spellings actually seen in the record.
  const variants = (e.variants || []).filter((v) => cleanEntity(v) !== e.name);
  const variantLine = variants.length
    ? el('p', { class: 'variants' }, el('span', { class: 'lbl' }, 'Also written: '),
        variants.map(cleanEntity).join(' · '))
    : null;

  // Stage 3b: LLM-synthesized narrative, if one has been written for this
  // entity (data/<vol>/wiki/<kind>/<slug>.md) — resolve its entity:/img_NNNN
  // links to real hrefs, then render as markdown, same renderer as page notes.
  const narrative = e.narrative
    ? el('div', { class: 'narrative prose', html: renderMarkdown(resolveWikiLinks(e.narrative, volId)) })
    : null;

  // Mentions — each links into the side-by-side viewer at that opening.
  const mentionRows = (e.mentions || []).map((m) => {
    const foliosTxt = Array.isArray(m.folios_ref) ? `folios ${m.folios_ref.join('–')}` : '';
    const sub = [foliosTxt, m.sitting_date].filter(Boolean).join(' · ');
    return el('a', { class: 'page-row',
      href: `viewer.html?vol=${encodeURIComponent(volId)}&img=${encodeURIComponent(m.slug)}` },
      el('span', { class: 'imgno' }, `#${m.image_number ?? '?'}`),
      el('span', { class: 'pt' },
        el('span', { class: 't' }, m.title || m.slug), el('br'),
        sub ? el('span', { class: 's' }, sub) : null));
  });

  const section = (title, kids) => kids && kids.length
    ? el('div', { class: 'section' }, el('h2', {}, title), ...kids) : null;

  const relatedChips = (label, items) => (items && items.length)
    ? el('div', { class: 'rel-block' }, el('div', { class: 'lbl' }, label),
        el('div', { class: 'chips' }, ...items.map((r) => entityChip(volId, r))))
    : null;

  const related = [
    relatedChips('People', e.related_people),
    relatedChips('Places', e.related_places),
    relatedChips('Events', e.related_events),
    relatedChips('Topics', (e.topics || []).map((t) => ({ ...t, slug: null }))),
  ].filter(Boolean);

  return el('div', { class: 'entity-page' },
    head,
    variantLine,
    narrative || el('p', { class: 'hint' },
      'Consolidated from the transcribed openings below — an evidence index of every ',
      'appearance of this ', e.kind, ', with links to the manuscript opening. No written ',
      'narrative has been synthesized for this entity yet.'),
    section(`Mentions (${mentionRows.length})`, mentionRows),
    section('Appears alongside', related),
    renderFooter());
}

/* ---------------------------------------------------------------- contents */

async function initContents() {
  const root = $('#contents');
  try {
    const { volumes } = await getJSON('data/volumes.json');
    const volId = qs('vol') || (volumes && volumes[0] && volumes[0].id);
    if (!volId) { root.replaceChildren(el('p', { class: 'empty' }, 'No volume available.')); return; }
    const index = await getJSON(`data/${volId}/index.json`);
    root.replaceChildren(
      el('div', { class: 'hero' },
        el('div', { class: 'eyebrow' }, 'ScotlandsPeople Virtual Volume · ' + (index.reference || '')),
        el('h1', {}, index.title || index.id)),
      renderContents(index),
      renderFooter(),
    );
  } catch (err) {
    root.replaceChildren(el('div', { class: 'callout' },
      el('b', {}, 'Could not load site data. '),
      'Did you run ', el('code', {}, 'python scripts/build_site.py'),
      ' and open this over http (not file://)? ', el('br'), err.message));
  }
}

/* ---------------------------------------------------------------- glossary */

async function initGlossary() {
  const root = $('#glossary');
  try {
    const { volumes } = await getJSON('data/volumes.json');
    const volId = qs('vol') || (volumes && volumes[0] && volumes[0].id);
    if (!volId) { root.replaceChildren(el('p', { class: 'empty' }, 'No volume available.')); return; }
    const g = await getJSON(`data/${volId}/glossary.json`);
    root.replaceChildren(renderGlossary(g));
  } catch (err) {
    root.replaceChildren(el('div', { class: 'callout' },
      el('b', {}, 'No glossary yet. '),
      'Add ', el('code', {}, 'data/<volume>/glossary.md'), ' and rebuild. ', el('br'), err.message));
  }
}

function renderGlossary(g) {
  const head = el('div', { class: 'hero' },
    el('div', { class: 'eyebrow' }, 'Glossary'),
    el('h1', {}, g.title || 'Terms'),
    el('p', { class: 'sub' }, `${g.terms.length} term${g.terms.length === 1 ? '' : 's'} — Scots, Latin, and ecclesiastical-procedural vocabulary recurring across the minutes.`));
  const list = el('div', { class: 'glossary-list' },
    ...g.terms.map((t) => el('div', { class: 'glossary-term', id: t.slug },
      el('h3', {}, t.term),
      el('div', { class: 'prose', html: renderMarkdown(t.definition) }))));
  return el('div', {}, head, list, renderFooter());
}

/* --------------------------------------------------------------- dispatch */

document.addEventListener('DOMContentLoaded', () => {
  if ($('#home')) initHome();
  else if ($('#viewer')) initViewer();
  else if ($('#entity')) initEntity();
  else if ($('#glossary')) initGlossary();
  else if ($('#contents')) initContents();
});
