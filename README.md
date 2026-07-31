# PIUM PIUM PIUM 🔫

Shooter multijugador en el navegador (réplica de krunker.io) hecho con Three.js + Node.js.

**Los bots rellenan la partida** (máximo 5): 1 jugador → 5 bots, 7 jugadores → 3 bots, 10+ jugadores → 0 bots. Todos contra todos — y los bots también pelean entre ellos.

## Jugar en local

```
node server/server.js
```

(o con el Node portable del proyecto: `tools\node-v22.14.0-win-x64\node.exe server\server.js`)

y abre **http://localhost:5173**. Escribe tu nombre y pulsa **JUGAR**.

> Si abres el juego sin servidor Node (por ejemplo con `python serve.py`), funciona en modo local: tú contra 9 bots.

## Desplegar gratis en Render

1. Sube este repositorio a GitHub.
2. Crea cuenta gratuita en [render.com](https://render.com).
3. **New + → Blueprint** → conecta el repositorio (usa `render.yaml` automáticamente), o **New + → Web Service** con: Build `npm install`, Start `npm start`, plan **Free**, región **Ohio**.
4. Comparte la URL `https://tu-app.onrender.com` con tus amigos.

⚠️ El plan gratuito duerme el servidor tras 15 min sin uso: el primero en entrar espera ~1 minuto.

## Controles

| Tecla | Acción |
|---|---|
| WASD | Moverse |
| Espacio | Saltar (mantén para bunny-hop) |
| Shift | Deslizarse |
| Clic izq / der | Disparar / Apuntar |
| R | Recargar |
| 1-5 | Pistola / Escopeta ($300) / Subfusil ($500) / Rifle ($800) / Francotirador ($1200) |
| G | Lanzar granada (2 por vida) |
| TAB | Marcador |
| ESC | Menú |

Empiezas con la pistola. Cada baja da **$100** (+$50 headshot, + bonus por racha) para desbloquear el resto de armas. Las rachas de bajas se anuncian a las 3, 5, 8, 10...

## Créditos

- Sonidos de disparo: ["Gunshot Sounds" de Tabasco](https://opengameart.org/content/gunshot-sounds), grabaciones reales bajo licencia CC0 (dominio público).

## Arquitectura

- `server/server.js` — HTTP estático + WebSocket. Estado autoritativo: vida, muertes, respawns, marcador y nº de bots.
- `server/botai.js` — IA de los bots en el servidor (patrulla, combate, ráfagas con probabilidad de acierto).
- `src/shared/` — mapa y física compartidos entre cliente y servidor (mismo código de colisiones).
- `src/net.js` — cliente WebSocket (estado a 15 Hz, disparos, impactos).
- `src/remotes.js` — marionetas interpoladas de jugadores remotos y bots.
- `src/main.js` — arranque; modo online o local según haya servidor.
- El daño lo declara el cliente que dispara (suficiente para partidas entre amigos); el servidor valida rangos y lleva la puntuación.
