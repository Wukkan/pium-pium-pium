// ---------------------------------------------------------------------------
// Ranking mundial persistente (Supabase). Acumula estadísticas en memoria y
// las vuelca cada 25 s vía la función RPC pium_bump (con topes anti-abuso).
// Solo cuentan los humanos, no los bots. La clave anon es pública por diseño:
// las escrituras pasan por la función con validación en la base de datos.
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vrxdqxaqyxgrvlvqtokd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyeGRxeGFxeXhncnZsdnF0b2tkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMjgzODQsImV4cCI6MjA5MzYwNDM4NH0.XXYR2Q0MeZVn30g6WImuvTsaRH5ArxrkuTy7GCKpO48';

const HEADERS = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

const pending = new Map(); // name -> {kills, deaths, streak}
let topCache = { at: 0, rows: [] };

function entry(name) {
  if (!pending.has(name)) pending.set(name, { kills: 0, deaths: 0, streak: 0 });
  return pending.get(name);
}

export function addKill(name, currentStreak) {
  const e = entry(name);
  e.kills++;
  if (currentStreak > e.streak) e.streak = currentStreak;
}

export function addDeath(name) {
  entry(name).deaths++;
}

async function flush() {
  if (pending.size === 0) return;
  const batch = [...pending.entries()];
  pending.clear();
  for (const [name, e] of batch) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/pium_bump`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ p_name: name, p_kills: e.kills, p_deaths: e.deaths, p_streak: e.streak }),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
    } catch (err) {
      // si falla, se reintenta en el siguiente volcado
      const back = entry(name);
      back.kills += e.kills;
      back.deaths += e.deaths;
      back.streak = Math.max(back.streak, e.streak);
      console.error('ranking: fallo al guardar,', err.message);
    }
  }
}

export async function top(limit = 20) {
  const now = Date.now();
  if (now - topCache.at < 15000) return topCache.rows;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pium_ranking?select=name,kills,deaths,best_streak&order=kills.desc&limit=${limit}`,
      { headers: HEADERS },
    );
    if (!res.ok) throw new Error(`http ${res.status}`);
    topCache = { at: now, rows: await res.json() };
  } catch (err) {
    console.error('ranking: fallo al leer,', err.message);
    topCache.at = now; // no martillear si está caído
  }
  return topCache.rows;
}

// bajas totales históricas de un jugador (para su insignia de nivel)
export async function getTotalKills(name) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pium_ranking?select=kills&name=eq.${encodeURIComponent(name)}`,
      { headers: HEADERS },
    );
    if (!res.ok) return 0;
    const rows = await res.json();
    return rows.length ? rows[0].kills : 0;
  } catch {
    return 0;
  }
}

setInterval(flush, 25000);
