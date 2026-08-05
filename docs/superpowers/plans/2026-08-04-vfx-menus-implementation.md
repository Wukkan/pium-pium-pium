# VFX and Menus Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate local `three.quarks` particle effects and improve the arsenal, in-game weapon panel, and end-of-match voting controls without changing the existing combat economy or keyboard flow.

**Architecture:** Keep `Effects` as the stable facade used by weapons, grenades, bots, crates, and network events. Add a `QuarksEffects` backend with a shared `BatchedRenderer`; each public effect calls Quarks when available and the current Mesh/Sprite implementation otherwise. Keep menu rendering in the existing HUD/main flow, with pure state helpers tested independently from the browser DOM.

**Tech Stack:** Native ES modules, Three.js r166 from `vendor/three.module.js`, `three.quarks` 0.16.0 vendored from npm (compatible with Three.js r166), Node's built-in `node:test`, existing Node/WebSocket static server.

## Global Constraints

- Preserve the current arcade-military visual style and gameplay rules.
- Keep `[1]-[7]` as the in-game buy/equip flow; do not add a shop that pauses combat.
- Keep `[1]-[6]` as keyboard fallbacks for end-of-match votes.
- Serve the Quarks module locally; do not require a CDN at runtime.
- Keep an effects fallback so existing Mesh/Sprite effects remain available if Quarks initialization fails.
- Reuse `WeaponSystem` as the source of truth for prices, ownership, equip state, and money.
- Work directly in the current local checkout on `main`, per user instruction.

---

### Task 1: Add tested UI and persistence state helpers

**Files:**
- Create: `src/ui-models.js`
- Create: `test/ui-models.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces `weaponCardState(def, owned, current, money)` returning `{ status, label, affordable }`.
- Produces `voteButtonState(kind, selected)` returning `{ className, label }`.
- Produces `readOwnedWeapons(raw, validKeys)` returning a safe owned-key object with pistol always enabled.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { weaponCardState, voteButtonState, readOwnedWeapons } from '../src/ui-models.js';

test('weapon cards distinguish equipped, owned, affordable, and locked weapons', () => {
  const def = { name: 'ESCOPETA', price: 300 };
  assert.deepEqual(weaponCardState(def, true, false, 0), {
    status: 'owned', label: 'EQUIPAR', affordable: false,
  });
  assert.deepEqual(weaponCardState(def, false, false, 400), {
    status: 'buy', label: 'COMPRAR $300', affordable: true,
  });
  assert.deepEqual(weaponCardState(def, false, false, 100), {
    status: 'locked', label: 'FALTAN $200', affordable: false,
  });
  assert.deepEqual(weaponCardState(def, true, true, 0), {
    status: 'equipped', label: 'EQUIPADA', affordable: false,
  });
});

test('vote buttons expose selected state without changing the vote label', () => {
  assert.deepEqual(voteButtonState('ciudad', false), {
    className: 'vote-option', label: 'CIUDAD',
  });
  assert.deepEqual(voteButtonState('ciudad', true), {
    className: 'vote-option selected', label: 'CIUDAD ✓',
  });
});

test('owned weapons are sanitized and pistol is always available', () => {
  assert.deepEqual(readOwnedWeapons(['shotgun', 'invalid', 'pistol'], ['pistol', 'shotgun']), {
    pistol: true, shotgun: true,
  });
  assert.deepEqual(readOwnedWeapons('bad data', ['pistol', 'shotgun']), { pistol: true });
});
```

- [ ] **Step 2: Run tests and verify the expected failure**

Run: `npm.cmd test -- --test-name-pattern="weapon cards|vote buttons|owned weapons"`

Expected: FAIL because `src/ui-models.js` does not exist yet.

- [ ] **Step 3: Implement the minimal helpers**

