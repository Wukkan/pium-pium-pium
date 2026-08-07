# Tactical Operator AAA-lite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current remote/bot humanoid with a compact tactical operator that looks more like a AAA shooter character while preserving FPS view, hitboxes, online snapshots, and low-poly performance.

**Architecture:** Keep `src/humanoid.js` as the single rig factory consumed by `src/remotes.js` and `src/bots.js`. Extend the existing profile/pose helpers in `src/ui-models.js`, then use named visual groups for armor and equipment while only the existing limb groups move during animation. No external model files or runtime dependencies are introduced.

**Tech Stack:** Three.js native geometries/materials, ES modules, Node's built-in test runner, existing browser smoke test on `http://localhost:5173/`.

## Global Constraints

- Preserve the raycast hitbox part names `head`, `body`, `arm`, and `leg`.
- Keep the local player in first-person; only bots and remote players use this visible rig.
- Keep hats, colors, names, badges, bots, and remote player snapshots working.
- Use native Three.js geometry; do not add a GLB download or a new dependency.
- Keep the rig low-poly enough for the existing offline bot count and online remote count.
- Use `apply_patch` for source edits and write tests before production changes.

---

### Task 1: Extend the visual profile contract

**Files:**
- Modify: `src/ui-models.js` near `humanoidModelProfile()` and `humanoidPoseState()`
- Modify: `test/ui-models.test.js` near the existing humanoid profile/pose tests

**Interfaces:**
- Produces `humanoidModelProfile()` fields `body`, `limb`, `leg`, `helmet`, `vest`, `shoulder`, `boot`, `backpack`, and `hitParts`.
- Keeps `humanoidPoseState(time, speed, aiming, aimPitch)` return fields unchanged so `src/humanoid.js` and its tests remain compatible.

- [ ] **Step 1: Write the failing profile test**

