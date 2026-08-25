import test from 'node:test';
import assert from 'node:assert/strict';
import {
  weaponCardState,
  voteButtonState,
  readOwnedWeapons,
  ammoAfterPickup,
  weaponHudLabel,
  voteOptionsState,
  loadoutMetadata,
  weaponSelectionAction,
  humanoidPoseState,
  weaponAnimationState,
  humanoidModelProfile,
  readSettings,
  CROSSHAIR_PRESETS,
  crosshairPresentation,
  crosshairFeedbackPixels,
  projectSpreadToPixels,
  shotCrosshairKickPixels,
  applyCrosshairPreset,
  effectiveMasterVolume,
  effectivePixelRatio,
  menuNavState,
  buyMenuCategoryState,
  podiumStageState,
  botPanelState,
  isBotConfigAcknowledgement,
  shotTracerState,
} from '../src/ui-models.js';
import { buildGunModel } from '../src/weapons.js';

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

test('ammo pickups add twenty rounds without exceeding the reserve cap', () => {
  assert.equal(ammoAfterPickup(12, 20, 144), 32);
  assert.equal(ammoAfterPickup(140, 20, 144), 144);
});

test('price-free HUD labels never expose purchase text', () => {
  const label = weaponHudLabel({ name: 'RIFLE' }, 3);
  assert.equal(label, '[4] RIFLE');
  assert.doesNotMatch(label, /[$🔒]/);
});

test('vote option state marks only the selected option', () => {
  const options = voteOptionsState(['ffa', 'teams', 'gun'], 'teams');
  assert.equal(options.find((option) => option.kind === 'teams').className, 'vote-option selected');
  assert.equal(options.find((option) => option.kind === 'ffa').className, 'vote-option');
});

test('loadout metadata exposes the equipped player presentation', () => {
  assert.deepEqual(loadoutMetadata(
    { current: 'smg', owned: { pistol: true, smg: true } },
    { hat: 'cap', color: 0xe05252 },
    2,
  ), {
    weapon: 'smg', ownedWeapons: ['pistol', 'smg'], grenades: 2, hat: 'cap', color: 0xe05252,
  });
});

test('locked weapon selection opens the arsenal instead of buying immediately', () => {
  assert.equal(weaponSelectionAction(true), 'equip');
  assert.equal(weaponSelectionAction(false), 'open-buy');
});

test('humanoid pose keeps limbs mirrored while walking and aims both arms', () => {
  const walking = humanoidPoseState(Math.PI / 2, 5.2, false);
  assert.equal(walking.legL, -walking.legR);
  assert.equal(walking.armL, -walking.legL * 0.7);
  assert.equal(walking.armR, walking.legL * 0.7);

  const aiming = humanoidPoseState(0, 0, true, 0.25);
  assert.equal(aiming.armL, aiming.armR);
  assert.ok(aiming.armL < -Math.PI / 2);
  assert.ok(Math.abs(aiming.armLx) < 0.3);
  assert.ok(Math.abs(aiming.armRx) < 0.3);
  assert.equal(aiming.gunRotationX, Math.PI / 2);
});

test('weapon animation state adds bob, recoil and a visible reload motion', () => {
  const idle = weaponAnimationState({
    speed: 0, ads: false, reloading: false, reloadProgress: 0,
    bobTime: 0, kickPos: 0, kickRot: 0,
  });
  assert.deepEqual(idle.position, { x: 0.32, y: -0.3, z: -0.55 });

  const reload = weaponAnimationState({
    speed: 7, ads: false, reloading: true, reloadProgress: 0.5,
    bobTime: 1.2, kickPos: 0.08, kickRot: 0.2,
  });
  assert.ok(reload.position.y < -0.3);
  assert.ok(reload.rotation.x < -0.4);
  assert.ok(Math.abs(reload.position.x - idle.position.x) > 0.001);

  const noBob = weaponAnimationState({ speed: 7, bobTime: 1.2, bobAmount: 0 });
  assert.deepEqual(noBob.position, idle.position);
});

