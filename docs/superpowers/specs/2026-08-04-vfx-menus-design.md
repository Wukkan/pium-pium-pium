# Diseño: VFX con three.quarks y menús mejorados

## Objetivo

Mejorar la lectura y la calidad visual de PIUM PIUM PIUM sin cambiar su estilo arcade ni sus reglas actuales. La actualización cubrirá efectos de disparos, impactos, explosiones y proyectiles, además de una interfaz más clara para el arsenal, el arma equipada y la votación al terminar una partida.

## Alcance aprobado

### Efectos visuales

- Integrar `three.quarks` como sistema de partículas local, manteniendo un `BatchedRenderer` compartido.
- Conservar `src/effects.js` como interfaz estable para no modificar todos los consumidores existentes.
- Mejorar los eventos siguientes:
  - disparo: fogonazo de boca y humo breve;
  - impacto: chispas y polvo según superficie;
  - explosión: núcleo de fuego, onda expansiva y fragmentos;
  - lanzagranadas: rastro ligero y explosión de impacto.
- Limitar la cantidad de partículas y destruir automáticamente las instancias terminadas.
- Mantener los efectos actuales como respaldo si la inicialización de Quarks no está disponible.

### Menú principal y arsenal

- Añadir una sección `ARSENAL` al menú principal con tarjetas grandes para las siete armas.
- Cada tarjeta mostrará nombre, precio, estado (`COMPRAR`, `EQUIPADA` o `EQUIPAR`) y una descripción corta.
- Reutilizar `WeaponSystem.tryBuy`, `switchTo` y el dinero ya existente; no duplicar las reglas de economía.
- Guardar armas compradas/equipadas en `localStorage` para que sobrevivan a una recarga.

### HUD durante la partida

- Mantener la compra rápida actual con las teclas `[1]-[7]`.
- Hacer más legible el panel lateral: ranura activa, arma equipada, munición, reserva y precios de armas bloqueadas.
- No añadir una tienda que pause o interrumpa la partida; el flujo durante la partida seguirá siendo el actual.

### Fin de partida

- Convertir las opciones de modo y mapa en botones grandes para mouse/táctil.
- Mantener las teclas `[1]-[6]` como alternativa.
- Mostrar estados hover, seleccionado y bloqueado, además del conteo de votos.
- Mantener el podio y la cuenta regresiva sin ocultar la información importante.

### Adaptación visual

- Aumentar tamaños de controles, áreas clicables y contraste.
- Ajustar tarjetas y botones a pantallas estrechas mediante reglas responsive.
- Preservar la estética actual: colores dorados para acciones principales, azul para información y rojo para daño/peligro.

## Arquitectura y flujo de datos

1. `src/effects.js` crea el adaptador y expone los métodos existentes.
2. `src/quarks-effects.js` encapsula el `BatchedRenderer`, los sistemas de partículas y su ciclo de vida.
3. `src/main.js` inicializa el adaptador y llama a su actualización desde el bucle principal.
4. `src/weapons.js` sigue siendo la fuente de verdad para precios, propiedad, equipamiento y munición.
5. `src/hud.js` renderiza el arsenal, el arma activa y los botones de votación; sus callbacks delegan en `WeaponSystem` o `Net`.
6. `index.html` contiene el marcado y los estilos de los nuevos paneles y estados visuales.

La dependencia se instalará desde npm y su módulo compilado se servirá localmente para mantener el despliegue estático existente, sin exigir un bundler ni un CDN en tiempo de ejecución.

## Errores y compatibilidad

- Si Quarks no puede inicializarse, `Effects` usará las partículas Mesh/Sprite actuales.
- Una compra sin dinero suficiente conservará el aviso y el sonido de error actuales.
- Los botones de votación no enviarán votos duplicados desde la misma selección visible; el servidor seguirá siendo la autoridad del resultado.
- El modo online y el modo local compartirán los mismos efectos y controles de interfaz.

## Verificación

- Ejecutar el servidor local y comprobar que la aplicación arranca sin errores de módulo.
- Probar compra, equipamiento, saldo insuficiente y persistencia de armas.
- Probar que `[1]-[7]` sigue comprando/equipando durante la partida.
- Probar votos con teclado y mouse/táctil en el podio.
- Provocar disparos, impactos, granadas, lanzagranadas y destrucción de cajas; comprobar limpieza de efectos.
- Revisar el menú, el podio y el HUD en escritorio y viewport estrecho.

## Decisiones descartadas

- Reescritura completa de todos los efectos con Quarks: demasiado riesgo para el alcance actual.
- Sustituir Quarks por mejoras únicamente con geometrías existentes: no aprovecha la librería solicitada.
- Tienda interactiva durante la partida: se conserva el sistema rápido actual para no interrumpir el combate.
