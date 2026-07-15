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
    .replace(/\[([^\]]+)\]\(((?:https?:|entity\.html|viewer\.html|#)[^)]+)\)/g,
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
      el('div', { class: 'prose', html: renderMarkdown(resolveWikiLinks(t.definition, g.volume)) }))));
  return el('div', {}, head, list, renderFooter());
}

/* -------------------------------------------------------------------- map */

/* Schematic cartography of the Presbytery of Stranraer (the Rhins of
   Galloway) + the Glenluce charges and neighbouring Wigtown. Coordinates are
   hand-placed in the SVG's 640x840 space from the parishes' real relative
   positions — this is presentation geography, deliberately kept out of the
   record-data pipeline. `slug` joins each parish to its place-entity page and
   mention count (from index.json). `kind`: 'rhins' = a parish of this
   presbytery; 'neighbour' = context. */
const MAP_GEO = {
  viewBox: '0 0 640 840',
  parishes: [
    { name: 'New Luce',    slug: 'new-kirk-of-glenluce', x: 360, y: 165, kind: 'rhins' },
    { name: 'Kirkcolm',    slug: 'kirkcolm',   x: 150, y: 150, kind: 'rhins' },
    { name: 'Leswalt',     slug: 'leswalt',    x: 150, y: 268, kind: 'rhins' },
    { name: 'Inch',        slug: 'inch',       x: 246, y: 258, kind: 'rhins' },
    { name: 'Stranraer',   slug: 'stranraer',  x: 205, y: 322, kind: 'rhins' },
    { name: 'Portpatrick', slug: 'portpatrick',x: 104, y: 398, kind: 'rhins' },
    { name: 'Portmontgomery', slug: 'portmontgomery', x: 96, y: 470, kind: 'rhins' },
    { name: 'Stoneykirk',  slug: 'stoneykirk', x: 196, y: 500, kind: 'rhins' },
    { name: 'Kirkmaiden',  slug: 'kirkmaiden', x: 214, y: 726, kind: 'rhins' },
    { name: 'Glenluce',    slug: 'glenluce',   x: 336, y: 372, kind: 'rhins' },
    { name: 'Wigtown',     slug: 'wigtown',    x: 542, y: 356, kind: 'neighbour' },
  ],
  // Stylized landmass + sea inlets, drawn tonally (no bright blue) for an
  // engraved-map feel. Loch Ryan bites in from the north; Luce Bay from the SE.
  land: 'M104 96 C150 70 210 74 250 92 C300 74 360 84 402 104 '
      + 'C470 120 560 150 596 210 C612 300 590 372 560 392 '
      + 'C470 400 470 470 452 520 C300 560 264 640 236 760 '
      + 'C226 800 196 800 186 762 C150 640 176 560 150 520 '
      + 'C118 470 96 470 92 420 C76 340 70 250 78 180 C84 140 92 112 104 96 Z',
  lochRyan: 'M196 96 C214 160 226 250 214 320 C210 344 176 344 172 320 '
          + 'C160 250 150 160 158 100 C168 80 190 80 196 96 Z',
  luceBay: 'M470 470 C440 560 360 620 300 660 C420 620 470 540 500 470 '
         + 'C512 440 482 440 470 470 Z',
};

async function initMap() {
  const root = $('#map');
  try {
    const { volumes } = await getJSON('data/volumes.json');
    const volId = qs('vol') || (volumes && volumes[0] && volumes[0].id);
    if (!volId) { root.replaceChildren(el('p', { class: 'empty' }, 'No volume available.')); return; }
    const index = await getJSON(`data/${volId}/index.json`);
    root.replaceChildren(renderMap(volId, index));
  } catch (err) {
    root.replaceChildren(el('div', { class: 'callout' },
      el('b', {}, 'Could not load the map. '),
      'Run ', el('code', {}, 'python scripts/build_site.py'), ' and open over http. ',
      el('br'), esc(err.message)));
  }
}

