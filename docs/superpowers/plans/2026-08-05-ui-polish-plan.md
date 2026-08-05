# UI Polish and Match Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the end-of-match vote screen easier to read, move all weapon purchases into the `B` arsenal, remove rectangular bullet tracers, and give the main menu a professional operator/loadout presentation.

**Architecture:** Keep game state and purchase rules in the existing `WeaponSystem`, `HUD`, and `main.js` flow. The result screen will render explicit mode/map buttons while preserving keyboard voting. The main menu will use DOM/CSS presentation backed by the existing skin, owned-weapons, money, and current-weapon state.

**Tech Stack:** Vanilla HTML/CSS/ES modules, Three.js, existing WebSocket server, Node test runner.

## Global Constraints

- Keep the game on the local `main` branch; do not create a worktree or push remotely.
- Purchases happen only through the `B` arsenal; the bottom HUD must not show prices or purchase locks.
- The end-of-match countdown must be 30 seconds and remain readable on desktop and narrow screens.
- Remove rectangular `Effects.tracer` calls from local and remote bullet firing; retain the new particle muzzle/impact effects.
- Preserve existing online/offline modes, vote keys, owned weapon state, missions, skins, and grenade controls.

---

### Task 1: Lock in UI state behavior with tests

**Files:**
- Modify: `test/ui-models.test.js`
- Modify: `src/ui-models.js`
- Test: `test/ui-models.test.js`

**Interfaces:**
- Produce `weaponHudLabel(def)` returning a price-free HUD label.
- Produce `voteOptionsState(kinds, selected)` returning button metadata with `selected` state.

- [ ] **Step 1: Write failing tests**

Add assertions that a weapon HUD label never contains `$` or `🔒`, and that selected result options receive a selected class while unselected options do not.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run `npm.cmd test -- --test-name-pattern="price-free HUD|vote option state"`.
Expected: the tests fail because the new pure helpers do not exist.

- [ ] **Step 3: Implement the minimal helpers**

Implement the two pure helpers in `src/ui-models.js` without changing purchase or vote rules.

- [ ] **Step 4: Run the focused tests and confirm green**

Run `npm.cmd test -- --test-name-pattern="price-free HUD|vote option state"`.
Expected: both tests pass.

- [ ] **Step 5: Commit**

Run `git add src/ui-models.js test/ui-models.test.js; git commit -m "test: define polished hud and vote states"`.

### Task 2: Make the result screen large and readable for 30 seconds

**Files:**
- Modify: `index.html`
- Modify: `src/hud.js`
- Modify: `src/main.js`
- Modify: `server/server.js`
- Test: `test/ui-models.test.js`

**Interfaces:**
- `HUD.showPodium(data)` renders mode and map options into `#mode-vote-options` and `#map-vote-options`.
- Existing `HUD.setPodiumVotes` and `HUD.setPodiumCountdown` continue to update the same overlay.

- [ ] **Step 1: Add the button containers and failing DOM-state test**

Add separate mode/map containers and assert their state through `voteOptionsState` before implementation.

- [ ] **Step 2: Run the focused test and confirm failure**

Run `npm.cmd test -- --test-name-pattern="vote option state"`.
Expected: failure until the helper is implemented in Task 1.

- [ ] **Step 3: Implement the result UI**

Change `PODIUM_TIME` from `12` to `30`, render six large clickable options, preserve `[1]`–`[6]` keyboard voting, and style the panel at a much larger width with 22–30px buttons, visible headings, and a prominent countdown.

- [ ] **Step 4: Verify the result UI code paths**

Run `node --check src/main.js`, `node --check src/hud.js`, `node --check server/server.js`, and `npm.cmd test`.

- [ ] **Step 5: Commit**

Run `git add index.html src/hud.js src/main.js server/server.js test/ui-models.test.js; git commit -m "feat: polish thirty second match voting"`.

### Task 3: Restrict purchases to the CS-style arsenal