test('humanoid model profile stays blocky and compact', () => {
  assert.deepEqual(humanoidModelProfile(), {
    body: [0.62, 0.62, 0.34],
    limb: [0.18, 0.6, 0.22],
    leg: [0.24, 0.8, 0.26],
    helmet: [0.5, 0.2, 0.46],
    vest: [0.72, 0.68, 0.42],
    shoulder: [0.22, 0.18, 0.3],
    boot: [0.27, 0.16, 0.42],
    backpack: [0.48, 0.68, 0.2],
    hitParts: ['head', 'body', 'arm', 'leg'],
  });
});

test('tactical operator profile keeps blocky hitboxes and adds equipment layers', () => {
  const profile = humanoidModelProfile();
  assert.deepEqual(profile.hitParts, ['head', 'body', 'arm', 'leg']);
  assert.ok(profile.helmet[0] > profile.body[0] * 0.5);
  assert.ok(profile.vest[2] > profile.body[2]);
  assert.ok(profile.boot[2] > profile.leg[2]);
  assert.ok(profile.backpack[2] > 0);
});

test('settings are sanitized for a stable AAA menu profile', () => {
  assert.deepEqual(readSettings(JSON.stringify({
    fov: 120, sensitivity: -2, masterVolume: 2, invertY: 1, showFps: true,
  })), {
    fov: 110, sensitivity: 0.001, masterVolume: 1,
    soundEnabled: true, renderScale: 1, shadowsEnabled: true,
    shadowQuality: 'high', effectsQuality: 'balanced',
    invertY: true, showFps: true, showPing: true, aimMode: 'hold',
    bunnyHopEnabled: true, weaponBob: 1, screenShake: 1,
    crosshairVisible: true, crosshairStyle: 'classic', crosshairColor: '#ffffff',
    crosshairScale: 1, crosshairThickness: 2, crosshairGap: 6,
    crosshairDot: false, crosshairDotSize: 2, crosshairOutline: true,
    crosshairOutlineThickness: 1, crosshairOutlineColor: '#000000',
    crosshairOpacity: 1, crosshairDynamic: true, crosshairDynamicAmount: 1,
    damageFlash: true, highContrast: false, reducedMotion: false,
  });
  assert.deepEqual(readSettings('broken'), {
    fov: 78, sensitivity: 0.0023, masterVolume: 0.45,
    soundEnabled: true, renderScale: 1, shadowsEnabled: true,
    shadowQuality: 'high', effectsQuality: 'balanced',
    invertY: false, showFps: false, showPing: true, aimMode: 'hold',
    bunnyHopEnabled: true, weaponBob: 1, screenShake: 1,
    crosshairVisible: true, crosshairStyle: 'classic', crosshairColor: '#ffffff',
    crosshairScale: 1, crosshairThickness: 2, crosshairGap: 6,
    crosshairDot: false, crosshairDotSize: 2, crosshairOutline: true,
    crosshairOutlineThickness: 1, crosshairOutlineColor: '#000000',
    crosshairOpacity: 1, crosshairDynamic: true, crosshairDynamicAmount: 1,
    damageFlash: true, highContrast: false, reducedMotion: false,
  });
});

test('muting keeps the chosen volume and only changes the effective output', () => {
  const settings = readSettings({ soundEnabled: false, masterVolume: 0.72 });
  assert.equal(settings.soundEnabled, false);
  assert.equal(settings.masterVolume, 0.72);
  assert.equal(effectiveMasterVolume(settings), 0);
  assert.equal(effectiveMasterVolume({ ...settings, soundEnabled: true }), 0.72);
});

test('extended video, gameplay, and accessibility settings are sanitized', () => {
  const settings = readSettings({
    renderScale: 0.1, shadowsEnabled: false, shadowQuality: 'medium', effectsQuality: 'low',
    showPing: false, aimMode: 'toggle',
    bunnyHopEnabled: false, weaponBob: 8, screenShake: -2,
    crosshairVisible: false, crosshairColor: '#66E5FF', crosshairScale: 5,
    damageFlash: false, highContrast: true,
  });
  assert.equal(settings.renderScale, 0.5);
  assert.equal(settings.shadowsEnabled, false);
  assert.equal(settings.shadowQuality, 'medium');
  assert.equal(settings.effectsQuality, 'low');
  assert.equal(settings.showPing, false);
  assert.equal(settings.aimMode, 'toggle');
  assert.equal(settings.bunnyHopEnabled, false);
  assert.equal(settings.weaponBob, 1);
  assert.equal(settings.screenShake, 0);
  assert.equal(settings.crosshairVisible, false);
  assert.equal(settings.crosshairColor, '#66e5ff');
  assert.equal(settings.crosshairScale, 1.8);
  assert.equal(settings.damageFlash, false);
  assert.equal(settings.highContrast, true);
  assert.equal(effectivePixelRatio(settings.renderScale, 3), 1.5);
  assert.equal(effectivePixelRatio(1, 3), 2);
});