function renderMap(volId, index) {
  const counts = {};
  for (const p of index.places || []) counts[p.slug] = p.count;
  const geo = MAP_GEO;
  const rhins = geo.parishes.filter((p) => counts[p.slug] || p.kind === 'rhins');
  const maxCount = Math.max(1, ...rhins.map((p) => counts[p.slug] || 0));
  const rFor = (c) => 7 + Math.sqrt(c || 0) / Math.sqrt(maxCount) * 23;
  const opFor = (c) => 0.28 + 0.62 * ((c || 0) / maxCount);

  // Build the SVG as a string (createElementNS avoided; one innerHTML set).
  const markers = geo.parishes.map((p) => {
    const c = counts[p.slug] || 0;
    const r = rFor(c);
    const neigh = p.kind === 'neighbour';
    const fill = neigh ? 'var(--ink-faint)' : 'var(--accent)';
    const href = `entity.html?vol=${encodeURIComponent(volId)}&kind=place&slug=${encodeURIComponent(p.slug)}`;
    const labelDy = -(r + 7);
    return `<a href="${href}" class="map-parish" aria-label="${esc(p.name)}, ${c} openings">
      <circle cx="${p.x}" cy="${p.y}" r="${r.toFixed(1)}" fill="${fill}" fill-opacity="${opFor(c).toFixed(2)}"
        stroke="${fill}" stroke-width="1.4"></circle>
      <circle cx="${p.x}" cy="${p.y}" r="2.4" fill="${fill}"></circle>
      <text x="${p.x}" y="${p.y + labelDy}" text-anchor="middle" class="map-label${neigh ? ' neigh' : ''}">${esc(p.name)}</text>
      <text x="${p.x}" y="${p.y + labelDy + 14}" text-anchor="middle" class="map-count">${c || '—'}</text>
    </a>`;
  }).join('');

  const svg = `<svg viewBox="${geo.viewBox}" class="map-svg" role="img" aria-label="Map of the parishes of the Presbytery of Stranraer">
    <rect x="0" y="0" width="640" height="840" fill="var(--map-sea)"></rect>
    <path d="${geo.land}" fill="var(--map-land)" stroke="var(--map-coast)" stroke-width="2"></path>
    <path d="${geo.lochRyan}" fill="var(--map-sea)" stroke="var(--map-coast)" stroke-width="1.2"></path>
    <path d="${geo.luceBay}" fill="var(--map-sea)" stroke="var(--map-coast)" stroke-width="1.2"></path>
    <text x="176" y="210" class="map-water" transform="rotate(78 176 210)">Loch Ryan</text>
    <text x="392" y="600" class="map-water">Luce Bay</text>
    <text x="70" y="330" class="map-water" transform="rotate(-90 70 330)">Irish Sea</text>
    <text x="596" y="470" class="map-water" text-anchor="end">the Machars →</text>
    ${markers}
  </svg>`;

  const head = el('div', { class: 'hero' },
    el('div', { class: 'eyebrow' }, 'Map · the Rhins of Galloway'),
    el('h1', {}, 'The bounds of the presbytery'),
    el('p', { class: 'sub' },
      'The nine parishes of the Presbytery of Stranraer — the Rhins peninsula and the ' +
      'Glenluce charges to the east — with neighbouring Wigtown for context. Each marker ' +
      'is sized and shaded by how many openings name that place; click one to open its ' +
      'consolidated page. Positions are schematic.'));

  const wrap = el('div', { class: 'map-wrap' });
  wrap.innerHTML = svg;

  const legend = el('div', { class: 'map-legend' },
    el('span', { class: 'lbl' }, 'Marker size = openings that name the place'),
    el('div', { class: 'chips' },
      ...index.places.filter((p) => MAP_GEO.parishes.some((g) => g.slug === p.slug))
        .sort((a, b) => b.count - a.count)
        .map((p) => el('a', { class: 'chip link',
          href: `entity.html?vol=${encodeURIComponent(volId)}&kind=place&slug=${encodeURIComponent(p.slug)}` },
          cleanEntity(p.name), el('span', { class: 'n' }, p.count)))));

  return el('div', {}, head, el('div', { class: 'card map-card' }, wrap), legend, renderFooter());
}

