// ---------------------------------------------------------------------------
// Cliente WebSocket: conexión, protocolo y envío periódico del estado local.
// ---------------------------------------------------------------------------

import { isLobbyMode, isLobbyRoom } from './lobby-catalog.js';

export function isProtocolMessage(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.t === 'string';
}

export function lobbyHelloMessage(name, skin, selection) {
  if (!selection || !isLobbyMode(selection.mode) || !isLobbyRoom(selection.room)) {
    const error = new TypeError('invalid-lobby-selection');
    error.code = 'INVALID_SELECTION';
    throw error;
  }
  return {
    t: 'hola', pv: 2, name, skin,
    mode: selection.mode,
    room: selection.room,
  };
}

export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.name = null;
    this.mode = null;
    this.room = null;
    this.slots = 10;
    this.connected = false;
    this.spawnSequence = 0;
    this.handlers = {};   // t -> callback(msg)
    this._sendTimer = 0;
    this._heartbeatTimer = null;
  }

  on(type, cb) { this.handlers[type] = cb; }

  connect(name, skin, selection) {
    return new Promise((resolve, reject) => {
      this.stopHeartbeat();
      this.connected = false;
      let hello;
      try {
        hello = lobbyHelloMessage(name, skin, selection);
      } catch (error) {
        reject(error);
        return;
      }
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
        if (this.ws !== ws) {
          ws.close(1000, 'Conexión reemplazada');
          return;
        }
        ws.send(JSON.stringify(hello));
      };
      ws.onmessage = (ev) => {
        if (this.ws !== ws) return;
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (!isProtocolMessage(m)) return;
        if (m.t === 'hi' && !settled) {
          if (m.mode !== hello.mode || m.room !== hello.room) {
            settled = true;
            clearTimeout(timeout);
            const error = new Error('room-mismatch');
            error.code = 'ROOM_MISMATCH';
            reject(error);
            ws.close(1008, 'Sala no confirmada');
            return;
          }
          settled = true;
          clearTimeout(timeout);
          this.id = m.id;
          this.name = m.name;
          this.mode = m.mode;
          this.room = m.room;
          this.slots = m.slots || 10;
          this.acceptSpawn(m.sid);
          this.connected = true;
          resolve(m);
          return;
        }
        if ((m.t === 'full' || m.t === 'joinerr') && !settled) {
          settled = true;
          clearTimeout(timeout);
          const error = new Error(m.t === 'full' ? 'room-full' : 'join-error');
          error.code = m.code || (m.t === 'full' ? 'ROOM_FULL' : 'INVALID_ROOM');
          error.mode = m.mode;
          error.room = m.room;
          reject(error);
          ws.close();
          return;
        }
        const h = this.handlers[m.t];
        if (h) h(m);
      };
      ws.onerror = () => {
        if (this.ws !== ws) return;
        if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('error')); }
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        const wasConnected = this.connected;
        this.connected = false;
        this.stopHeartbeat();
        if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('cerrado')); }
        else if (wasConnected && this.handlers._close) this.handlers._close();
      };
    });
  }

  onClose(cb) { this.handlers._close = cb; }

  startHeartbeat(intervalMs = 3000) {
    this.stopHeartbeat();
    const delay = Math.max(1000, Math.min(30000, Math.round(Number(intervalMs) || 3000)));
    this._heartbeatTimer = setInterval(() => {
      if (this.connected) this.sendPing();
    }, delay);
    return this._heartbeatTimer;
  }

  stopHeartbeat() {
    if (this._heartbeatTimer !== null) clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
  }

  acceptSpawn(sequence) {
    if (Number.isSafeInteger(sequence) && sequence >= 0) this.spawnSequence = sequence;
    return this.spawnSequence;
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  // llamar cada frame; emite el estado a ~15 Hz
  tickState(dt, player) {
    if (!this.connected || !player || player.dead) return;
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
      sid: this.spawnSequence,
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
