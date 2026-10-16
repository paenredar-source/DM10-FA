// DM10 Ofertas – Netlify Function
// ?action=list                      -> Slugs aller Spieler-Threads
// ?action=threads&slugs=a,b,c       -> letztes Angebot je Thread (max. 12 pro Aufruf)

const BASE = 'https://dynastymode.com';
const FORUM = '2152119';
const FORUM_URL = `${BASE}/${FORUM}-dm10-liga-fa-y-renovaciones/`;
// Threads, die keine Spieler-Threads sind (zusätzlich zu den angepinnten)
const EXCLUDE = /injur|lesionad|jugadores-libres|draft-inicial|mercadillo|movimientos|debate|comentarios/i;
const UA = 'Mozilla/5.0 (compatible; DM10-Ofertas/1.0)';
const MONTHS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };

async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'es' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} bei ${url}`);
  // Forum liefert iso-8859-1
  return new TextDecoder('windows-1252').decode(await r.arrayBuffer());
}

// ---------- Liste ----------
function parseList(html) {
  const re = new RegExp(`/${FORUM}/(\\d+-[a-z0-9_-]+)/`, 'i');
  const out = [];
  const seen = new Set();
  const rows = html.split(/<tr[\s>]/i).slice(1);
  for (const row of rows) {
    const m = row.match(re);
    if (!m) continue;
    const slug = m[1].toLowerCase();
    if (seen.has(slug)) continue;
    seen.add(slug);
    const pinned = /corazon\.gif/i.test(row);
    out.push({ slug, pinned, excluded: pinned || EXCLUDE.test(slug) });
  }
  if (!out.length) {
    const all = new RegExp(`/${FORUM}/(\\d+-[a-z0-9_-]+)/`, 'gi');
    let m;
    while ((m = all.exec(html))) {
      const slug = m[1].toLowerCase();
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push({ slug, pinned: false, excluded: EXCLUDE.test(slug) });
    }
  }
  return out;
}

// ---------- HTML -> Text ----------
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function htmlToText(html) {
  let h = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  h = h.replace(/<a\b[^>]*?href=["']?[^"'>\s]*\/users\/([^\/"'>\s?]+)[^>]*>/gi, (m, u) => {
    let n = u;
    try { n = decodeURIComponent(u); } catch (e) {}
    return ` ⟦U:${n.toLowerCase()}⟧ `;
  });
  h = h.replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|div|tr|td|li|h\d)>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return decodeEntities(h).replace(/\s+/g, ' ').trim();
}

// ---------- Datum ----------
function madridToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(iso, d) {
  const [y, m, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day + d)).toISOString().slice(0, 10);
}
function resolveDate(tok, today) {
  if (/^hoy$/i.test(tok)) return today;
  if (/^ayer$/i.test(tok)) return addDays(today, -1);
  const m = tok.match(/^(\d{1,2})\/(\w{3})\/(\d{4})$/);
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${String(mon).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// ---------- Beiträge ----------
function parsePosts(text, today) {
  const names = {};
  const nameRe = /⟦U:([^⟧]+)⟧\s+([^\s⟦]+)/g;
  let nm;
  while ((nm = nameRe.exec(text))) if (nm[2].toLowerCase() === nm[1]) names[nm[1]] = nm[2];

  const hdr = /Mensajes:\s*[\d.,]+\s*Desde:\s*\d{1,2}\/\w{3}\/\d{4}[\s\S]{0,80}?#(\d+)\s*•\s*(Hoy|Ayer|\d{1,2}\/\w{3}\/\d{4}),?\s*(\d{1,2}:\d{2})/g;
  const heads = [];
  let m;
  while ((m = hdr.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 500), m.index);
    const um = [...before.matchAll(/⟦U:([^⟧]+)⟧/g)].pop();
    heads.push({ start: m.index, end: m.index + m[0].length, post: +m[1], dateTok: m[2], time: m[3], slug: um ? um[1] : '?' });
  }
  const posts = [];
  heads.forEach((h, i) => {
    let region = text.slice(h.end, i + 1 < heads.length ? heads[i + 1].start : text.length);
    region = region.replace(/^\s*•?\s*Editado por\s*⟦U:[^⟧]+⟧\s*\S+/, '');
    const cut = region.search(/⟦U:|\sArriba\s/);
    if (cut >= 0) region = region.slice(0, cut);
    const date = resolveDate(h.dateTok, today);
    posts.push({
      post: h.post,
      user: names[h.slug] || h.slug,
      when: date ? `${date} ${h.time.padStart(5, '0')}` : null,
      text: region.trim()
    });
  });
  return posts;
}

// ---------- Betrag & Team ----------
function normalize(s) {
  return s.replace(/[’´‘`]/g, "'").replace(/(\d)'(\d)/g, '$1.$2').replace(/(\d),(\d)/g, '$1.$2');
}
const AMOUNT = /(\d+(?:\.\d+)?)\s*(?:millones|millón|millon|mill|m)?\s*(?:€|\$)?\s*(?:x|×|\*|\bpor\b)\s*(\d{1,2})(?!\d)/gi;