/* --------------------------------------------------------------- timeline */

/* National / covenanting-era events, dated to the month, for the timeline's
   upper track. Presentation context (not record data). `event` links a flag
   to a wiki event page where the volume documents the local reaction. */
const NATIONAL_EVENTS = [
  { t: 1643.67, label: 'Solemn League and Covenant', note: 'Scotland allies with the English Parliament' },
  { t: 1645.67, label: 'Philiphaugh', note: 'Montrose’s royalists routed; thanksgiving kept in the bounds' },
  { t: 1646.33, label: 'Charles I surrenders to the Scots' },
  { t: 1647.92, label: 'The Engagement', note: 'secret treaty to invade England for the King',
    event: 'the-post-engagement-purge-of-malignants' },
  { t: 1648.58, label: 'Preston', note: 'the Engager army destroyed' },
  { t: 1648.83, label: 'Covenant renewed', note: 'Solemn Acknowledgment; the purge of compliers',
    event: 'the-renewal-of-the-covenant-1648-1649' },
  { t: 1649.05, label: 'Charles I executed', note: '30 Jan 1649; the Act of Classes follows' },
  { t: 1650.67, label: 'Dunbar', note: 'Cromwell shatters the Scots army (3 Sep 1650)',
    event: 'the-dunbar-prisoners-relief' },
  { t: 1651.45, label: 'The Public Resolutions', note: 'readmitting malignants splits the Kirk',
    event: 'the-resolutioner-protester-schism' },
  { t: 1651.67, label: 'Worcester', note: 'the last Scots royalist army defeated' },
  { t: 1652.12, label: 'The Tender of Union', note: 'England moves to absorb Scotland',
    event: 'the-cromwellian-conquest-and-the-tender-of-union' },
];

const T_MIN = 1640.7, T_MAX = 1652.6;
const tx = (t) => ((t - T_MIN) / (T_MAX - T_MIN)) * 100;

async function initTimeline() {
  const root = $('#timeline');
  try {
    const { volumes } = await getJSON('data/volumes.json');
    const volId = qs('vol') || (volumes && volumes[0] && volumes[0].id);
    if (!volId) { root.replaceChildren(el('p', { class: 'empty' }, 'No volume available.')); return; }
    const index = await getJSON(`data/${volId}/index.json`);
    root.replaceChildren(renderTimeline(volId, index));
  } catch (err) {
    root.replaceChildren(el('div', { class: 'callout' },
      el('b', {}, 'Could not load the timeline. '), esc(err.message)));
  }
}

