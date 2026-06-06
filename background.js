// =============================================================================
// background.js — MV3 service worker.
// Accumulates rolling 60s of mouse events. Runs classifier on demand.
// Falls back to lastPrediction (≤5 min old) when fresh data is insufficient,
// so the UI doesn't reset to "waiting" after a brief idle stretch.
// =============================================================================

try {
  importScripts("features.js", "feature_spec.js", "arousal_rf.js");
} catch (err) {
  console.error("Failed to import scripts:", err);
}

const ROLLING_WINDOW_MS = 60_000;
const MIN_EVENTS_FOR_PREDICTION = 100;
const STALE_PREDICTION_TTL_MS = 5 * 60_000;   // keep last prediction usable for 5 min

let events = [];
let lastPrediction = null;

if (typeof FEATURE_SPEC !== "undefined" && FEATURE_SPEC.feature_names) {
  setFeatureNames(FEATURE_SPEC.feature_names);
  console.log(`[talking-mouse] loaded ${FEATURE_SPEC.feature_names.length} feature names`);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "mouse_events") {
    handleMouseEvents(msg.events);
    return false;
  }
  if (msg.type === "predict") {
    sendResponse(runPrediction());
    return false;
  }
  if (msg.type === "status") {
    sendResponse({
      event_count: events.length,
      threshold: MIN_EVENTS_FOR_PREDICTION,
      last_prediction: lastPrediction,
      window_ms: ROLLING_WINDOW_MS,
    });
    return false;
  }
});

function handleMouseEvents(newEvents) {
  events.push(...newEvents);
  const cutoff = Date.now() - ROLLING_WINDOW_MS;
  events = events.filter(e => e.t >= cutoff);
}

function runPrediction() {
  const cutoff = Date.now() - ROLLING_WINDOW_MS;
  events = events.filter(e => e.t >= cutoff);

  if (events.length < MIN_EVENTS_FOR_PREDICTION) {
    // Fall back to last good prediction if it's still reasonably fresh,
    // so the popup keeps showing the user their last detected state
    // instead of resetting to "—" after a brief idle.
    if (lastPrediction && (Date.now() - lastPrediction.at) < STALE_PREDICTION_TTL_MS) {
      return { ...lastPrediction, stale: true, event_count: events.length };
    }
    return {
      ok: false,
      reason: "not_enough_data",
      event_count: events.length,
      threshold: MIN_EVENTS_FOR_PREDICTION,
    };
  }

  let featuresResult;
  try {
    featuresResult = extractFeatures(events);
  } catch (err) {
    console.error("[talking-mouse] feature extraction failed:", err);
    return { ok: false, reason: "feature_extraction_error", error: String(err) };
  }
  if (!featuresResult || !featuresResult.vector) {
    return { ok: false, reason: "no_trials", event_count: events.length };
  }

  let proba;
  try {
    proba = self.score(featuresResult.vector);
  } catch (err) {
    console.error("[talking-mouse] model inference failed:", err);
    return { ok: false, reason: "model_error", error: String(err) };
  }

  const p_stress = Array.isArray(proba) ? proba[1] : proba;
  const arousal = p_stress > 0.5 ? "high" : "low";

  lastPrediction = {
    ok: true,
    arousal,
    p_stress,
    event_count: events.length,
    at: Date.now(),
  };
  return lastPrediction;
}
