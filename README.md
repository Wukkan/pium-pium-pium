# PIUM PIUM PIUM 🔫

Shooter multijugador original para navegador hecho con Three.js + Node.js. Su identidad visual, operadores y arsenal son propios.

La actualización **Combat Update 1.1** incorpora manos articuladas y animaciones completas en primera persona, operadores tácticos animados, impactos por superficie, casquillos, humo, audio espacial, hitmarkers y feedback de daño. El menú recibió una jerarquía visual nueva, tarjetas de arsenal con estadísticas, vista 3D del operador y navegación adaptable a móvil.

El parche **Spawn Safety 1.1.1** audita toda la geometría de Arena y Ciudad: cada mapa dispone de 10 respawns fijos con un metro de margen, el servidor elige el más alejado de entidades vivas y nunca reutiliza paquetes de una vida anterior. Los spawns de bots, waypoints y la reaparición de cajas también se validan para impedir que una entidad quede dentro de una estructura.

La actualización **Viewmodel & Crosshair 1.2** convierte el cuchillo en un cambio temporal de arma real: oculta el arma de fuego, bloquea acciones incompatibles y sincroniza el daño con el golpe visual. También añade brazos anclados, manos con palma, nudillos, pulgar y tres falanges por dedo; un estudio completo de mira con presets, color libre, tamaño, grosor, apertura, punto, contorno, opacidad y respuesta dinámica; y una experiencia de arsenal/compra táctica, minimalista y accesible.

La actualización **Rounded World 1.3** suaviza de forma proporcional todas las piezas visibles del escenario, operadores, manos, armas, cuchillo, kits, granadas y efectos. Las dimensiones exteriores, hitboxes y colliders se conservan exactamente; Arena y Ciudad permanecen dentro de un presupuesto controlado de geometría. La interfaz completa comparte ahora un sistema adaptable de radios para ventanas, tarjetas, HUD, compra, bots, opciones, mira, barras y controles, manteniendo circulares los elementos que lo requieren.

El parche **Live 3D Arsenal 1.4.0** convierte las tarjetas de Arsenal y Compra en vitrinas 3D interactivas. La equipada gira automáticamente y cualquier arma toma la vista en vivo al pasar el cursor o enfocarla; un único renderer compartido conserva los FPS, respeta reducción de movimiento y mantiene la imagen real como fallback seguro.

La actualización **Online Rooms 1.5.0** lleva la elección al menú previo: antes de jugar se seleccionan uno de cuatro modos y una de sus dos salas online. Cada una admite hasta 10 jugadores humanos y mantiene aislados su mapa, cajas, respawns, bots, configuración, marcador y votación. El servidor publica ocupación en vivo, rechaza de forma autoritativa una sala llena y conserva el modo elegido; al terminar solo se vota el próximo mapa.

La actualización **Real Grip 1.6.0** sustituye la pose genérica de manos por agarres anatómicos específicos para las siete armas y el cuchillo. Índice, medio, anular, meñique y pulgar poseen articulaciones MCP/PIP/DIP independientes; el índice descansa sobre un gatillo visible y los otros dedos envuelven la empuñadura. La mano de apoyo cruza cada guardamanos, acompaña la bomba de la escopeta y alcanza cargador, tambor o cierre durante la recarga. Los brazos usan una cadena de dos huesos con proporciones constantes y hombros anclados durante el cuchillazo, mientras los nuevos materiales del guante conservan la lectura de nudillos, paneles y puntas de los dedos.

El parche **Stable Arsenal 1.6.1** elimina los saltos al cambiar de categoría tanto en el arsenal principal como en el depósito de partida. Ambos conservan exactamente el mismo marco, usan catálogos internos desplazables y tarjetas compactas de proporción casi cuadrada; los filtros reinician su propio scroll y el diseño mantiene ancho, alto y alineación en escritorio, tablet y móvil.

El parche **Tactical Knife 1.6.2** reconstruye la presentación del cuchillo en primera persona: hoja biselada con filo y vaciado visibles, mango estriado, manos con falanges y protecciones, brazos anatómicos más suaves y una guardia independiente que ya no viaja pegada a la hoja. El agarre se calibra contra la superficie real del mango y el ataque separa desenfunde, anticipación, impacto y recuperación.

El parche **Solid Cover 1.6.3** corrige las juntas abiertas que produjo el redondeado independiente de cada bloque. Arena y Ciudad vuelven a llenar exactamente el mismo volumen que sus colliders y suavizan las aristas mediante iluminación, sin recortar cobertura. El suelo continúa bajo los muros, el alero suroeste y el mástil de Arena quedan apoyados, y el puente de Ciudad se une a la azotea con sus dos barandas asentadas. Nuevas regresiones comprueban esquinas con raycast, continuidad estructural, respawns y presupuesto geométrico.

El parche **Pium Signature 1.6.4** reemplaza las grabaciones genéricas de disparo por una identidad procedural original. Cada bala articula un ataque corto, un barrido descendente "piu" y una cola grave "m"; las armas automáticas forman naturalmente el nombre **PIUM PIUM PIUM**. Las siete clases conservan peso, duración y tono propios, mientras disparos remotos y bots mantienen distancia, orientación y filtrado espacial. El sintetizador usa como máximo dos voces breves por bala y el silencio evita trabajo de audio innecesario.