function renderTimeline(volId, index) {
  // Volume "pulse": openings per year (page.year, falling back to year_sections).
  const groups = groupByYear(index.pages, index.year_sections)
    .filter((g) => g.year != null);
  const maxYear = Math.max(1, ...groups.map((g) => g.pages.length));
  const firstSlugForYear = (g) => g.pages[0] && g.pages[0].slug;

  const axis = el('div', { class: 'tl-axis' });
  // year gridlines + labels
  for (let y = 1641; y <= 1652; y++) {
    axis.append(el('div', { class: 'tl-year', style: `left:${tx(y)}%` },
      el('span', { class: 'tl-year-tick' }),
      el('span', { class: 'tl-year-lbl' }, String(y))));
  }

  // volume pulse: a bar per year under the axis
  const pulse = el('div', { class: 'tl-pulse' });
  for (const g of groups) {
    const h = 10 + Math.round((g.pages.length / maxYear) * 92);
    const left = tx(g.year), width = tx(g.year + 1) - tx(g.year);
    pulse.append(el('a', {
      class: 'tl-bar',
      href: `viewer.html?vol=${encodeURIComponent(volId)}&img=${encodeURIComponent(firstSlugForYear(g))}`,
      style: `left:${left}%; width:calc(${width}% - 4px); height:${h}px`,
      title: `${g.year}: ${g.pages.length} opening${g.pages.length === 1 ? '' : 's'}`,
    }, el('span', { class: 'tl-bar-n' }, g.pages.length)));
  }

  // national flags above the axis, staggered across 3 tiers to avoid overlap
  const flags = el('div', { class: 'tl-flags' });
  NATIONAL_EVENTS.forEach((n, i) => {
    const tier = i % 3;
    const href = n.event ? `entity.html?vol=${encodeURIComponent(volId)}&kind=event&slug=${n.event}` : null;
    const card = el(href ? 'a' : 'div', {
      class: `tl-flag tier-${tier}${href ? ' link' : ''}`,
      style: `left:${tx(n.t)}%`,
      href,
    },
      el('span', { class: 'tl-flag-dot' }),
      el('span', { class: 'tl-flag-stem' }),
      el('span', { class: 'tl-flag-card' },
        el('b', {}, n.label),
        n.note ? el('span', { class: 'tl-flag-note' }, n.note) : null,
        n.event ? el('span', { class: 'tl-flag-go' }, 'see how the presbytery reacted →') : null));
    flags.append(card);
  });

  const chart = el('div', { class: 'tl-chart' }, flags, axis, pulse);

  const head = el('div', { class: 'hero' },
    el('div', { class: 'eyebrow' }, 'Timeline · 1641–1652'),
    el('h1', {}, 'The record against the national storm'),
    el('p', { class: 'sub' },
      'The lower bars are the pulse of the presbytery — how many openings survive from each ' +
      'year. Above the line are the national convulsions of the covenanting revolution. ' +
      'The record visibly thickens as the crisis arrives: the purge of 1648–49, the ruin ' +
      'after Dunbar, and the schism of the final years. Flags with an arrow link to the ' +
      'presbytery’s own response.'));

  const legend = el('p', { class: 'hint', style: 'margin-top:18px' },
    'Bars link to the first opening of that year in the viewer; national flags with an arrow ' +
    'open the matching event page. Positions are to scale by date.');

  return el('div', {}, head, el('div', { class: 'card tl-card' }, chart), legend, renderFooter());
}

/* ---------------------------------------------------------------- charts */

const PALETTE = ['#7a2e2e', '#9a7b32', '#3f7d4f', '#4a6a85', '#845a8a',
                 '#a85b4a', '#5c8a86', '#8a7a4a', '#b3801f', '#607d8b'];

/* First-match partition of every topic-mention into one thematic bucket, so
   the bars are a true distribution of what the court spent its time on. Order
   matters (a topic lands in the first bucket it matches). */
const WORK_CATEGORIES = [
  { key: 'Moral discipline', match: ['fornicat', 'adulter', 'incest', 'bigamy', 'paternit',
      'uncleann', 'cohabit', 'sabbath', 'drunken', 'alehouse', 'dicing', 'carding', 'slander',
      'calumny', 'defam', 'lying', 'witch', 'charming', 'riddle', 'divination', 'superstit',
      'scandal', 'repentance', 'sackcloth', 'satisfaction', 'purgation', 'penance', 'discipline',
      'excommunicat', 'contumacy', 'compurgation', 'usury', 'annualrent', 'clandestine', 'marriage'] },
  { key: 'Malignancy & the wars', match: ['malignan', 'engagement', 'covenant', 'protest',
      'resolution', 'union', 'levy', 'mobilis', 'committee-of-war', 'committee of war', 'western-assoc',
      'army', 'soldier', 'regiment', 'muster', 'quartering', 'montrose', 'seaforth', 'combat', 'duel',
      'assault', 'robbery', 'oppression', 'sedition', 'act of classes', 'act-of-classes', 'dunbar', 'cromwell'] },
  { key: 'Planting & kirk fabric', match: ['plant', 'admission', 'ordination', 'call', 'glebe',
      'manse', 'stipend', 'teind', 'mortification', 'kirk-repair', 'kirk fabric', 'kirk-fabric',
      'reparation', 'kirk-build', 'bridge', 'annexation', 'division', 'boundary', 'perambulation',
      'presentation', 'patronage', 'vacancy', 'transportation'] },
  { key: 'Poor, widows & orphans', match: ['poor', 'widow', 'orphan', 'refugee', 'charity',
      'contribution', 'collection', 'relief', 'beggar'] },
  { key: 'Ministry & examination', match: ['exercise', 'common-head', 'common head', 'privy-trial',
      'privy trial', 'visitation', 'testimonial', 'testificat', 'trial', 'probation', 'catech',
      'family-worship', 'family worship', 'doctrine', 'privy-censure', 'schoolmaster', 'schooling', 'school'] },
  { key: 'Courts & correspondence', match: ['correspond', 'ireland', 'ulster', 'dublin', 'synod',
      'general-assembly', 'general assembly', 'commission', 'supplication', 'appeal', 'appellation',
      'parliament', 'wigton', 'wigtown', 'letter', 'referral', 'remit', 'edinburgh'] },
  { key: 'Court procedure', match: ['moderator', 'clerk', 'register', 'sederunt', 'election',
      'office-rotation', 'office rotation', 'summons', 'citation', 'cited', 'process', 'libel',
      'witness', 'deposition', 'oath', 'session-book', 'session book', 'act ', 'legal', 'due-process'] },
];

