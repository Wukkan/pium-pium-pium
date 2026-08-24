// ---------------------------------------------------------------------------
// Cliente WebSocket: conexión, protocolo y envío periódico del estado local.
// ---------------------------------------------------------------------------

export function isProtocolMessage(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.t === 'string';
}

export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.name = null;
    this.slots = 10;
    this.connected = false;
    this.handlers = {};   // t -> callback(msg)
    this._sendTimer = 0;
  }

  on(type, cb) { this.handlers[type] = cb; }

  connect(name, skin) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      let ws;
      try {
        ws = new WebSocket(`${proto}://${location.host}/ws`);
      } catch (e) { reject(e); return; }
      this.ws = ws;

      const timeout = setTimeout(() => {
        if (!settled) { settled = true; ws.close(); reject(new Error('timeout')); }
      }, 4000);

      ws.onopen = () => {
        ws.send(JSON.stringify({ t: 'hola', name, skin }));
      };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (!isProtocolMessage(m)) return;
        if (m.t === 'hi' && !settled) {
          settled = true;
          clearTimeout(timeout);
          this.id = m.id;
          this.name = m.name;
          this.slots = m.slots || 10;
          this.connected = true;
          resolve(m);
          return;
        }
        const h = this.handlers[m.t];
        if (h) h(m);
      };
      ws.onerror = () => {
        if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('error')); }
      };
      ws.onclose = () => {
        const wasConnected = this.connected;
        this.connected = false;
        if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('cerrado')); }
        else if (wasConnected && this.handlers._close) this.handlers._close();
      };
    });
  }

  onClose(cb) { this.handlers._close = cb; }

  _send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  // llamar cada frame; emite el estado a ~15 Hz
  tickState(dt, player) {
    if (!this.connected) return;
    this._sendTimer -= dt;
    if (this._sendTimer > 0) return;
    this._sendTimer = 1 / 15;
    this._send({
      t: 'st',
      p: [+player.pos.x.toFixed(2), +player.pos.y.toFixed(2), +player.pos.z.toFixed(2)],
      ry: +player.yaw.toFixed(2),
      rx: +player.pitch.toFixed(2),
      s: +player.horizontalSpeed().toFixed(1),
      sl: player.sliding,
    });
  }

  sendFire(a, b, kind) {
    this._send({
      t: 'fire',
      a: [+a.x.toFixed(1), +a.y.toFixed(1), +a.z.toFixed(1)],
      b: [+b.x.toFixed(1), +b.y.toFixed(1), +b.z.toFixed(1)],
      k: kind,
    });
  }

  sendHit(kind, id, dmg, isHead, weapon) {
    this._send({ t: 'hit', kind, id, d: dmg, h: isHead ? 1 : 0, w: weapon || '' });
  }

  sendTeam(team) { this._send({ t: 'team', tm: team }); }
  sendVote(mode) { this._send({ t: 'vote', m: mode }); }
  sendMapVote(map) { this._send({ t: 'vote', map }); }
  sendSelfDmg(d) { this._send({ t: 'selfdmg', d }); }
  sendChat(i) { this._send({ t: 'chat', i }); }
  sendSkin(h, c) { this._send({ t: 'skin', h, c }); }
  sendBotConfig(enabled, count, requestId) {
    this._send({ t: 'botcfg', enabled, count, rid: requestId });
  }
  sendPing() { this._send({ t: 'ping', ts: Date.now() }); }

  sendNade(pos, vel, impact) {
    this._send({
      t: 'nade',
      p: [+pos.x.toFixed(2), +pos.y.toFixed(2), +pos.z.toFixed(2)],
      v: [+vel.x.toFixed(2), +vel.y.toFixed(2), +vel.z.toFixed(2)],
      im: impact ? 1 : 0,
    });
  }
}