El parche **Room Entry Fix 1.6.5** desacopla la entrada a la partida de Pointer Lock: una conexión confirmada abre siempre la arena y el HUD, incluso cuando el navegador integrado bloquea la captura exclusiva del mouse. En ese caso se habilita automáticamente un control compatible de teclado, cámara y armas. La captura estándar continúa disponible en navegadores compatibles, `Escape` vuelve al menú en ambos modos y el botón **ENTRAR SALA** permanece visible como acción flotante en pantallas pequeñas.

El parche **Clean Audio 1.6.6** reconstruye la mezcla para eliminar chasquidos, saturación y el ruido áspero de las ráfagas. Incorpora ataques y salidas suaves, offsets aleatorios para el ruido procedural, robo de voces con fundido, headroom y limitador final. Los disparos y explosiones lejanas ahora desaparecen al salir del radio audible, el audio de combate se pausa fuera de la partida y los intentos de disparar sin munición ya no generan una repetición dañada.

El parche **True Weapon Previews 1.3.1** elimina las siluetas genéricas del arsenal y la compra. Las siete imágenes se renderizan directamente desde los mismos modelos, geometrías y materiales que utiliza el jugador, se cachean una sola vez y se comparten entre ambas interfaces. La vista 3D del operador también equipa ahora el modelo detallado del arma seleccionada.

**Los bots rellenan la partida** (máximo 5): 1 jugador → 5 bots, 7 jugadores → 3 bots, 10+ jugadores → 0 bots. Todos contra todos — y los bots también pelean entre ellos.

## Jugar en local

```
node server/server.js
```

(o con el Node portable del proyecto: `tools\node-v22.14.0-win-x64\node.exe server\server.js`)

y abre **http://localhost:5173**. Elige modo y sala, escribe tu nombre y pulsa **JUGAR**.

> Si abres el juego sin servidor Node (por ejemplo con `python serve.py`), funciona en modo local: tú contra 5 bots.

## Control de bots

Durante una partida, pulsa **H** para abrir el panel **Control de bots · Sala actual**. Desde ahí puedes activar o desactivar los bots y elegir una cantidad de **0 a 5**; usar 0 retira todos los bots de la sala actual. El servidor puede reducir la cantidad si no quedan plazas libres para jugadores.

En el modo **Zombis** estos controles permanecen bloqueados, porque las oleadas administran automáticamente sus propios enemigos.

## Centro de configuración

El botón **🔊 AUDIO** de la barra superior permite silenciar el juego inmediatamente. También puedes abrir **OPCIONES**, que ahora incluye cinco secciones:

- **Audio**: activar o silenciar todo el juego y conservar el volumen elegido.
- **Video**: FOV, escala de resolución, sombras y su calidad, presupuesto de efectos, FPS y pantalla completa.
- **Controles**: sensibilidad, apuntado y reasignación persistente de 22 acciones. Si eliges una tecla ocupada, las dos funciones intercambian sus asignaciones.
- **Jugabilidad**: bunny-hop, balanceo del arma, sacudida de cámara, ping y estudio completo de mira personalizada.
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

**Mapas**: Arena (clásico) y Ciudad (calles y azoteas) — al final de cada partida la sala conserva su modo y vota el siguiente mapa (teclas 1/2). Ambos tienen **saltadores** (plataformas amarillas que te lanzan por los aires) y **cajas destruibles** (80 pv, reaparecen a los 45 s).

**Personalización y progresión**: en el menú puedes comprar **sombreros** (gorra/chistera/corona) y **colores** para tu muñeco con el dinero de las bajas — los ven todos los jugadores. Hay **3 misiones diarias** (+$300 cada una) y tu **insignia de nivel** (🥉🥈🥇👑 según tus bajas totales del ranking mundial) aparece junto a tu nombre.

## Modos de juego (online)

Antes de entrar eliges el modo y una de sus **dos salas online independientes**, cada una con máximo de 10 jugadores humanos. Al final hay podio y votación del siguiente mapa (teclas 1/2); el modo de la sala no cambia. Si están activados, los bots ocupan las plazas configuradas que queden libres.

- **Todos contra todos** — primero a 30 bajas o 5 minutos.
- **Equipos** 🔴🔵 — eliges bando al empezar (y cambias con `M`); los bots equilibran los equipos; sin fuego amigo.
- **Búsqueda del arma** — todos con la misma escalera: pistola → escopeta → subfusil → rifle → francotirador. Solo avanzas matando con el arma que te toca. Gana quien complete las 5.
- **Zombis** 🧟 — cooperativo: 8 oleadas de zombis cada vez más numerosos, rápidos y duros. Solo van al cuerpo a cuerpo. Sobrevivid todos juntos.

## Créditos

- Sonidos de disparo: ["Gunshot Sounds" de Tabasco](https://opengameart.org/content/gunshot-sounds), grabaciones reales bajo licencia CC0 (dominio público).

## Arquitectura

- `server/server.js` — HTTP estático + WebSocket, catálogo `/salas` y ocho motores de partida aislados. Estado autoritativo: vida, muertes, respawns, marcador y nº de bots.
- `server/botai.js` — IA de los bots en el servidor (patrulla, combate, ráfagas con probabilidad de acierto).
- `src/shared/` — mapa, física y selector de respawn seguro compartidos entre cliente y servidor.
- `src/lobby-catalog.js` — contrato compartido de modos, salas, capacidad, selección y ocupación.
- `src/net.js` — cliente WebSocket con selección estricta de sala (estado a 15 Hz, disparos, impactos).
- `src/remotes.js` — marionetas interpoladas de jugadores remotos y bots.
- `src/main.js` — arranque; modo online o local según haya servidor.
- El daño lo declara el cliente que dispara (suficiente para partidas entre amigos); el servidor valida rangos y lleva la puntuación.