test('custom crosshair settings accept safe colors and clamp every visual dimension', () => {
  const settings = readSettings({
    crosshairStyle: 'tactical',
    crosshairColor: ' #A1B2C3 ',
    crosshairThickness: 99,
    crosshairGap: -4,
    crosshairDot: true,
    crosshairDotSize: 20,
    crosshairOutline: false,
    crosshairOutlineThickness: 8,
    crosshairOutlineColor: '#F0A020',
    crosshairOpacity: 0.01,
    crosshairDynamic: false,
    crosshairDynamicAmount: -3,
  });
  assert.equal(settings.crosshairStyle, 'tactical');
  assert.equal(settings.crosshairColor, '#a1b2c3');
  assert.equal(settings.crosshairThickness, 6);
  assert.equal(settings.crosshairGap, 0);
  assert.equal(settings.crosshairDot, true);
  assert.equal(settings.crosshairDotSize, 8);
  assert.equal(settings.crosshairOutline, false);
  assert.equal(settings.crosshairOutlineThickness, 3);
  assert.equal(settings.crosshairOutlineColor, '#f0a020');
  assert.equal(settings.crosshairOpacity, 0.2);
  assert.equal(settings.crosshairDynamic, false);
  assert.equal(settings.crosshairDynamicAmount, 0);
});

test('custom crosshair rejects unsafe CSS colors, unknown styles, and non-finite numbers', () => {
  const settings = readSettings({
    crosshairStyle: 'url-script',
    crosshairColor: 'red; background:url(evil)',
    crosshairOutlineColor: '#fff',
    crosshairThickness: Infinity,
    crosshairGap: Number.NaN,
    crosshairOpacity: 'not-a-number',
  });
  assert.equal(settings.crosshairStyle, 'classic');
  assert.equal(settings.crosshairColor, '#ffffff');
  assert.equal(settings.crosshairOutlineColor, '#000000');
  assert.equal(settings.crosshairThickness, 2);
  assert.equal(settings.crosshairGap, 6);
  assert.equal(settings.crosshairOpacity, 1);
});

test('settings booleans accept only canonical values and repair corrupt storage', () => {
  const corrupt = readSettings({
    crosshairVisible: 'true',
    crosshairOutline: null,
    crosshairDynamic: {},
    highContrast: 'false',
    bunnyHopEnabled: '0',
    invertY: '1',
  });
  assert.equal(corrupt.crosshairVisible, true);
  assert.equal(corrupt.crosshairOutline, true);
  assert.equal(corrupt.crosshairDynamic, true);
  assert.equal(corrupt.highContrast, false);
  assert.equal(corrupt.bunnyHopEnabled, true);
  assert.equal(corrupt.invertY, false);

  const explicit = readSettings({
    crosshairVisible: false,
    crosshairOutline: 0,
    invertY: true,
    highContrast: 1,
  });
  assert.equal(explicit.crosshairVisible, false);
  assert.equal(explicit.crosshairOutline, false);
  assert.equal(explicit.invertY, true);
  assert.equal(explicit.highContrast, true);
});

test('crosshair presentation separates dimensions and limits dynamic expansion', () => {
  const staticPresentation = crosshairPresentation({
    crosshairScale: 1.5,
    crosshairThickness: 3,
    crosshairGap: 8,
    crosshairDynamic: false,
  }, 500);
  assert.equal(staticPresentation.length, 13.5);
  assert.equal(staticPresentation.thickness, 3);
  assert.equal(staticPresentation.gap, 8);
  assert.equal(staticPresentation.dynamicExpansion, 0);

  const dynamicPresentation = crosshairPresentation({
    crosshairGap: 10,
    crosshairDynamic: true,
    crosshairDynamicAmount: 2,
  }, 500);
  assert.equal(dynamicPresentation.gap, 74);
  assert.equal(dynamicPresentation.dynamicExpansion, 64);
});

