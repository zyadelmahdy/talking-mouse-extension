// =============================================================================
// content.js — runs on every webpage
// Captures mouse trajectory + click events, sends to background every ~1s.
// Privacy: ONLY captures cursor coords + timestamps. No page content, text, or
// form data is ever read.
// =============================================================================

const BUF = [];
const FLUSH_MS = 1000;

function push(type, e) {
  BUF.push({
    type,                          // 'move' | 'down' | 'up'
    x: Math.round(e.clientX),
    y: Math.round(e.clientY),
    t: Date.now(),                 // ms since epoch (absolute)
    button: e.button == null ? null : e.button,
  });
}

// passive: true so we don't block scroll/UI; capture: true so iframes/SPA fine
window.addEventListener("mousemove", (e) => push("move", e),
                       { passive: true, capture: true });
window.addEventListener("mousedown", (e) => push("down", e),
                       { passive: true, capture: true });
window.addEventListener("mouseup",   (e) => push("up", e),
                       { passive: true, capture: true });

setInterval(() => {
  if (BUF.length === 0) return;
  const events = BUF.splice(0, BUF.length);
  // Service worker may be asleep — sendMessage will wake it. Failure is fine
  // (sliding window in background; missed batch just means slightly less data).
  try {
    chrome.runtime.sendMessage({ type: "mouse_events", events });
  } catch (_err) {
    // Extension context invalidated (e.g. after reload). Stop listening.
  }
}, FLUSH_MS);