function parseOffer(raw) {
  const t = normalize(raw);
  let last = null, m;
  AMOUNT.lastIndex = 0;
  while ((m = AMOUNT.exec(t))) {
    const salary = parseFloat(m[1]), years = parseInt(m[2], 10);
    if (salary > 0 && salary <= 60 && years >= 1 && years <= 6) last = { salary, years, index: m.index };
  }
  if (!last) return null;
  let pre = t.slice(0, last.index);
  pre = pre.split(/\b(?:ofrece\w*|ofrezco|ofertamos|oferta\w*|subimos|subo|sube\w*|pujo|pujamos|puja\w*|mejoramos|igualamos)\b/i)[0];
  pre = pre.replace(/\*+/g, '').replace(/^[\s:\-–,;.]+|[\s:\-–,;.]+$/g, '');
  const team = pre.length && pre.length <= 40 ? pre : '';
  return { salary: last.salary, years: last.years, team };
}

// ---------- Thread ----------
function threadName(html, slug) {
  let m = html.match(/og:title["']?\s+content=["']([^"']+)["']/i) || html.match(/content=["']([^"']+)["']\s+(?:property|name)=["']og:title/i);
  if (m) return decodeEntities(m[1]).trim();
  m = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (m) {
    const parts = decodeEntities(m[1]).split(' - ');
    if (parts.length >= 3) return parts[parts.length - 2].trim();
  }
  return slug.replace(/^\d+-/, '').replace(/-/g, ' ');
}

function lastPageUrl(html, slug) {
  const re = new RegExp(`href=["']([^"']*${slug.replace(/[-]/g, '\\-')}[^"']*?[?&](?:pagina|pag|page|pg|p)=(\\d+)[^"']*)["']`, 'gi');
  let best = null, m;
  while ((m = re.exec(html))) {
    const n = +m[2];
    if (!best || n > best.n) best = { n, href: decodeEntities(m[1]) };
  }
  if (!best || best.n <= 1) return null;
  return best.href.startsWith('http') ? best.href : BASE + (best.href.startsWith('/') ? '' : '/') + best.href;
}

async function loadThread(slug) {
  const url = `${BASE}/${FORUM}/${slug}/`;
  const today = madridToday();
  try {
    const html = await get(url);
    const name = threadName(html, slug);
    let posts = parsePosts(htmlToText(html), today);
    const lp = lastPageUrl(html, slug);
    if (lp) posts = parsePosts(htmlToText(await get(lp)), today);
    const replies = posts.filter(p => p.post > 1);
    const maxPost = posts.reduce((a, p) => Math.max(a, p.post), 1);
    let last = null;
    for (let i = replies.length - 1; i >= 0; i--) {
      const p = replies[i], o = parseOffer(p.text);
      if (o) {
        last = {
          user: p.user, when: p.when, post: p.post, salary: o.salary, years: o.years,
          team: o.team, raw: p.text.slice(0, 200), laterPosts: replies.length - 1 - i
        };
        break;
      }
    }
    if (!last && replies.length) {
      const p = replies[replies.length - 1];
      last = { user: p.user, when: p.when, post: p.post, salary: null, years: null, team: '', raw: p.text.slice(0, 200), laterPosts: 0 };
    }
    return { slug, url, name, replies: maxPost - 1, last, parsed: posts.length };
  } catch (e) {
    return { slug, url, name: slug.replace(/^\d+-/, '').replace(/-/g, ' '), replies: 0, last: null, error: e.message };
  }
}

const json = (obj, status = 200) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  body: JSON.stringify(obj)
});

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  try {
    if (q.action === 'list') {
      const items = parseList(await get(FORUM_URL));
      return json({
        threads: items.filter(x => !x.excluded).map(x => x.slug),
        skipped: items.filter(x => x.excluded).map(x => x.slug),
        fetchedAt: new Date().toISOString()
      });
    }
    if (q.action === 'threads') {
      const slugs = (q.slugs || '').split(',').map(s => s.trim()).filter(s => /^\d+-[a-z0-9_-]+$/i.test(s)).slice(0, 12);
      return json({ threads: await Promise.all(slugs.map(loadThread)) });
    }
    return json({ error: 'action fehlt' }, 400);
  } catch (e) {
    return json({ error: e.message }, 502);
  }
};

exports._test = { parseOffer, parsePosts, htmlToText, parseList, resolveDate };
