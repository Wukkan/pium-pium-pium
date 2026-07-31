// ---------------------------------------------------------------------------
// HUD: vida, munición, mira, hitmarker, killfeed, viñeta de daño, pantallas.
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), menu: $('menu'), death: $('death'),
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
  }

  showMenu(show) { this.el.menu.style.display = show ? 'flex' : 'none'; }
  showHud(show) { this.el.hud.style.display = show ? 'block' : 'none'; }
  showDeath(show, killerName) {
    this.el.death.style.display = show ? 'flex' : 'none';
    if (show) this.el.deathKiller.textContent = `Te eliminó ${killerName}`;
  }

  setCrosshairGap(px) {
    this.el.crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
  }

  setScope(on) {
    this.el.scope.style.display = on ? 'block' : 'none';
    this.el.crosshair.style.display = on ? 'none' : 'block';
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

  hitmarker(kill = false) {
    const hm = this.el.hitmarker;
    hm.classList.toggle('kill', kill);
    hm.style.opacity = '1';
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => { hm.style.opacity = '0'; }, kill ? 220 : 90);
  }

  damageFlash(intensity = 0.5) {
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
