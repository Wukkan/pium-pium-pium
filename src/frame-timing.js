export const MAX_SIMULATION_STEP = 1 / 60;
export const MAX_FRAME_CATCHUP = 0.25;

// Divide un frame lento en pasos seguros sin introducir el microtirón de un
// reloj fijo sin interpolación. A FPS altos conserva exactamente un update por
// frame; a FPS bajos evita descartar tiempo o atravesar geometría.
export function frameSimulationPlan(
  rawElapsed,
  maxStep = MAX_SIMULATION_STEP,
  maxCatchup = MAX_FRAME_CATCHUP,
) {
  const numericElapsed = Number(rawElapsed);
  const safeElapsed = Number.isFinite(numericElapsed) && numericElapsed > 0
    ? Math.min(numericElapsed, Math.max(0, Number(maxCatchup) || MAX_FRAME_CATCHUP))
    : 0;
  const numericStep = Number(maxStep);
  const safeMaxStep = Number.isFinite(numericStep) && numericStep > 0
    ? numericStep
    : MAX_SIMULATION_STEP;
  if (safeElapsed <= 0) return { elapsed: 0, steps: 0, step: 0 };
  const steps = Math.max(1, Math.ceil(safeElapsed / safeMaxStep));
  return { elapsed: safeElapsed, steps, step: safeElapsed / steps };
}