test('weapon spread projects to the real screen radius for FOV and resolution', () => {
  const at720p = projectSpreadToPixels(0.016, 78, 720);
  const at1080p = projectSpreadToPixels(0.016, 78, 1080);
  const wideFov = projectSpreadToPixels(0.016, 110, 720);

  assert.ok(Math.abs(at720p - 7.11) < 0.02);
  assert.ok(Math.abs(at1080p - at720p * 1.5) < 0.02);
  assert.ok(wideFov < at720p);
  assert.equal(projectSpreadToPixels(999, 78, 720), 32);
  assert.equal(projectSpreadToPixels(Number.NaN, Number.NaN, 0), 0);
});

test('dynamic crosshair receives a short ADS-aware shot impulse without changing accuracy', () => {
  assert.ok(Math.abs(shotCrosshairKickPixels(0.011, 1, false) - 5.32) < 0.001);
  assert.ok(Math.abs(shotCrosshairKickPixels(0.011, 1, true) - 3.192) < 0.001);
  assert.ok(Math.abs(shotCrosshairKickPixels(0.011, 0.5, false) - 2.66) < 0.001);
  assert.equal(shotCrosshairKickPixels(0.08, 1, false), 12);
  assert.equal(shotCrosshairKickPixels(Number.NaN, Number.NaN), 0);

  const cappedBase = crosshairFeedbackPixels(32, 0.05, 0, false);
  const shotgunShot = crosshairFeedbackPixels(32, 0.05, 1, false);
  const sniperShot = crosshairFeedbackPixels(32, 0.06, 1, false);
  assert.equal(cappedBase, 20, 'base spread leaves visual room for firing feedback');
  assert.ok(shotgunShot - cappedBase >= 9.9);
  assert.ok(sniperShot - cappedBase >= 11.1);
  assert.equal(crosshairFeedbackPixels(Number.NaN, 0, 0), 0);
});

test('crosshair styles expose the correct arms and center dot', () => {
  const classic = crosshairPresentation({ crosshairStyle: 'classic', crosshairDot: false });
  assert.deepEqual(
    [classic.showTop, classic.showBottom, classic.showLeft, classic.showRight, classic.showDot],
    [true, true, true, true, false],
  );

  const tactical = crosshairPresentation({ crosshairStyle: 'tactical', crosshairDot: true });
  assert.deepEqual(
    [tactical.showTop, tactical.showBottom, tactical.showLeft, tactical.showRight, tactical.showDot],
    [false, true, true, true, true],
  );

  const dot = crosshairPresentation({
    crosshairStyle: 'dot', crosshairDot: false, crosshairOutline: false,
  });
  assert.deepEqual(
    [dot.showTop, dot.showBottom, dot.showLeft, dot.showRight, dot.showDot],
    [false, false, false, false, true],
  );
  assert.equal(dot.outlineThickness, 0);

  const dynamicDot = crosshairPresentation({
    crosshairStyle: 'dot', crosshairDotSize: 2,
    crosshairDynamic: true, crosshairDynamicAmount: 1,
  }, 10);
  assert.equal(dynamicDot.dotSize, 3.8);
  assert.ok(Math.abs(dynamicDot.dotExpansion - 1.8) < 0.001);

  const extremeDotBase = crosshairPresentation({
    crosshairStyle: 'dot', crosshairGap: 20,
    crosshairDynamic: true, crosshairDynamicAmount: 2,
  }, 20);
  const extremeDotShot = crosshairPresentation({
    crosshairStyle: 'dot', crosshairGap: 20,
    crosshairDynamic: true, crosshairDynamicAmount: 2,
  }, 32);
  assert.ok(extremeDotShot.dotSize > extremeDotBase.dotSize);
  assert.ok(extremeDotShot.gap > extremeDotBase.gap);
});

