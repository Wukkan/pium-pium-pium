# Arquitectura de PIUM PIUM PIUM

Esta guía fija límites para que el juego pueda crecer sin volver a concentrar todo el comportamiento en los archivos de entrada.

## Capas y dependencias

1. `src/shared/`: contratos y simulación pura usados por navegador y servidor. No pueden acceder a DOM, almacenamiento ni APIs exclusivas del navegador.
2. `server/`: autoridad de salas, combate, respawn, ranking y transporte. Puede importar contratos puros, nunca presentación del cliente.
3. `src/`: adaptadores de juego, render, audio, entrada y HUD. `main.js` compone sistemas; la lógica reutilizable debe vivir en módulos pequeños y probables.
4. `index.html`: estructura y estilos. No debe convertirse en fuente de reglas de partida.

Las reglas transversales tienen un solo dueño:

- `gameplay-policy.js`: movimiento, combate, audio y captura del mouse según estado/overlays.
- `shared/protocol.js`: versión y catálogo completo de mensajes WebSocket.
- `shared/network-limits.js`: origen, inactividad y backpressure.
- `shared/physics.js`, `spawn-safety.js` y `bot-navigation.js`: física, respawn y rutas idénticas en ambos mapas.

## Ciclos de vida

- Todo socket reemplazado se cierra mediante `Net.disconnect()` y pierde heartbeat/cadencia.
- Salir de una sesión online elimina callbacks, remotos, granadas, overlays, entradas y Pointer Lock.
- Recursos 3D temporales deben exponer `dispose()` y liberar geometrías, materiales, texturas y listeners.
- Una excepción de una sala queda aislada; no puede detener las otras salas.
- Una pestaña oculta no sondea el lobby ni reproduce combate ambiental.

## Presupuestos operativos

- Capacidad: 10 jugadores por sala y ocho salas fijas.
- Snapshot: 15 Hz; si el cliente acumula 256 KiB se omite estado reemplazable, a 1 MiB se cierra.
- Socket: 90 s sin mensajes válidos por defecto y máximo global explícito.
- Render inicial: DPR máximo 1.5 y sombras medias para usuarios nuevos; el menú permite personalizar calidad.
- Previews: se crean bajo demanda; no se monta el arsenal 3D durante el arranque.
- HUD: valores estables no deben provocar escrituras DOM repetidas.

## Cómo extender el juego

Antes de añadir una función:

1. Ubicar su regla en un módulo puro y dejar en `main.js` solo el cableado.
2. Si cruza la red, declarar el mensaje en `shared/protocol.js`, validar su forma y probar ambas direcciones.
3. Si crea timers, listeners, sockets o recursos WebGL/WebAudio, definir cómo se liberan.
4. Probar Arena y Ciudad, estados menu/playing/dead, overlays y reconexión.
5. Ejecutar `npm run check` y `npm audit --omit=dev`.

El workflow de GitHub bloquea sintaxis inválida, regresiones, límites arquitectónicos y dependencias vulnerables antes de desplegar.