Implement the three named exports with no DOM dependency. `weaponCardState` must return `equipped` before `owned`, then `buy` when `money >= price`, otherwise `locked`. `readOwnedWeapons` must accept only an array, filter against `validKeys`, and force `pistol: true`.

- [ ] **Step 4: Add the test script and run the focused tests**

Add this script to `package.json`:

```json
"test": "node --test"
```

Run: `npm.cmd test -- --test-name-pattern="weapon cards|vote buttons|owned weapons"`

Expected: PASS with 3 tests and 0 failures.

- [ ] **Step 5: Commit**

```powershell
git add package.json src/ui-models.js test/ui-models.test.js
git commit -m "test: add ui state helpers for arsenal and votes"
```

### Task 2: Install and expose the local Quarks module

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vendor/three.quarks.module.js`
- Create: `vendor/quarks.core.module.js`
- Modify: `index.html` import map

**Interfaces:**
- Produces a browser-resolvable `three.quarks` import mapped to `/vendor/three.quarks.module.js`.

- [ ] **Step 1: Add the pinned dependency**

Run: `npm.cmd install three.quarks@0.16.0 --save-exact`

Expected: `package.json` and `package-lock.json` contain `three.quarks` at `0.16.0`.

- [ ] **Step 2: Verify the package entrypoint**

Run: `Get-ChildItem node_modules/three.quarks/build; Get-Content node_modules/three.quarks/package.json | Select-String 'module|exports'`

Expected: the package exposes an ES module build that imports the existing `three` import-map specifier.

- [ ] **Step 3: Vendor the browser module**

Copy the package's ES module build to `vendor/three.quarks.module.js` with `Copy-Item`. Do not edit generated vendor code except to preserve the `three` specifier if the package build uses it.

- [ ] **Step 4: Extend the import map**

Add `"three.quarks": "/vendor/three.quarks.module.js"` and `"quarks.core": "/vendor/quarks.core.module.js"` entries beside the existing `three` entry in `index.html`, because the vendored Quarks build imports its core package by name.

- [ ] **Step 5: Verify module loading without changing app behavior**

Run: `node --check src/main.js; node --check src/effects.js`

Expected: both commands exit 0; the import-map source remains valid JSON.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json vendor/three.quarks.module.js vendor/quarks.core.module.js index.html
git commit -m "build: add local three.quarks runtime"
```

### Task 3: Add the Quarks effects backend and connect combat events

**Files:**
- Create: `src/quarks-effects.js`
- Modify: `src/effects.js`
- Modify: `src/weapons.js`
- Modify: `src/grenades.js`
- Modify: `src/main.js`
- Create: `test/quarks-effects.test.js`

**Interfaces:**
- `QuarksEffects(scene)` owns one `BatchedRenderer` and exposes `update(dt)`, `muzzle(pos, kind)`, `impact(pos, color, count)`, `explosion(pos)`, and `trail(from, to, color)`.
- `Effects` delegates to Quarks when initialized and retains the existing methods as fallback.

- [ ] **Step 1: Write failing backend contract tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { clampParticleCount, effectLifetime } from '../src/quarks-effects.js';

test('particle counts stay within the combat budget', () => {
  assert.equal(clampParticleCount(2, 1, 24), 2);
  assert.equal(clampParticleCount(80, 1, 24), 24);
  assert.equal(clampParticleCount(0, 1, 24), 1);
});