test('crosshair presets are complete, immutable, and preserve unrelated settings', () => {
  assert.deepEqual(Object.keys(CROSSHAIR_PRESETS), [
    'balanced', 'precise', 'highVisibility', 'dynamic',
  ]);
  assert.ok(Object.values(CROSSHAIR_PRESETS).every(Object.isFrozen));
  assert.ok(Object.isFrozen(CROSSHAIR_PRESETS));

  const original = readSettings({ fov: 103, crosshairColor: '#123456' });
  const precise = applyCrosshairPreset(original, 'precise');
  assert.notEqual(precise, original);
  assert.equal(original.crosshairColor, '#123456');
  assert.equal(precise.fov, 103);
  assert.equal(precise.crosshairColor, '#66e5ff');
  assert.equal(precise.crosshairDot, true);
  assert.equal(precise.crosshairDynamic, false);

  const unchanged = applyCrosshairPreset(original, 'missing');
  assert.deepEqual(unchanged, original);
  assert.notEqual(unchanged, original);
});

test('menu navigation marks one active destination', () => {
  assert.deepEqual(menuNavState('options'), [
    { id: 'play', active: false },
    { id: 'arsenal', active: false },
    { id: 'operator', active: false },
    { id: 'options', active: true },
  ]);
});

test('buy menu categories expose one selected filter for mouse navigation', () => {
  assert.deepEqual(buyMenuCategoryState('rifles'), [
    { id: 'all', label: 'TODO', active: false },
    { id: 'pistols', label: 'PISTOLAS', active: false },
    { id: 'smgs', label: 'SMG', active: false },
    { id: 'rifles', label: 'RIFLES', active: true },
  ]);
});

test('podium keeps legacy mode metadata but defaults fixed rooms to a map vote', () => {
  assert.deepEqual(podiumStageState('mode'), {
    stage: 'mode', phase: 'FASE 1 / 2', title: 'ELIGE EL MODO DE JUEGO', voteType: 'mode',
  });
  assert.deepEqual(podiumStageState('map'), {
    stage: 'map', phase: 'MAPA DE LA SALA', title: 'ELIGE EL MAPA', voteType: 'map',
  });
  assert.equal(podiumStageState().stage, 'map');
});

test('bot panel distinguishes desired and active bots while clamping server data', () => {
  assert.deepEqual(botPanelState({
    enabled: true, count: 9, actual: 3, max: 5, humans: 7, slots: 10,
  }), {
    enabled: true,
    count: 5,
    actual: 3,
    max: 5,
    humans: 7,
    slots: 10,
    locked: false,
    note: '3 bots activos en la sala.',
  });

  const disabled = botPanelState({ enabled: false, count: 4, actual: 0, max: 5 });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.count, 4);
  assert.equal(disabled.note, 'Los bots están desactivados en esta sala.');
});

test('bot panel locks configuration during zombie waves', () => {
  const state = botPanelState({ enabled: true, count: 5, actual: 12, max: 5 }, 'zombies');
  assert.equal(state.locked, true);
  assert.equal(state.actual, 12);
  assert.match(state.note, /oleadas de Zombis/);
});

test('bot config acknowledgements only match the pending request', () => {
  assert.equal(isBotConfigAcknowledgement({ rid: 7 }, 7), true);
  assert.equal(isBotConfigAcknowledgement({ rid: 8 }, 7), false);
  assert.equal(isBotConfigAcknowledgement({}, 7), false);
  assert.equal(isBotConfigAcknowledgement({ rid: 7 }, null), false);
});

test('shot tracer is visible for firearms and uses a separate launcher effect', () => {
  assert.deepEqual(shotTracerState('pistol'), { visible: true, color: 0xfff0a8 });
  assert.deepEqual(shotTracerState('smg'), { visible: true, color: 0xffd66b });
  assert.deepEqual(shotTracerState('launcher'), { visible: false, color: 0xff8c42 });
});

test('weapon models expose layered AAA silhouettes for each combat class', () => {
  for (const kind of ['pistol', 'shotgun', 'smg', 'ar', 'sniper', 'revolver', 'launcher']) {
    const model = buildGunModel(kind);
    assert.ok(model.children.length >= 8, `${kind} should have layered geometry`);
    assert.equal(model.userData.flash.visible, false);
  }
});
