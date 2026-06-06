// =============================================================================
// features.js — extracts the 35 features from a browser mouse-event stream,
//               matching feature_spec.json exactly (order + naming).
//
// Constants from feature_spec.json.extraction_constants:
//   idle_gap_threshold = 0.5 s   → IDLE_GAP_MS = 500
//   movement_noise     = 10 px   → MOVE_NOISE_PX = 10
//   velocity_noise     = 10 px/s → VEL_NOISE_PXS = 10
//   min_dt             = 0.005 s → MIN_DT_MS = 5
//   smooth_window      = 5
//
// Notes on browsing-context vs experimental task:
//   `stimulus_reentries` and `hover_time_total` are task-specific (assume a
//   defined stimulus area). In browsing we stub them to 0.
//   `correctness_rate` is task-specific (right/wrong answers); stubbed to 1.0.
//   Real mouse-dynamics features (velocity, accel, path, idle, direction
//   changes, click duration) generalize naturally and drive prediction.
// =============================================================================

let FEATURE_NAMES = [];
function setFeatureNames(names) { FEATURE_NAMES = names; }

const IDLE_GAP_MS = 500;
const MOVE_NOISE_PX = 10;
const VEL_NOISE_PXS = 10;
const MIN_DT_MS = 5;

const TASK_SPECIFIC_STUBS = {
  // session-level stubs — populated into the aggregated dict before mapping
  hover_time_total_mean: 0,
  hover_time_total_std: 0,
  stimulus_reentries_mean: 0,
  stimulus_reentries_std: 0,
  correctness_rate: 1.0,
};

// ===========================================================================
// Top-level extractor
// ===========================================================================

function extractFeatures(events) {
  const trials = splitIntoTrials(events);
  if (trials.length === 0) return null;

  const trialFeats = trials.map(computeTrialFeatures).filter(t => t !== null);
  if (trialFeats.length === 0) return null;

  const aggregated = aggregateFeatures(trialFeats);
  Object.assign(aggregated, TASK_SPECIFIC_STUBS);

  if (FEATURE_NAMES.length === 0) {
    return { __dict: aggregated };
  }
  const vec = FEATURE_NAMES.map(name => {
    const v = aggregated[name];
    return (v == null || !isFinite(v)) ? 0 : v;
  });
  return { vector: vec, dict: aggregated };
}

// ===========================================================================
// Trial splitting
//   Primary boundary: mousedown events (mirrors lab task structure).
//   Fallback: if no clicks in the window (e.g. pure reading), split events
//             into 4 equal-time chunks so the classifier still gets trials.
// ===========================================================================

function splitIntoTrials(events) {
  if (events.length === 0) return [];
  const trials = [];
  let current = [];
  for (const e of events) {
    current.push(e);
    if (e.type === "down" && current.length > 3) {
      trials.push(current);
      current = [];
    }
  }
  if (current.length > 20) trials.push(current);

  if (trials.length === 0) {
    // No clicks happened. Synthesize trials by time-slicing.
    const t0 = events[0].t;
    const tN = events[events.length - 1].t;
    const span = tN - t0;
    if (span < 5000) return [];
    const nSlices = 4;
    const sliceMs = span / nSlices;
    let sliceIdx = 0;
    let sliceEnd = t0 + sliceMs;
    let chunk = [];
    for (const e of events) {
      chunk.push(e);
      if (e.t >= sliceEnd && chunk.length > 5) {
        trials.push(chunk);
        chunk = [];
        sliceIdx++;
        sliceEnd = t0 + (sliceIdx + 1) * sliceMs;
      }
    }
    if (chunk.length > 5) trials.push(chunk);
  }
  return trials;
}

// ===========================================================================
// Per-trial feature extraction
// ===========================================================================

