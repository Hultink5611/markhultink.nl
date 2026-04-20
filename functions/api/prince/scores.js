// Cloudflare Pages Function — Prince-game scoreboard
//
// Expects a KV namespace binding named `PRINCE_KV` on the Pages project.
// Dashboard → Pages → markhultink.nl → Settings → Functions → KV namespace bindings:
//   Variable name: PRINCE_KV   →   KV namespace: (create one, any name)
//
// Endpoints:
//   GET  /api/prince/scores  → { hall, fallen, clears }
//   POST /api/prince/scores  body { name, fallenLetters? } → updated state
//
// `hall` holds at most 6 names (nieuwste eerst). When a 7e naam wordt
// toegevoegd, laten we de cliënt de letters van positie 6 doorsturen als
// `fallenLetters` met hun eindpositie; die gooien we achter in `fallen`.

const KEY = 'state';
const HALL_MAX = 6;
const FALLEN_MAX = 200;
const NAME_MAX = 10;

const defaultState = () => ({ hall: [], fallen: [], clears: 0 });

async function loadState(env) {
  const raw = await env.PRINCE_KV.get(KEY, { type: 'json' });
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    hall: Array.isArray(s.hall) ? s.hall.filter(n => typeof n === 'string').slice(0, HALL_MAX) : [],
    fallen: Array.isArray(s.fallen) ? s.fallen.filter(isValidLetter).slice(-FALLEN_MAX) : [],
    clears: Number.isFinite(s.clears) ? s.clears : 0,
  };
}

function isValidLetter(l) {
  return l && typeof l.c === 'string' && l.c.length === 1
    && Number.isFinite(l.x) && Number.isFinite(l.y) && Number.isFinite(l.rot);
}

function sanitizeName(input) {
  const s = String(input || '').trim().slice(0, NAME_MAX);
  // Allow letters/digits/space/basic punctuation — block control chars and HTML
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

export async function onRequestGet({ env }) {
  if (!env.PRINCE_KV) return json(defaultState());
  try {
    return json(await loadState(env));
  } catch (e) {
    return json(defaultState());
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.PRINCE_KV) return json({ error: 'no storage' }, { status: 503 });

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

  await env.PRINCE_KV.put(KEY, JSON.stringify(state));
  return json(state);
}