const SIN_CATEGORIES = [
  { key: 'Sexual (fornication, adultery, incest)', color: 0, match: ['fornicat', 'adulter', 'incest', 'bigamy', 'paternit', 'uncleann', 'cohabit', 'clandestine'] },
  { key: 'Slander & seditious speech', color: 3, match: ['slander', 'calumny', 'defam', 'lying', 'sedition', 'contempt'] },
  { key: 'Violence (duel, combat, assault)', color: 5, match: ['duel', 'combat', 'assault', 'robbery', 'oppression', 'barn-breaking', 'tumult'] },
  { key: 'Sabbath & drink', color: 2, match: ['sabbath', 'drunken', 'alehouse', 'dicing', 'carding'] },
  { key: 'Witchcraft & superstition', color: 4, match: ['witch', 'charming', 'riddle', 'divination', 'superstit', 'sieve'] },
  { key: 'Usury & the moral economy', color: 8, match: ['usury', 'annualrent', 'engross'] },
];

function partition(topics, categories) {
  const totals = categories.map((c) => ({ ...c, count: 0, topics: 0 }));
  let uncategorized = 0, uncatTopics = 0;
  for (const t of topics) {
    const name = String(t.name).toLowerCase();
    const idx = categories.findIndex((c) => c.match.some((m) => name.includes(m)));
    if (idx >= 0) { totals[idx].count += t.count; totals[idx].topics += 1; }
    else { uncategorized += t.count; uncatTopics += 1; }
  }
  return { totals, uncategorized, uncatTopics };
}

async function initCharts() {
  const root = $('#charts');
  try {
    const { volumes } = await getJSON('data/volumes.json');
    const volId = qs('vol') || (volumes && volumes[0] && volumes[0].id);
    if (!volId) { root.replaceChildren(el('p', { class: 'empty' }, 'No volume available.')); return; }
    const index = await getJSON(`data/${volId}/index.json`);
    let graph = null;
    try { graph = await getJSON(`data/${volId}/graph.json`); } catch { /* optional */ }
    root.replaceChildren(renderCharts(volId, index, graph));
  } catch (err) {
    root.replaceChildren(el('div', { class: 'callout' },
      el('b', {}, 'Could not load the charts. '), esc(err.message)));
  }
}

function barChart(title, hint, rows, opts = {}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const sec = el('div', { class: 'section chart-block' },
    el('h2', {}, title),
    hint ? el('p', { class: 'hint' }, hint) : null);
  const list = el('div', { class: 'bars' });
  rows.forEach((r, i) => {
    const pct = (r.count / max) * 100;
    const color = opts.color != null ? PALETTE[opts.color] : PALETTE[(r.color != null ? r.color : i) % PALETTE.length];
    list.append(el('div', { class: 'bar-row' },
      el('div', { class: 'bar-label', title: r.key }, r.key),
      el('div', { class: 'bar-track' },
        el('div', { class: 'bar-fill', style: `width:${pct}%; background:${color}` })),
      el('div', { class: 'bar-val' }, String(r.count))));
  });
  sec.append(list);
  return sec;
}