function computeTrialFeatures(events) {
  if (!events || events.length < 2) return null;

  const t0 = events[0].t;
  const tN = events[events.length - 1].t;
  const trial_duration = tN - t0;     // ms

  const velocities = [];
  const accels = [];
  let lastVel = null, lastVelT = null;
  let path_length = 0;

  for (let i = 1; i < events.length; i++) {
    const dt = events[i].t - events[i - 1].t;
    if (dt < MIN_DT_MS) continue;
    const dx = events[i].x - events[i - 1].x;
    const dy = events[i].y - events[i - 1].y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < MOVE_NOISE_PX) continue;
    path_length += d;
    const v = (d / dt) * 1000;        // px/s
    if (v < VEL_NOISE_PXS) continue;
    velocities.push(v);
    if (lastVel != null) {
      const ddt = events[i].t - lastVelT;
      if (ddt > 0) accels.push((v - lastVel) / ddt * 1000);
    }
    lastVel = v;
    lastVelT = events[i].t;
  }

  // first significant movement
  let firstMoveMs = trial_duration;
  for (let i = 1; i < events.length; i++) {
    const dx = events[i].x - events[0].x;
    const dy = events[i].y - events[0].y;
    if (Math.sqrt(dx * dx + dy * dy) > MOVE_NOISE_PX) {
      firstMoveMs = events[i].t - t0;
      break;
    }
  }

  // direct (Euclidean) distance start→end
  const lastE = events[events.length - 1];
  const direct_distance = Math.sqrt(
    (lastE.x - events[0].x) ** 2 + (lastE.y - events[0].y) ** 2
  );
  const straightness_ratio = path_length > 0 ? direct_distance / path_length : 0;
  //   straightness_ratio = how direct the path was (1.0 = ruler-straight, 0 = wandering)

  // click duration
  let click_duration = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].type === "down") {
      for (let j = i + 1; j < events.length; j++) {
        if (events[j].type === "up") {
          click_duration = events[j].t - events[i].t;
          break;
        }
      }
      break;
    }
  }

  // idle gaps
  let idle_gaps_count = 0;
  let idle_gaps_total_ms = 0;
  for (let i = 1; i < events.length; i++) {
    const dt = events[i].t - events[i - 1].t;
    if (dt > IDLE_GAP_MS) {
      idle_gaps_count++;
      idle_gaps_total_ms += dt;
    }
  }

  // direction changes (sign flips on dx and dy)
  let direction_changes = 0;
  let lastDx = 0, lastDy = 0;
  for (let i = 1; i < events.length; i++) {
    const dx = events[i].x - events[i - 1].x;
    const dy = events[i].y - events[i - 1].y;
    if (lastDx !== 0 && Math.sign(dx) !== 0 && Math.sign(dx) !== Math.sign(lastDx)) direction_changes++;
    if (lastDy !== 0 && Math.sign(dy) !== 0 && Math.sign(dy) !== Math.sign(lastDy)) direction_changes++;
    if (dx !== 0) lastDx = dx;
    if (dy !== 0) lastDy = dy;
  }

  return {
    velocity_mean: mean(velocities),
    velocity_std: std(velocities),
    velocity_max: velocities.length ? Math.max(...velocities) : 0,
    velocity_p95: percentile(velocities, 95),
    acceleration_mean: mean(accels.map(Math.abs)),
    acceleration_std: std(accels),
    path_length,
    direct_distance,
    straightness_ratio,
    direction_changes,
    time_to_first_move: firstMoveMs,
    trial_duration,
    click_duration,
    idle_gaps_count,
    idle_gaps_total_sec: idle_gaps_total_ms / 1000,    // spec uses seconds
  };
}

// ===========================================================================
// Aggregation
// ===========================================================================

function aggregateFeatures(trialFeats) {
  const out = {};
  const keys = Object.keys(trialFeats[0]);
  for (const k of keys) {
    const vals = trialFeats.map(t => t[k]).filter(v => isFinite(v));
    out[`${k}_mean`] = mean(vals);
    out[`${k}_std`] = std(vals);
  }
  return out;
}

// ===========================================================================
// Math helpers
// ===========================================================================

function mean(a) {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
}
function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length);
}
function percentile(a, p) {
  if (!a.length) return 0;
  const sorted = [...a].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p / 100))];
}

self.extractFeatures = extractFeatures;
self.setFeatureNames = setFeatureNames;
