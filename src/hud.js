// ---------------------------------------------------------------------------
// HUD: vida, munición, mira, hitmarker, killfeed, viñeta de daño, pantallas.
// ---------------------------------------------------------------------------

import { podiumStageState, weaponHudLabel } from './ui-models.js';

const $ = (id) => document.getElementById(id);

const SLOT_NAMES = {
  pistol: 'Pistola', shotgun: 'Escopeta', smg: 'Subfusil', ar: 'Rifle', sniper: 'Franco',
  revolver: 'Revólver', launcher: 'Lanzagr.',
};

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), menu: $('menu'), death: $('death'), buyMenu: $('buy-menu'), botPanel: $('bot-panel'),
      crosshair: $('crosshair'), hitmarker: $('hitmarker'),
      vignette: $('damage-vignette'), scope: $('scope'),
      healthBar: $('health-bar'), healthLabel: $('health-label'),
      ammo: $('ammo'), weaponName: $('weapon-name'), reloadHint: $('reload-hint'),
      score: $('score'), killfeed: $('killfeed'), announce: $('announce'),
      deathKiller: $('death-killer'), menuStats: $('menu-stats'), fps: $('fps'),
    };
    this._hitTimer = null;
    this._announceTimer = null;
    this._vignetteLevel = 0;
    this._damageFlashEnabled = true;
    this._crosshairVisible = true;
    this._showPing = true;
    this._grenadeCount = 0;
    this._weapons = null;
    this.bindingLabels = {
      grenade: 'G', reload: 'R',
      slots: ['1', '2', '3', '4', '5', '6', '7'],
    };
  }

  showMenu(show) { this.el.menu.style.display = show ? 'flex' : 'none'; }
  showBuyMenu(show) {
    this.el.buyMenu.style.display = show ? 'flex' : 'none';
    this.el.buyMenu.setAttribute('aria-hidden', show ? 'false' : 'true');
  }
  showBotPanel(show) {
    this.el.botPanel.style.display = show ? 'flex' : 'none';
    this.el.botPanel.setAttribute('aria-hidden', show ? 'false' : 'true');
  }
  showHud(show) { this.el.hud.style.display = show ? 'block' : 'none'; }
  showDeath(show, killerName) {
    this.el.death.style.display = show ? 'flex' : 'none';
    if (show) this.el.deathKiller.textContent = `Te eliminó ${killerName}`;
  }

  setCrosshairGap(px) {
    this.el.crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
  }

  setCrosshairPreferences({ visible = true, color = '#ffffff', scale = 1 } = {}) {
    this._crosshairVisible = visible;
    this.el.crosshair.style.setProperty('--crosshair-color', color);
    this.el.crosshair.style.setProperty('--crosshair-scale', String(scale));
    if (this.el.scope.style.display !== 'block') {
      this.el.crosshair.style.display = visible ? 'block' : 'none';
    }
  }

  setBindingLabels({ grenade, reload, slots } = {}) {
    if (grenade) this.bindingLabels.grenade = grenade;
    if (reload) this.bindingLabels.reload = reload;
    if (Array.isArray(slots)) this.bindingLabels.slots = slots;
    this.updateGrenades(this._grenadeCount);
    if (this._weapons) this.updateSlots(this._weapons);
  }

  setDamageFlashEnabled(enabled) {
    this._damageFlashEnabled = !!enabled;
    if (!this._damageFlashEnabled) {
      this._vignetteLevel = 0;
      this.el.vignette.style.opacity = '0';
    }
  }

  setPingVisible(show) {
    this._showPing = !!show;
    document.getElementById('ping').style.display = this._showPing ? 'block' : 'none';
  }

  setScope(on) {
    this.el.scope.style.display = on ? 'block' : 'none';
    this.el.crosshair.style.display = on || !this._crosshairVisible ? 'none' : 'block';
  }

  updateHealth(hp, max) {
    const pct = Math.max(0, hp / max) * 100;
    this.el.healthBar.style.width = `${pct}%`;
    this.el.healthBar.classList.toggle('low', pct < 35);
    this.el.healthLabel.textContent = `${Math.ceil(hp)} PV`;
  }

  updateAmmo(weapons) {
    const st = weapons.ammo;
    this.el.ammo.innerHTML = `${st.ammo} <span class="reserve">/ ${st.reserve}</span>`;
    this.el.weaponName.textContent = weapons.def.name;
  }

  setReloading(on) {
    this.el.reloadHint.style.display = on ? 'block' : 'none';
    document.getElementById('reload-indicator').style.display = on ? 'block' : 'none';
    if (!on) this.setReloadProgress(0);
  }

  setReloadProgress(p) {
    document.getElementById('reload-bar').style.width = `${Math.round(p * 100)}%`;
  }

  updateScore(kills, deaths) {
    this.el.score.innerHTML = `<span class="k">☠ ${kills}</span><span class="d">✖ ${deaths}</span>`;
  }

  updateMoney(n) {
    document.getElementById('money').textContent = `$ ${n}`;
  }

  setFpsVisible(show) {
    this.el.fps.style.display = show ? 'block' : 'none';
  }

  updateGrenades(n) {
    this._grenadeCount = n;
    document.getElementById('nades').textContent = `🧨 [${this.bindingLabels.grenade}] Granadas: ${n}`;
  }

  // ranuras compactas: las compras viven exclusivamente en el arsenal B
  updateSlots(weapons) {
    this._weapons = weapons;
    const wrap = document.getElementById('weapon-slots');
    wrap.textContent = '';
    weapons.slots.forEach((key, i) => {
      const def = weapons.defs[key];
      const span = document.createElement('span');
      span.className = 'slot';
      if (key === weapons.current) span.classList.add('current');
      if (!weapons.owned[key]) span.classList.add('locked');
      span.textContent = weaponHudLabel(def, i, SLOT_NAMES[key], this.bindingLabels.slots[i]);
      wrap.append(span);
      return;
      /*
      if (!weapons.owned[key]) {
        span.classList.add(weapons.money >= def.price ? 'affordable' : 'locked');
        span.textContent = `[${i + 1}] ${SLOT_NAMES[key]} $${def.price}${weapons.money >= def.price ? '' : ' 🔒'}`;
      } else {
        span.textContent = `[${i + 1}] ${SLOT_NAMES[key]}`;
      }
      wrap.append(span);
      */
    });
    const extra = document.createElement('span');
    extra.className = 'slot';
    extra.textContent = `[${this.bindingLabels.reload}] Recargar`;
    wrap.append(extra);
  }

  hitmarker(kill = false) {
    const hm = this.el.hitmarker;
    hm.classList.toggle('kill', kill);
    hm.style.opacity = '1';
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => { hm.style.opacity = '0'; }, kill ? 220 : 90);
  }

  damageFlash(intensity = 0.5) {
    if (!this._damageFlashEnabled) return;
    this._vignetteLevel = Math.min(1, this._vignetteLevel + intensity);
  }

  update(dt) {
    if (this._vignetteLevel > 0) {
      this._vignetteLevel = Math.max(0, this._vignetteLevel - dt * 1.6);
      this.el.vignette.style.opacity = this._vignetteLevel.toFixed(2);
    }
  }

  killfeed(killer, victim, isMe) {
    // construido con textContent para que un nombre malicioso no inyecte HTML
    const div = document.createElement('div');
    div.className = 'kf-entry' + (isMe ? ' me' : '');
    const k = document.createElement('span');
    k.className = 'killer';
    k.textContent = killer;
    const v = document.createElement('span');
    v.className = 'victim';
    v.textContent = victim;
    div.append(k, ' ☠ ', v);
    this.el.killfeed.prepend(div);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.lastChild.remove();
    setTimeout(() => { div.style.opacity = '0'; }, 3500);
    setTimeout(() => { div.remove(); }, 4100);
  }

  info(text) {
    const div = document.createElement('div');
    div.className = 'kf-entry';
    div.textContent = text;
    this.el.killfeed.prepend(div);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.lastChild.remove();
    setTimeout(() => { div.style.opacity = '0'; }, 3500);
    setTimeout(() => { div.remove(); }, 4100);
  }

  setNetStatus(text, online) {
    const el = document.getElementById('net-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('online', !!online);
    el.classList.toggle('offline', !online);
  }

  showScores(show) {
    document.getElementById('scores').style.display = show ? 'block' : 'none';
  }

  setMatchBanner(text) {
    const el = document.getElementById('match-banner');
    el.textContent = text;
    el.style.display = text ? 'block' : 'none';
  }

  showPodium(data) {
    // data: {winner, txt, rows, mode, secs}
    const el = document.getElementById('podium');
    el.style.display = 'block';
    document.getElementById('podium-winner').textContent = `🏆 ${data.winner}`;
    const rowsEl = document.getElementById('podium-rows');
    rowsEl.textContent = '';
    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    data.rows.forEach((r, i) => {
      const div = document.createElement('div');
      const extra = data.mode === 'gun' ? ` · armas ${r.gi}/5` : '';
      const team = r.tm ? (r.tm === 'r' ? ' 🔴' : ' 🔵') : '';
      div.textContent = `${medals[i] || ''} ${r.n}${team} — ☠ ${r.k} ✖ ${r.d}${extra}`;
      rowsEl.append(div);
    });
    if (data.txt) {
      const div = document.createElement('div');
      div.style.color = '#9fb4d8';
      div.textContent = data.txt;
      rowsEl.prepend(div);
    }
    const renderOptions = (id, options) => {
      const wrap = document.getElementById(id);
      wrap.textContent = '';
      for (const option of options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'vote-option';
        button.dataset.vote = option.kind;
        button.dataset.voteType = option.type;
        button.textContent = `[${this.bindingLabels.slots[option.key - 1] || option.key}] ${option.label}`;
        wrap.append(button);
      }
    };
    renderOptions('mode-vote-options', [
      { key: 1, kind: 'ffa', type: 'mode', label: 'TODOS CONTRA TODOS' },
      { key: 2, kind: 'teams', type: 'mode', label: 'EQUIPOS' },
      { key: 3, kind: 'gun', type: 'mode', label: 'BÚSQUEDA DEL ARMA' },
      { key: 4, kind: 'zombies', type: 'mode', label: 'ZOMBIS' },
    ]);
    renderOptions('map-vote-options', [
      { key: 5, kind: 'arena', type: 'map', label: 'ARENA' },
      { key: 6, kind: 'ciudad', type: 'map', label: 'CIUDAD' },
    ]);
    document.getElementById('podium-votes').textContent = '';
  }

  hidePodium() {
    document.getElementById('podium').style.display = 'none';
  }

  setPodiumVotes(tally, mapTally = {}) {
    const names = { ffa: 'FFA', teams: 'Equipos', gun: 'Armas', zombies: 'Zombis', arena: 'Arena', ciudad: 'Ciudad' };
    const parts = [
      ...Object.entries(tally).map(([m, n]) => `${names[m] || m}: ${n}`),
      ...Object.entries(mapTally).map(([m, n]) => `🗺${names[m] || m}: ${n}`),
    ];
    document.getElementById('podium-votes').textContent = parts.length ? `Votos → ${parts.join(' · ')}` : '';
  }

  setPing(ms) {
    const el = document.getElementById('ping');
    el.textContent = ms >= 0 ? `${ms} ms` : '';
    el.style.color = ms < 80 ? 'rgba(140,231,140,.8)' : ms < 160 ? 'rgba(255,210,77,.8)' : 'rgba(255,107,90,.8)';
  }

  showChatMenu(show, options) {
    const el = document.getElementById('chat-menu');
    el.style.display = show ? 'block' : 'none';
    if (show && options) {
      const list = document.getElementById('chat-options');
      list.textContent = '';
      options.forEach((txt, i) => {
        const div = document.createElement('div');
        div.className = 'chat-opt';
        const b = document.createElement('b');
        b.textContent = `[${this.bindingLabels.slots[i] || i + 1}] `;
        div.append(b, txt);
        list.append(div);
      });
    }
  }

  setPodiumCountdown(secs) {
    document.getElementById('podium-count').textContent = `Siguiente partida en ${secs}s...`;
  }

  setPodiumStage(stage = 'mode', secs = 15) {
    const state = podiumStageState(stage);
    const podium = document.getElementById('podium');
    podium.dataset.stage = state.stage;
    document.getElementById('podium-phase').textContent = state.phase;
    document.getElementById('podium-stage-title').textContent = state.title;
    document.getElementById('podium-stage-help').textContent = state.voteType === 'mode'
      ? 'Selecciona el modo para la siguiente partida.'
      : 'Modo confirmado. Ahora selecciona el mapa.';
    document.getElementById('podium-votes').textContent = '';
    this.setPodiumCountdown(secs);
  }

  showTeamPicker(show) {
    document.getElementById('team-picker').style.display = show ? 'block' : 'none';
  }

  // ranking mundial: rows de /ranking [{name, kills, deaths, best_streak}]
  renderWorld(rows, myName) {
    const tbody = document.getElementById('world-body');
    tbody.textContent = '';
    if (!rows || rows.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'world-empty';
      td.textContent = 'sin datos todavía — ¡haz historia!';
      tr.append(td);
      tbody.append(tr);
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    rows.slice(0, 10).forEach((r, i) => {
      const tr = document.createElement('tr');
      if (myName && r.name === myName) tr.className = 'me';
      for (const v of [`${medals[i] || `${i + 1}.`} ${r.name}`, r.kills, r.deaths, r.best_streak]) {
        const td = document.createElement('td');
        td.textContent = v;
        tr.append(td);
      }
      tbody.append(tr);
    });
  }

  // rows: [{name, kills, deaths, isMe, isBot, alive}]
  renderScores(rows) {
    const tbody = document.getElementById('scores-body');
    if (!tbody) return;
    tbody.textContent = '';
    for (const r of rows) {
      const tr = document.createElement('tr');
      if (r.isMe) tr.className = 'me';
      const name = document.createElement('td');
      name.textContent = (r.isBot ? '🤖 ' : '') + r.name + (r.alive ? '' : ' 💀');
      const k = document.createElement('td');
      k.textContent = r.kills === null ? '—' : r.kills;
      const d = document.createElement('td');
      d.textContent = r.deaths === null ? '—' : r.deaths;
      tr.append(name, k, d);
      tbody.append(tr);
    }
  }

  announce(text) {
    this.el.announce.textContent = text;
    this.el.announce.style.opacity = '1';
    clearTimeout(this._announceTimer);
    this._announceTimer = setTimeout(() => { this.el.announce.style.opacity = '0'; }, 1200);
  }

  setMenuStats(kills, deaths) {
    if (kills + deaths > 0) {
      this.el.menuStats.textContent = `Esta partida: ${kills} bajas · ${deaths} muertes`;
    }
  }
}