function renderCharts(volId, index, graph) {
  const topics = index.topics || [];
  const totalMentions = topics.reduce((s, t) => s + t.count, 0);

  const work = partition(topics, WORK_CATEGORIES);
  const workRows = work.totals.map((t) => ({ key: t.key, count: t.count }))
    .sort((a, b) => b.count - a.count);
  workRows.push({ key: 'Other / miscellaneous', count: work.uncategorized });

  const sin = partition(topics, SIN_CATEGORIES);
  const sinRows = sin.totals.map((t) => ({ key: t.key, count: t.count, color: t.color }))
    .sort((a, b) => b.count - a.count);

  const head = el('div', { class: 'hero' },
    el('div', { class: 'eyebrow' }, 'Charts & networks'),
    el('h1', {}, 'The shape of eleven years'),
    el('p', { class: 'sub' },
      'What did a Scottish presbytery actually spend its time on? These charts count every ' +
      'theme tagged across the ' + index.transcribed_count + ' transcribed openings — ' +
      totalMentions.toLocaleString() + ' topic-mentions in all — and the network below maps ' +
      'who appears alongside whom.'));

  const c1 = barChart('The work of the court',
    'Every topic-mention sorted into one thematic bucket — a rough map of where the court’s ' +
    'attention went. Discipline of morals and the business of the wars dominate.',
    workRows);

  const c2 = barChart('The discipline of sin',
    'Within moral discipline, the kinds of sin brought before the presbytery. Sexual discipline ' +
    'is far and away the largest category — the parish sessions sent up their hardest cases.',
    sinRows);

  const net = graph ? renderNetwork(volId, graph) : null;

  return el('div', {}, head, c1, c2, net || document.createComment('no graph'), renderFooter());
}