```js
test('tactical operator profile keeps blocky hitboxes and adds equipment layers', () => {
  const profile = humanoidModelProfile();
  assert.deepEqual(profile.hitParts, ['head', 'body', 'arm', 'leg']);
  assert.ok(profile.helmet[0] > profile.body[0] * 0.5);
  assert.ok(profile.vest[2] > profile.body[2]);
  assert.ok(profile.boot[2] > profile.leg[2]);
  assert.ok(profile.backpack[2] > 0);
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run: `npm.cmd test -- --test-name-pattern="tactical operator profile"`

Expected: FAIL because the current profile has no `hitParts`, `helmet`, `vest`, `boot`, or `backpack` fields.

- [ ] **Step 3: Add the minimal profile fields**

Return the existing dimensions plus the following low-poly visual dimensions from `humanoidModelProfile()`:

```js
helmet: [0.5, 0.2, 0.46],
vest: [0.72, 0.68, 0.42],
shoulder: [0.22, 0.18, 0.3],
boot: [0.27, 0.16, 0.42],
backpack: [0.48, 0.68, 0.2],
hitParts: ['head', 'body', 'arm', 'leg'],
```

- [ ] **Step 4: Run the focused test and the complete suite**

Run: `npm.cmd test -- --test-name-pattern="tactical operator profile"`

Expected: PASS.

Run: `npm.cmd test`

Expected: all existing tests plus the new test pass.

- [ ] **Step 5: Commit the contract**

```powershell
git add src/ui-models.js test/ui-models.test.js
git commit -m "test: define tactical operator profile"
```

### Task 2: Build the tactical operator rig

**Files:**
- Modify: `src/humanoid.js` in `makeHumanoid()` and `makeHat()` only
- Test: `test/ui-models.test.js` uses the profile contract; no renderer test is required for geometry internals

**Interfaces:**
- Consumes `humanoidModelProfile()` from Task 1.
- Produces the same rig object fields: `group`, `parts`, `torso`, `body`, `legL`, `legR`, `armL`, `armR`, `head`, `gun`, `nameSprite`.
- Keeps every hitbox mesh created through `userDataFor(partName)` and keeps decorative meshes without a hit part name.

- [ ] **Step 1: Add reusable low-poly material and geometry helpers inside `makeHumanoid()`**

Create local materials for `uniform`, `uniformDark`, `armor`, `armorEdge`, `skinTone`, `pants`, `boot`, `glove`, `metal`, `visor`, and `gunMat`. Add a `roundedBox` helper using `THREE.BoxGeometry` and a `detailBox` helper that creates a non-hitbox mesh under a named equipment group.

- [ ] **Step 2: Replace the torso visuals while retaining the body hitbox**

Keep the existing body hitbox box and add a larger tactical vest shell without a part name. Add two front plate details, two chest pouches, a belt strip, and a small shoulder collar. Parent these meshes to `body` or an `armor` group under `torso`; do not attach them to `parts`.

- [ ] **Step 3: Replace the head visuals while retaining the head hitbox**

Keep the existing head hitbox and add a helmet shell, helmet rim, dark visor, and small side headset blocks. Parent the helmet to `torso`, place it above the hitbox, and keep the existing purchased hat as an additional cosmetic layer when present.

- [ ] **Step 4: Improve limbs, boots, and back equipment**

Keep the existing arm and leg hitboxes. Add separate glove meshes at the limb ends, shoulder pads near each arm root, knee pads near each leg, boot blocks with toe projection, belt pouches, and a backpack behind the torso. Set `castShadow = true` on opaque meshes and `castShadow = false` on the name sprite/visor where appropriate.

- [ ] **Step 5: Improve the remote weapon silhouette**

Keep `rig.gun` as the animated weapon group. Add a stock, receiver, barrel, sight, magazine, and muzzle piece as decorative meshes inside it. Keep its pivot and existing rotation behavior so the aiming pose remains compatible.

- [ ] **Step 6: Run syntax and regression tests**

Run: `node --check src/humanoid.js; npm.cmd test`

Expected: exit code 0 and all tests pass.

- [ ] **Step 7: Commit the rig**

```powershell
git add src/humanoid.js
git commit -m "feat: build tactical operator character rig"
```

### Task 3: Refine animation for equipment-aware movement

**Files:**
- Modify: `src/humanoid.js` in `animateHumanoid()`
- Modify: `src/ui-models.js` only if a new pose value is required
- Modify: `test/ui-models.test.js` near the existing humanoid pose test

**Interfaces:**
- Keeps the existing `animateHumanoid(rig, dt, speed, walkTimeRef, aiming, aimPitch)` signature.
- Keeps `humanoidPoseState()` fields `legL`, `legR`, `armL`, `armR`, `armLx`, `armRx`, `armLz`, `armRz`, `gunRotationX`, and `bodyY` stable.

- [ ] **Step 1: Write a failing pose assertion for tactical aiming**

```js
test('tactical aiming pose keeps the weapon and support arms aligned', () => {
  const pose = humanoidPoseState(0.5, 0, true, 0.2);
  assert.equal(pose.armLx, -0.24);
  assert.equal(pose.armRx, 0.24);
  assert.equal(pose.gunRotationX, Math.PI / 2);
  assert.ok(pose.armLz > 0);
  assert.ok(pose.armRz < 0);
});
```

- [ ] **Step 2: Run the focused test and verify it fails if the current pose contract differs**

Run: `npm.cmd test -- --test-name-pattern="tactical aiming pose"`

Expected: PASS if the existing contract already satisfies the behavior; if it passes, treat it as a regression contract and do not change the pose API. If it fails, adjust the smallest pose values needed to satisfy it.

- [ ] **Step 3: Add equipment motion without changing the public pose contract**

In `animateHumanoid()`, apply a small torso Y/Z sway and a matching `rig.equipment` sway if that group exists. Keep the sway bounded to at most `0.025` radians and avoid changing hitbox transforms independently from their existing joints.

- [ ] **Step 4: Run all tests and syntax checks**

Run: `npm.cmd test; node --check src/humanoid.js; node --check src/ui-models.js`

Expected: all tests pass with no syntax errors.

- [ ] **Step 5: Commit the animation refinement**

```powershell
git add src/humanoid.js src/ui-models.js test/ui-models.test.js
git commit -m "feat: refine tactical operator movement"
```

### Task 4: Browser smoke test and final verification

**Files:**
- No source changes expected unless verification finds a concrete regression.

**Interfaces:**
- Verifies the existing local server at `http://localhost:5173/`.
- Verifies both offline bot rendering and online remote rendering paths through the shared factory.

- [ ] **Step 1: Start or confirm the local server**

Run: `Invoke-WebRequest -UseBasicParsing http://localhost:5173/`

Expected: HTTP 200. If refused, start `server/server.js` from the repository root and retry.

- [ ] **Step 2: Load the game in the browser**

Open the local page, inspect the console for errors, enter a player name, and start a match. Confirm the local first-person weapon remains visible and the camera stays FPS.

- [ ] **Step 3: Inspect a visible bot or remote player**

Confirm the character has a helmet, vest, separated limbs, gloves/boots, backpack/equipment, and a recognizable weapon silhouette. Confirm the name label remains above the character.

- [ ] **Step 4: Run final automated verification**

Run:

```powershell
npm.cmd test
node --check src/humanoid.js
node --check src/remotes.js
node --check src/bots.js
git diff --check
$resp = Invoke-WebRequest -UseBasicParsing http://localhost:5173/
"HTTP $($resp.StatusCode) BYTES $($resp.RawContentLength)"
git status --short
```

Expected: all tests pass, syntax checks pass, HTTP 200, no diff-check output, and only intentional committed changes remain.

- [ ] **Step 5: Commit any verified final adjustment**

```powershell
git add src/humanoid.js src/ui-models.js test/ui-models.test.js docs/superpowers/specs/2026-08-06-tactical-operator-design.md docs/superpowers/plans/2026-08-06-tactical-operator-plan.md
git commit -m "feat: ship AAA-lite tactical operator"
```