test('effect lifetimes are bounded for automatic cleanup', () => {
  assert.equal(effectLifetime('muzzle'), 0.12);
  assert.equal(effectLifetime('explosion'), 0.65);
  assert.equal(effectLifetime('unknown'), 0.35);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npm.cmd test -- --test-name-pattern="particle counts|effect lifetimes"`

Expected: FAIL because the named exports do not exist.

- [ ] **Step 3: Implement the tested helpers and backend**

Implement the helpers first, then create the Quarks backend using `BatchedRenderer`, `ParticleSystem`, `ConstantValue`, `IntervalValue`, `ConstantColor`, `PointEmitter`, and `RenderMode`. Use non-looping short-lived systems for bursts, an additive unlit material for flash/fire, and a darker transparent material for smoke/dust. Cap burst counts through `clampParticleCount`, register every system with the shared renderer, and remove completed emitters through Quarks auto-destroy behavior or an explicit lifetime list.

- [ ] **Step 4: Run the backend tests**

Run: `npm.cmd test -- --test-name-pattern="particle counts|effect lifetimes"`

Expected: PASS with 2 tests and 0 failures.

- [ ] **Step 5: Connect the stable facade**

In `Effects`, construct `QuarksEffects` inside a guarded block. Add `muzzle` and `trail` methods, and delegate `impact`/`explosion` to Quarks while still executing the old fallback when Quarks is unavailable. `update(dt)` must update both the Quarks batch renderer and fallback item list. Keep popup damage numbers unchanged.

- [ ] **Step 6: Connect local and remote firing**

In `weapons.js`, call `effects.muzzle` at the computed muzzle position on every local shot and leave existing tracer logic intact. In `main.js`, call `effects.muzzle` for remote `net.on('fire')` events and call `effects.trail` only for the launcher projectile path. In `grenades.js`, keep the existing gameplay timing and call the new explosion effect at the same damage event.

- [ ] **Step 7: Run all automated tests and syntax checks**

Run: `npm.cmd test; node --check src/main.js; node --check src/effects.js; node --check src/quarks-effects.js`

Expected: all tests pass and every syntax check exits 0.

- [ ] **Step 8: Commit**

```powershell
git add src/quarks-effects.js src/effects.js src/weapons.js src/grenades.js src/main.js test/quarks-effects.test.js
git commit -m "feat: add batched quarks combat effects"
```

### Task 4: Add persistent arsenal cards and larger HUD weapon panel

**Files:**
- Modify: `src/weapons.js`
- Modify: `src/hud.js`
- Modify: `src/main.js`
- Modify: `index.html`
- Modify: `test/ui-models.test.js`

**Interfaces:**
- `WeaponSystem.restoreOwned(keys)` restores only valid weapons and keeps pistol enabled.
- `WeaponSystem.onChanged` is called after purchase/equip so menu state and `localStorage` stay synchronized.
- `HUD.renderArsenal(weapons, onAction)` renders safe text-based cards and invokes `onAction(key)` for a clicked card.

- [ ] **Step 1: Extend tests for loadout restoration**

Add a test for `readOwnedWeapons(['launcher'], ['pistol', 'launcher'])` returning `{ pistol: true, launcher: true }`, and a test that an invalid persisted value never grants an unknown key.

- [ ] **Step 2: Run the test and confirm the new expectation fails**

Run: `npm.cmd test -- --test-name-pattern="loadout|owned weapons"`

Expected: FAIL until the helper and `WeaponSystem.restoreOwned` path are complete.

- [ ] **Step 3: Add ownership restore/change hooks**

In `WeaponSystem`, add `onChanged = null`, `restoreOwned(keys)`, and invoke `onChanged?.()` after `tryBuy` and `_equip`. In `main.js`, read `localStorage.getItem('pium_weapons')`, sanitize with `readOwnedWeapons`, restore it once after construction, and save the owned key list from `onChanged`.

- [ ] **Step 4: Implement the arsenal renderer**

Add a menu `#arsenal-list` and make `HUD.renderArsenal` create buttons with `textContent` for names, prices, and states. Its click callback must call `onAction(key)` and never inject user-controlled HTML. Wire the callback to buy or equip through `weapons.tryBuy`/`weapons.switchTo`, then refresh menu panels and HUD money/slots.

- [ ] **Step 5: Enlarge and clarify the in-game panel**

Update `HUD.updateSlots` to include all seven slots, the active `current` weapon, an explicit `EQUIPADA`/`BLOQUEADA` cue, and prices. Update CSS so the active weapon and ammo have a readable minimum size while keeping the panel anchored to the lower-right.

- [ ] **Step 6: Run tests and syntax checks**

Run: `npm.cmd test; node --check src/weapons.js; node --check src/hud.js; node --check src/main.js`

Expected: all tests pass and syntax checks exit 0.

- [ ] **Step 7: Commit**

```powershell
git add src/weapons.js src/hud.js src/main.js index.html test/ui-models.test.js
git commit -m "feat: add persistent arsenal menu and clearer weapon hud"
```

### Task 5: Add large mouse/touch voting buttons to the podium

**Files:**
- Modify: `src/hud.js`
- Modify: `src/main.js`
- Modify: `index.html`
- Modify: `test/ui-models.test.js`

**Interfaces:**
- `HUD.showPodium(data, { onModeVote, onMapVote })` renders vote buttons and binds callbacks.
- `HUD.markVote(kind)` marks the local selection without changing server tally data.

- [ ] **Step 1: Add vote state tests**

Test that mode and map options produce the expected labels and selected class through `voteButtonState`.

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run: `npm.cmd test -- --test-name-pattern="vote"`

Expected: FAIL until the selected state and option model are implemented.

- [ ] **Step 3: Implement podium buttons**

Replace the text-only vote hint with two button groups: `#mode-votes` and `#map-votes`. `HUD.showPodium` must create six buttons, use keyboard labels in their text, and call the provided callback with `ffa`, `teams`, `gun`, `zombies`, `arena`, or `ciudad`. `main.js` must pass callbacks that call `net.sendVote`/`net.sendMapVote` and then `hud.markVote`.

- [ ] **Step 4: Preserve keyboard voting**

Leave the existing `keydown` mapping in `main.js` active; update it to call the same `markVote` method after sending a vote so both input paths share the selected visual state.

- [ ] **Step 5: Style the podium responsively**

Give vote buttons pointer events, minimum 52px height, larger text, visible hover/active/selected/disabled states, and a two-column layout that collapses to one column below 620px. Keep the podium scrollable if its content exceeds the viewport height.

- [ ] **Step 6: Run tests and syntax checks**

Run: `npm.cmd test; node --check src/hud.js; node --check src/main.js`

Expected: all tests pass and syntax checks exit 0.

- [ ] **Step 7: Commit**

```powershell
git add src/hud.js src/main.js index.html test/ui-models.test.js
git commit -m "feat: add large podium vote buttons"
```

### Task 6: Full verification and local smoke test

**Files:**
- Modify only if verification finds a concrete defect.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm.cmd test`

Expected: 0 failures and no uncaught warnings.

- [ ] **Step 2: Check all changed JavaScript syntax**

Run: `rg --files src test | Where-Object { $_ -like '*.js' } | ForEach-Object { node --check $_ }`

Expected: every command exits 0.

- [ ] **Step 3: Start the local server**

Run: `node server/server.js`

Expected: the server listens on the existing local port without startup errors.

- [ ] **Step 4: Verify the static entrypoint**

Run in another terminal: `Invoke-WebRequest http://localhost:5173/ -UseBasicParsing`

Expected: HTTP 200 and the response contains the `three.quarks` import-map entry.

- [ ] **Step 5: Perform the manual gameplay checklist**

Open `http://localhost:5173`, start a local match, and verify: arsenal cards buy/equip correctly; `[1]-[7]` still buys during combat; muzzle flashes, impacts, explosion, grenade, launcher trail, and crate destruction create and clean effects; the weapon panel clearly marks the active weapon; the podium buttons vote with mouse and keyboard; narrow viewport layout remains usable.

- [ ] **Step 6: Review the final diff and status**

Run: `git diff HEAD~5..HEAD --stat; git status --short; git diff --check HEAD~5..HEAD`

Expected: only files related to the approved feature changed, no whitespace errors, and the working tree is clean before reporting completion.
