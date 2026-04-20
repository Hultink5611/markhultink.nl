// Main Cloudflare Worker — serveert de statische site via ASSETS binding
// en handelt /api/prince/scores af voor het Prins-game scoreboard.
//
// Verwacht (optioneel) een KV binding genaamd `worker_prince` voor globale scores.
// Zonder binding geeft GET een lege state terug en POST een 503.

const HALL_MAX = 6;
const FALLEN_MAX = 200;
const NAME_MAX = 10;

const defaultState = () => ({ hall: [], fallen: [], clears: 0 });

function isValidLetter(l) {
  return l && typeof l.c === 'string' && l.c.length === 1
    && Number.isFinite(l.x) && Number.isFinite(l.y) && Number.isFinite(l.rot);
}

async function loadState(env) {
  const raw = await env.worker_prince.get('state', { type: 'json' });
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    hall: Array.isArray(s.hall) ? s.hall.filter(n => typeof n === 'string').slice(0, HALL_MAX) : [],
    fallen: Array.isArray(s.fallen) ? s.fallen.filter(isValidLetter).slice(-FALLEN_MAX) : [],
    clears: Number.isFinite(s.clears) ? s.clears : 0,
  };
}

function sanitizeName(input) {
  const s = String(input || '').trim().slice(0, NAME_MAX);
  if (!/^[\p{L}\p{N} .,'!?_-]+$/u.test(s)) return '';
  return s;
}

function sanitizeLetters(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(isValidLetter).slice(0, 20).map(l => ({
    c: l.c,
    x: Math.round(l.x * 100) / 100,
    y: Math.round(l.y * 100) / 100,
    rot: Math.round(l.rot * 100) / 100,
  }));
}

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers || {}),
    },
  });
}

async function handleScoresGet(env) {
  if (!env.worker_prince) return json(defaultState());
  try { return json(await loadState(env)); }
  catch { return json(defaultState()); }
}

async function handleScoresPost(request, env) {
  if (!env.worker_prince) return json({ error: 'no storage' }, { status: 503 });
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'bad json' }, { status: 400 }); }

  const name = sanitizeName(body.name);
  if (!name) return json({ error: 'bad name' }, { status: 400 });

  const newLetters = sanitizeLetters(body.fallenLetters);
  const state = await loadState(env);
  state.hall = [name, ...state.hall].slice(0, HALL_MAX);
  if (newLetters.length) state.fallen = [...state.fallen, ...newLetters].slice(-FALLEN_MAX);
  state.clears += 1;

  await env.worker_prince.put('state', JSON.stringify(state));
  return json(state);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/prince/scores') {
      if (request.method === 'GET')  return handleScoresGet(env);
      if (request.method === 'POST') return handleScoresPost(request, env);
      return new Response('method not allowed', { status: 405 });
    }
    return env.ASSETS.fetch(request);
  },
};