function renderNetwork(volId, graph) {
  const nodes = graph.nodes.slice();
  // Cluster colour by dominant event; order nodes around the ring by cluster
  // then by count so co-occurring people sit together and chords stay short.
  const events = [...new Set(nodes.map((n) => n.event).filter(Boolean))];
  const colorOf = (ev) => ev == null ? '#8a8377' : PALETTE[events.indexOf(ev) % PALETTE.length];
  nodes.sort((a, b) => {
    const ea = a.event || '~', eb = b.event || '~';
    if (ea !== eb) return ea < eb ? -1 : 1;
    return b.count - a.count;
  });

  const cx = 470, cy = 430, R = 250;
  const pos = {};
  const N = nodes.length;
  nodes.forEach((n, i) => {
    const ang = (i / N) * Math.PI * 2 - Math.PI / 2;
    pos[n.slug] = { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang), ang };
  });
  const maxCount = Math.max(...nodes.map((n) => n.count));
  const rFor = (c) => 4 + Math.sqrt(c / maxCount) * 11;
  const maxW = Math.max(...graph.edges.map((e) => e.w));

  // edges as chords bowed toward the centre
  const edgeSvg = graph.edges.map((e) => {
    const a = pos[e.a], b = pos[e.b];
    if (!a || !b) return '';
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const ctrlX = cx + (mx - cx) * 0.3, ctrlY = cy + (my - cy) * 0.3;
    const op = (0.05 + 0.5 * Math.sqrt(e.w / maxW)).toFixed(3);
    return `<path class="net-edge" data-a="${e.a}" data-b="${e.b}" d="M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${ctrlX.toFixed(1)} ${ctrlY.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}" fill="none" stroke="var(--ink-faint)" stroke-opacity="${op}" stroke-width="${(0.4 + 1.8 * (e.w / maxW)).toFixed(2)}"></path>`;
  }).join('');

  const nodeSvg = nodes.map((n) => {
    const p = pos[n.slug];
    const r = rFor(n.count);
    const left = Math.cos(p.ang) < 0;
    const lx = p.x + Math.cos(p.ang) * (r + 6);
    const ly = p.y + Math.sin(p.ang) * (r + 6);
    const deg = p.ang * 180 / Math.PI + (left ? 180 : 0);
    const nm = cleanEntity(n.name);
    const label = nm.length > 20 ? nm.slice(0, 19) + '…' : nm;
    const href = `entity.html?vol=${encodeURIComponent(volId)}&kind=person&slug=${encodeURIComponent(n.slug)}`;
    return `<a href="${href}" class="net-node" data-slug="${n.slug}">
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${colorOf(n.event)}" stroke="var(--bg-panel)" stroke-width="1.2"></circle>
      <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="net-label" text-anchor="${left ? 'end' : 'start'}" transform="rotate(${deg.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})">${esc(label)}</text>
    </a>`;
  }).join('');

  const svg = `<svg viewBox="0 0 940 900" class="net-svg" role="img" aria-label="Co-occurrence network of the most-named people">
    <g class="net-edges">${edgeSvg}</g>
    <g class="net-nodes">${nodeSvg}</g>
  </svg>`;

  const legend = el('div', { class: 'net-legend chips' },
    ...events.map((ev, i) => el('span', { class: 'chip' },
      el('span', { class: 'net-swatch', style: `background:${PALETTE[i % PALETTE.length]}` }), shortEvent(ev))));

  const sec = el('div', { class: 'section' },
    el('h2', {}, 'Who appears with whom'),
    el('p', { class: 'hint' },
      'The 40 most-named people, placed on a ring and grouped by the controversy each is most ' +
      'entangled in; a chord joins two people for every opening that names them both (heavier = ' +
      'more often). Hover a name to isolate its ties; click to open the person. The dense core is ' +
      'the ministers, who sat together at every meeting.'));
  const wrap = el('div', { class: 'card net-card' });
  wrap.innerHTML = svg;
  sec.append(wrap, legend);

  // hover isolation — attach synchronously (the nodes already exist in this
  // detached subtree; listeners persist when it is inserted into the page).
  const svgEl = wrap.querySelector('svg');
  if (svgEl) {
    svgEl.querySelectorAll('.net-node').forEach((node) => {
      const slug = node.getAttribute('data-slug');
      node.addEventListener('mouseenter', () => {
        svgEl.classList.add('isolating');
        svgEl.querySelectorAll('.net-edge').forEach((ed) => {
          const on = ed.getAttribute('data-a') === slug || ed.getAttribute('data-b') === slug;
          ed.classList.toggle('on', on);
        });
        const nbrs = new Set([slug]);
        svgEl.querySelectorAll('.net-edge.on').forEach((ed) => {
          nbrs.add(ed.getAttribute('data-a')); nbrs.add(ed.getAttribute('data-b'));
        });
        svgEl.querySelectorAll('.net-node').forEach((nd) =>
          nd.classList.toggle('dim', !nbrs.has(nd.getAttribute('data-slug'))));
      });
      node.addEventListener('mouseleave', () => {
        svgEl.classList.remove('isolating');
        svgEl.querySelectorAll('.net-edge.on').forEach((ed) => ed.classList.remove('on'));
        svgEl.querySelectorAll('.net-node.dim').forEach((nd) => nd.classList.remove('dim'));
      });
    });
  }

  return sec;
}

function shortEvent(ev) {
  if (!ev) return 'Other';
  return ev.replace(/^The /, '').replace(/:.*$/, '').replace(/\s*\(.*\)$/, '')
           .replace(/’s .*/, '’s case').slice(0, 34);
}

/* --------------------------------------------------------------- dispatch */

document.addEventListener('DOMContentLoaded', () => {
  if ($('#home')) initHome();
  else if ($('#viewer')) initViewer();
  else if ($('#entity')) initEntity();
  else if ($('#glossary')) initGlossary();
  else if ($('#contents')) initContents();
  else if ($('#map')) initMap();
  else if ($('#timeline')) initTimeline();
  else if ($('#charts')) initCharts();
});