**Files:**
- Modify: `index.html`
- Modify: `src/hud.js`
- Modify: `src/main.js`
- Test: `test/ui-models.test.js`

**Interfaces:**
- `HUD.updateSlots(weapons)` renders only compact key/name hints with no price or lock text.
- `setBuyMenu(open)` remains the only in-match purchase overlay entry point.

- [ ] **Step 1: Add a regression assertion**

Assert that the price-free weapon label helper produces `[4] RIFLE` rather than a price/lock label.

- [ ] **Step 2: Run the focused test and confirm failure**

Run `npm.cmd test -- --test-name-pattern="price-free HUD"`.
Expected: failure before the helper exists.

- [ ] **Step 3: Remove purchase text from the bottom HUD**

Use `weaponHudLabel` from `src/ui-models.js` in `HUD.updateSlots`, keep the equipped highlight and `[R] Recargar`, and leave purchase cards/buttons only in `#buy-menu`.

- [ ] **Step 4: Make the arsenal more explicit**

Keep `B` as the toggle, add an `ESC`/click-close affordance if needed, and preserve mouse plus `1`–`7` purchase/equip behavior while the overlay is open.

- [ ] **Step 5: Run verification and commit**

Run `npm.cmd test`, syntax checks for `src/main.js` and `src/hud.js`, then commit with `git commit -m "feat: keep weapon purchases inside arsenal"`.

### Task 4: Remove rectangular bullet tracers and improve the main menu loadout

**Files:**
- Modify: `src/weapons.js`
- Modify: `src/main.js`
- Modify: `index.html`
- Modify: `src/hud.js`
- Test: `test/ui-models.test.js`

**Interfaces:**
- Weapon firing continues to call `effects.muzzle` and hit/impact effects, but no longer calls `effects.tracer` for bullets.
- The menu loadout renderer reflects current weapon, owned weapons, grenades, hat, and color.

- [ ] **Step 1: Add a loadout metadata test**

Assert that the menu loadout can represent current weapon, grenade count, and equipped skin without adding new game state.

- [ ] **Step 2: Run the focused test and confirm failure**

Run `npm.cmd test -- --test-name-pattern="loadout metadata"`.
Expected: failure before the pure metadata helper exists.

- [ ] **Step 3: Remove rectangular tracer calls**

Delete the local `effects.tracer(muzzle, end)` calls and remote `effects.tracer(a, b, ...)` calls. Keep the particle muzzle flashes, launcher trail, hit impacts, and explosion effects.

- [ ] **Step 4: Build the professional menu loadout panel**

Add a left operator card with a stylized avatar and a right equipment card with weapon/skin/grenade chips. Update it whenever the menu opens, after purchases, and after skin changes. Keep missions and money visible as secondary information.

- [ ] **Step 5: Run all checks and commit**

Run `npm.cmd test`, `node --check src/main.js`, `node --check src/weapons.js`, `node --check src/hud.js`, and `git diff --check`; commit with `git commit -m "feat: refresh main menu and remove bullet tracers"`.

### Task 5: Final local verification and user handoff

**Files:**
- Verify: `index.html`, `src/main.js`, `src/hud.js`, `src/weapons.js`, `server/server.js`

- [ ] **Step 1: Run the complete test suite**

Run `npm.cmd test`; expected result is 0 failures.

- [ ] **Step 2: Run syntax and whitespace checks**

Run `node --check src/main.js; node --check src/hud.js; node --check src/weapons.js; node --check server/server.js; git diff --check`.

- [ ] **Step 3: Verify the local server serves the new page**

Run `Invoke-WebRequest http://localhost:5173/` and confirm status `200`, then refresh the user-facing browser.

- [ ] **Step 4: Tell the user exactly what to test**

Ask the user to test: `B` arsenal purchase, no prices in the bottom HUD, firing without a square tracer, end screen readability and 30-second countdown, clickable vote buttons, and the professional loadout panel in the main menu.
