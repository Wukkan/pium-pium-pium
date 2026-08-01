// ---------------------------------------------------------------------------
// Misiones diarias (locales, guardadas en el navegador): 3 al día, $300 cada
// una. Se eligen del pool según la fecha, así todos tienen las mismas.
// ---------------------------------------------------------------------------

const POOL = [
  { id: 'kills15', txt: 'Consigue 15 bajas', goal: 15, ev: 'kill' },
  { id: 'heads3', txt: 'Acierta 3 tiros a la cabeza', goal: 3, ev: 'headshot' },
  { id: 'win1', txt: 'Gana una partida', goal: 1, ev: 'win' },
  { id: 'streak5', txt: 'Logra una racha de 5', goal: 1, ev: 'streak5' },
  { id: 'kits3', txt: 'Recoge 3 botiquines', goal: 3, ev: 'kit' },
  { id: 'knife2', txt: 'Mata a 2 con el cuchillo', goal: 2, ev: 'knifekill' },
  { id: 'nade1', txt: 'Mata a 1 con granada', goal: 1, ev: 'nadekill' },
];

export const MISSION_REWARD = 300;

export class Missions {
  // onReward(cantidad, textoMision)
  constructor(onReward) {
    this.onReward = onReward;
    const today = new Date().toISOString().slice(0, 10);
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('pium_missions')); } catch { /* nada */ }
    if (saved && saved.date === today) {
      this.list = saved.list;
    } else {
      // selección determinista por fecha (mismas misiones para todos)
      let seed = 0;
      for (const ch of today) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
      const indices = [];
      while (indices.length < 3) {
        seed = (seed * 7 + 13) % 9973;
        const i = seed % POOL.length;
        if (!indices.includes(i)) indices.push(i);
      }
      this.list = indices.map((i) => ({ id: POOL[i].id, prog: 0, done: false }));
      this.save(today);
    }
    this.date = today;
  }

  save(date = this.date) {
    localStorage.setItem('pium_missions', JSON.stringify({ date, list: this.list }));
  }

  event(ev) {
    for (const m of this.list) {
      const def = POOL.find((p) => p.id === m.id);
      if (!def || m.done || def.ev !== ev) continue;
      m.prog++;
      if (m.prog >= def.goal) {
        m.done = true;
        this.onReward(MISSION_REWARD, def.txt);
      }
      this.save();
    }
  }

  // para pintar en el menú: [{txt, prog, goal, done}]
  status() {
    return this.list.map((m) => {
      const def = POOL.find((p) => p.id === m.id);
      return { txt: def.txt, prog: Math.min(m.prog, def.goal), goal: def.goal, done: m.done };
    });
  }
}
