# PIUM PIUM PIUM 🔫

Shooter multijugador original para navegador hecho con Three.js + Node.js. Su identidad visual, operadores y arsenal son propios.

La actualización **Combat Update 1.1** incorpora manos articuladas y animaciones completas en primera persona, operadores tácticos animados, impactos por superficie, casquillos, humo, audio espacial, hitmarkers y feedback de daño. El menú recibió una jerarquía visual nueva, tarjetas de arsenal con estadísticas, vista 3D del operador y navegación adaptable a móvil.

El parche **Spawn Safety 1.1.1** audita toda la geometría de Arena y Ciudad: cada mapa dispone de 10 respawns fijos con un metro de margen, el servidor elige el más alejado de entidades vivas y nunca reutiliza paquetes de una vida anterior. Los spawns de bots, waypoints y la reaparición de cajas también se validan para impedir que una entidad quede dentro de una estructura.

**Los bots rellenan la partida** (máximo 5): 1 jugador → 5 bots, 7 jugadores → 3 bots, 10+ jugadores → 0 bots. Todos contra todos — y los bots también pelean entre ellos.

## Jugar en local

```
node server/server.js
```

(o con el Node portable del proyecto: `tools\node-v22.14.0-win-x64\node.exe server\server.js`)

y abre **http://localhost:5173**. Escribe tu nombre y pulsa **JUGAR**.

> Si abres el juego sin servidor Node (por ejemplo con `python serve.py`), funciona en modo local: tú contra 5 bots.

## Control de bots

Durante una partida, pulsa **H** para abrir el panel **Control de bots · Sala actual**. Desde ahí puedes activar o desactivar los bots y elegir una cantidad de **0 a 5**; usar 0 retira todos los bots de la sala actual. El servidor puede reducir la cantidad si no quedan plazas libres para jugadores.

En el modo **Zombis** estos controles permanecen bloqueados, porque las oleadas administran automáticamente sus propios enemigos.

## Centro de configuración

El botón **🔊 AUDIO** de la barra superior permite silenciar el juego inmediatamente. También puedes abrir **OPCIONES**, que ahora incluye cinco secciones:

- **Audio**: activar o silenciar todo el juego y conservar el volumen elegido.
- **Video**: FOV, escala de resolución, sombras y su calidad, presupuesto de efectos, FPS y pantalla completa.
- **Controles**: sensibilidad, apuntado y reasignación persistente de 22 acciones. Si eliges una tecla ocupada, las dos funciones intercambian sus asignaciones.
- **Jugabilidad**: bunny-hop, balanceo del arma, sacudida de cámara, ping y apariencia de la mira.
- **Accesibilidad**: movimiento reducido, destello de daño y contraste alto.

Los cambios se aplican al momento y se guardan en el navegador. **Escape** permanece reservado como salida segura.

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
| 1-7 | Pistola / Escopeta / Subfusil / Rifle / Francotirador / Revólver / Lanzagranadas |
| G | Lanzar granada (2 por vida) |
| H | Abrir/cerrar el control de bots de la sala |
| B | Abrir/cerrar el arsenal |
| V | Ataque con cuchillo |
| M | Cambiar de equipo |
| C | Chat rápido |
| P | Silenciar/activar todo el sonido |
| TAB | Marcador |
| ESC | Menú |

Estas son las asignaciones iniciales; todas las teclas jugables se pueden cambiar desde **OPCIONES → CONTROLES**.

Empiezas con la pistola. Cada baja da **$100** (+$50 headshot, + bonus por racha) para desbloquear el resto de armas. Las rachas de bajas se anuncian a las 3, 5, 8, 10...

**Extras**: `V` cuchillo (100 de daño por la espalda), `G` granadas, `C` chat rápido, daño por caída, y las piernas reciben menos daño que el cuerpo. Armas extra: revólver ($450) y lanzagranadas ($2000, dispara granadas de impacto).

**Mapas**: Arena (clásico) y Ciudad (calles y azoteas) — se vota junto al modo al final de cada partida (teclas 5/6). Ambos con **saltadores** (plataformas amarillas que te lanzan por los aires) y **cajas destruibles** (80 pv, reaparecen a los 45 s).

**Personalización y progresión**: en el menú puedes comprar **sombreros** (gorra/chistera/corona) y **colores** para tu muñeco con el dinero de las bajas — los ven todos los jugadores. Hay **3 misiones diarias** (+$300 cada una) y tu **insignia de nivel** (🥉🥈🥇👑 según tus bajas totales del ranking mundial) aparece junto a tu nombre.

## Modos de juego (online)

Al final de cada partida hay **podio y votación** del siguiente modo (teclas 1-4). Si están activados, los bots ocupan las plazas configuradas que queden libres.

- **Todos contra todos** — primero a 30 bajas o 5 minutos.
- **Equipos** 🔴🔵 — eliges bando al empezar (y cambias con `M`); los bots equilibran los equipos; sin fuego amigo.
- **Búsqueda del arma** — todos con la misma escalera: pistola → escopeta → subfusil → rifle → francotirador. Solo avanzas matando con el arma que te toca. Gana quien complete las 5.
- **Zombis** 🧟 — cooperativo: 8 oleadas de zombis cada vez más numerosos, rápidos y duros. Solo van al cuerpo a cuerpo. Sobrevivid todos juntos.

## Créditos

- Sonidos de disparo: ["Gunshot Sounds" de Tabasco](https://opengameart.org/content/gunshot-sounds), grabaciones reales bajo licencia CC0 (dominio público).

## Arquitectura

- `server/server.js` — HTTP estático + WebSocket. Estado autoritativo: vida, muertes, respawns, marcador y nº de bots.
- `server/botai.js` — IA de los bots en el servidor (patrulla, combate, ráfagas con probabilidad de acierto).
- `src/shared/` — mapa, física y selector de respawn seguro compartidos entre cliente y servidor.
- `src/net.js` — cliente WebSocket (estado a 15 Hz, disparos, impactos).
- `src/remotes.js` — marionetas interpoladas de jugadores remotos y bots.
- `src/main.js` — arranque; modo online o local según haya servidor.
- El daño lo declara el cliente que dispara (suficiente para partidas entre amigos); el servidor valida rangos y lleva la puntuación.
