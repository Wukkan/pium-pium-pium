# Operador táctico AAA-lite

## Objetivo

Reemplazar el humanoide actual por un operador militar low-poly estilizado que se lea como un personaje de shooter AAA, sin perder la silueta cuadrada que funciona en el juego ni cambiar la cámara FPS del jugador local.

## Alcance

- Mejorar el personaje visible de bots y jugadores remotos.
- Mantener el modelo local invisible en primera persona; el jugador continúa viendo el arma FPS actual.
- Conservar los hitboxes existentes (`head`, `body`, `arm`, `leg`) para no alterar daño, headshots ni raycasts.
- Mantener sombreros, colores, nombres, insignias y armas equipadas.
- Mantener compatibilidad con bots offline y jugadores remotos online.
- No añadir modelos externos, dependencias ni descargas: el rig se construye con geometría nativa de Three.js.

## Dirección visual

El nuevo operador tendrá una base de proporciones compactas y cuadradas, pero con más lectura visual:

- torso con chaleco antibalas, placas frontales y bolsillos;
- cuello y cabeza protegidos por casco táctico con visera;
- hombros y antebrazos separados para evitar la apariencia de muñeco inflado;
- guantes oscuros, pantalones utilitarios y botas con suela;
- mochila o placa trasera para dar volumen en vista lateral;
- arma de bajo número de polígonos unida al brazo de apuntado;
- materiales separados para uniforme, piel, metal, visor y detalles del equipo;
- color del jugador aplicado al uniforme y conservado como personalización.

La geometría se mantendrá deliberadamente simple para que nueve bots y varios jugadores remotos no disparen el coste de renderizado. La calidad se obtiene mediante capas, silueta, contraste y postura, no mediante miles de polígonos.

## Animación y lectura en combate

- La animación de caminar continuará usando `humanoidPoseState` y añadirá balanceo leve del torso/equipo.
- Al apuntar, ambos brazos y el arma formarán una postura coherente; el casco y chaleco no deben deformarse.
- La animación de muerte conservará la caída actual del grupo completo.
- Las piezas golpeables seguirán en el rig y todas las piezas decorativas quedarán fuera de la lista de raycast.
- El arma remota se mostrará como una carabina compacta; no se pretende representar cada arma del inventario en esta primera iteración.

## Arquitectura

`src/humanoid.js` seguirá siendo el único constructor del rig compartido. Se añadirá una pequeña paleta/material factory local y grupos decorativos (`armor`, `headgear`, `equipment`) para que la pose solo transforme las articulaciones (`legL`, `legR`, `armL`, `armR`, `torso`). `src/remotes.js` y `src/bots.js` continuarán consumiendo `makeHumanoid` y no necesitarán conocer la geometría interna.

`src/ui-models.js` expondrá un perfil visual verificable con dimensiones y nombres de piezas principales. Los tests comprobarán que el perfil conserva la silueta blocky, añade equipo táctico y mantiene las cuatro categorías de hitbox.

## Criterios de aceptación

1. Un bot remoto u offline muestra casco, chaleco, brazos separados, pantalón, botas, equipo trasero y arma.
2. Los personajes se ven más proporcionados y militares que el modelo actual, pero siguen siendo cuadrados/low-poly.
3. Los raycasts siguen detectando cabeza, cuerpo, brazos y piernas sin detectar accesorios decorativos como impactos independientes.
4. La postura de apuntado y la caminata siguen funcionando.
5. La cámara local continúa siendo FPS y el arma del jugador no cambia de sistema.
6. Las pruebas existentes y las nuevas pasan; la página local responde con HTTP 200 y no registra errores de JavaScript al abrirse.

