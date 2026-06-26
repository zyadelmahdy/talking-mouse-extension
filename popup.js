// =============================================================================
// popup.js — Phase B++
// Adds: user-configurable affect-regulation strategy (per arousal state)
//       content-type filter (Any video vs Music only)
//       stale-prediction handling
// =============================================================================

// Two query sets per content type. Music mode drops non-music categories
// (meditation, asmr, nature) and adds &videoCategoryId=10 to enforce Music.
const SEARCH_QUERIES = {
  any: {
    calming: [
      "lofi study music",
      "guided meditation 10 minutes",
      "asmr for sleep",
      "nature sounds rain",
      "calm piano music",
    ],
    energizing: [
      "workout motivation mix",
      "high energy edm mix",
      "epic motivation music",
      "happy upbeat playlist",
      "morning energy mix",
    ],
  },
  music: {
    calming: [
      "lofi hip hop radio",
      "calm piano music",
      "ambient music for focus",
      "instrumental study music",
      "soft acoustic guitar",
    ],
    energizing: [
      "workout music playlist",
      "high energy edm 2025",
      "epic music mix",
      "upbeat pop music",
      "morning energy music",
    ],
  },
};

const N_QUERIES = 2;
const PER_QUERY = 5;
const MIN_DURATION_SEC = 60;
const MAX_DURATION_SEC = 4 * 3600;
const RESULT_POOL_SIZE = 15;  // top-N by views to sample the final picks from
const FINAL_COUNT = 5;
const YT_MUSIC_CATEGORY_ID = "10";   // YouTube's official Music category

let currentArousal = null;
let isManual = false;
let isStale = false;
let apiKey = null;
let affectStrategy = { high: "calming", low: "energizing" };
let contentMode = "any";   // 'any' | 'music'

// ===== DOM refs =====
const arousalLabel = document.getElementById("arousal-label");
const autoBadge = document.getElementById("auto-badge");
const toggleBtn = document.getElementById("toggle-btn");
const targetMsg = document.getElementById("target-msg");
const statusBar = document.getElementById("status-bar");
const recommendationsDiv = document.getElementById("recommendations");
const refreshBtn = document.getElementById("refresh-btn");
const settingsBtn = document.getElementById("settings-btn");
const mainView = document.getElementById("main-view");
const settingsView = document.getElementById("settings-view");
const apiKeyInput = document.getElementById("api-key-input");
const saveKeyBtn = document.getElementById("save-key-btn");
const backBtn = document.getElementById("back-btn");

// ===== Boot =====
init();

async function init() {
  const stored = await chrome.storage.local.get([
    "apiKey", "affectStrategy", "contentMode",
  ]);
  apiKey = stored.apiKey || null;
  if (stored.affectStrategy) affectStrategy = stored.affectStrategy;
  if (stored.contentMode) contentMode = stored.contentMode;

  applyStrategyToUI();
  wireStrategyButtons();

  if (!apiKey) {
    showSettings();
  } else {
    await refreshFromBackground();
  }
}

// ===== Strategy / mode controls =====

function applyStrategyToUI() {
  document.querySelectorAll(".strategy-buttons").forEach((group) => {
    const state = group.getAttribute("data-state");
    let chosen;
    if (state === "contentMode") chosen = contentMode;
    else chosen = affectStrategy[state];
    group.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle(
        "active",
        btn.getAttribute("data-content") === chosen,
      );
    });
  });
}

function wireStrategyButtons() {
  document.querySelectorAll(".strategy-buttons button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const group = btn.closest(".strategy-buttons");
      const state = group.getAttribute("data-state");
      const content = btn.getAttribute("data-content");
      if (state === "contentMode") {
        contentMode = content;
        await chrome.storage.local.set({ contentMode });
      } else {
        affectStrategy[state] = content;
        await chrome.storage.local.set({ affectStrategy });
      }
      applyStrategyToUI();
    });
  });
}

// ===== Event handlers =====

toggleBtn.addEventListener("click", () => {
  if (currentArousal === null) currentArousal = "high";
  else currentArousal = currentArousal === "high" ? "low" : "high";
  isManual = true;
  isStale = false;
  updateArousalUI();
  fetchAndRender();
});

refreshBtn.addEventListener("click", async () => {
  isManual = false;
  await refreshFromBackground();
});

settingsBtn.addEventListener("click", showSettings);

backBtn.addEventListener("click", () => {
  if (!apiKey) return;
  mainView.classList.remove("hidden");
  settingsView.classList.add("hidden");
  if (currentArousal !== null) {
    updateArousalUI();
    fetchAndRender();
  }
});

saveKeyBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) return;
  apiKey = key;
  await chrome.storage.local.set({ apiKey });
  mainView.classList.remove("hidden");
  settingsView.classList.add("hidden");
  refreshFromBackground();
});

document.getElementById("console-link").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({
    url: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
  });
});

// ===== Background communication =====

async function refreshFromBackground() {
  recommendationsDiv.innerHTML = '<div class="loading">Reading mouse trail…</div>';
  const pred = await sendToBackground({ type: "predict" });

  if (pred && pred.ok) {
    currentArousal = pred.arousal;
    isManual = false;
    isStale = !!pred.stale;

    if (pred.stale) {
      const ageSec = Math.round((Date.now() - pred.at) / 1000);
      statusBar.textContent =
        `${pred.event_count} events · prediction ${ageSec}s old`;
    } else {
      statusBar.textContent =
        `${pred.event_count} events · p(stress) = ${pred.p_stress.toFixed(3)}`;
    }
    updateArousalUI();
    fetchAndRender();
  } else {
    currentArousal = null;
    const ec = (pred && pred.event_count) || 0;
    const need = (pred && pred.threshold) || 100;
    statusBar.textContent = `${ec} / ${need} events captured`;
    arousalLabel.textContent = "—";
    arousalLabel.className = "arousal-none";
    autoBadge.textContent = "WAITING";
    autoBadge.className = "badge-auto";
    toggleBtn.textContent = "→ Try anyway";
    targetMsg.innerHTML =
      `Move your mouse around for ~30s, then click <strong>↻ Refresh</strong>.`;
    recommendationsDiv.innerHTML = `<div class="loading">
      Not enough mouse data yet.<br>
      Browse for a bit, or use the override button to manually pick a state.
    </div>`;
  }
}

function sendToBackground(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

// ===== UI helpers =====

function showSettings() {
  mainView.classList.add("hidden");
  settingsView.classList.remove("hidden");
  if (apiKey) apiKeyInput.value = apiKey;
}

function updateArousalUI() {
  if (currentArousal === null) {
    arousalLabel.textContent = "—";
    arousalLabel.className = "arousal-none";
    return;
  }
  arousalLabel.textContent = currentArousal.toUpperCase();
  arousalLabel.className =
    currentArousal === "high" ? "arousal-high" : "arousal-low";

  if (isManual) {
    autoBadge.textContent = "MANUAL";
    autoBadge.className = "badge-manual";
  } else if (isStale) {
    autoBadge.textContent = "IDLE";
    autoBadge.className = "badge-stale";
  } else {
    autoBadge.textContent = "AUTO";
    autoBadge.className = "badge-auto";
  }

  toggleBtn.textContent = `→ ${currentArousal === "high" ? "LOW" : "HIGH"}`;

  // Reflect strategy + mode in the message
  const contentType = affectStrategy[currentArousal];
  const verb = contentType === "calming" ? "calming" : "energizing";
  const noun = contentMode === "music" ? "music" : "content";
  targetMsg.innerHTML = `Suggesting <strong>${verb} ${noun}</strong>`;
}

// ===== YouTube fetch + render =====

async function fetchAndRender() {
  if (currentArousal === null) return;
  recommendationsDiv.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const videos = await fetchRecommendations(currentArousal);
    renderRecommendations(videos);
  } catch (err) {
    recommendationsDiv.innerHTML =
      `<div class="error">Error: ${escapeHtml(err.message)}</div>`;
  }
}

async function fetchRecommendations(arousal) {
  const contentType = affectStrategy[arousal];
  const queries = shuffle(SEARCH_QUERIES[contentMode][contentType]).slice(0, N_QUERIES);
  const all = [];
  const seen = new Set();
  for (const q of queries) {
    const results = await ytSearch(q, PER_QUERY);
    for (const v of results) {
      if (!seen.has(v.video_id)) {
        seen.add(v.video_id);
        all.push(v);
      }
    }
  }
  if (!all.length) return [];
  const ids = all.map((v) => v.video_id);
  const stats = await ytVideoStats(ids);
  for (const v of all) {
    const s = stats[v.video_id] || {};
    v.view_count = s.view_count || 0;
    v.duration_sec = s.duration_sec || 0;
  }
  const filtered = all.filter(
    (v) =>
      v.duration_sec >= MIN_DURATION_SEC &&
      v.duration_sec <= MAX_DURATION_SEC,
  );
  filtered.sort((a, b) => b.view_count - a.view_count);
  const pool = filtered.slice(0, RESULT_POOL_SIZE);
  return shuffle(pool).slice(0, FINAL_COUNT);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function ytSearch(query, maxResults) {
  let url =
    `https://www.googleapis.com/youtube/v3/search?part=snippet` +
    `&q=${encodeURIComponent(query)}&type=video&maxResults=${maxResults}` +
    `&safeSearch=moderate&videoEmbeddable=true&key=${apiKey}`;
  // Enforce YouTube's official Music category when user picked Music only
  if (contentMode === "music") {
    url += `&videoCategoryId=${YT_MUSIC_CATEGORY_ID}`;
  }
  const r = await fetch(url);
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 200);
    throw new Error(`Search ${r.status}: ${txt}`);
  }
  const data = await r.json();
  return (data.items || [])
    .map((item) => ({
      video_id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumb_url: item.snippet.thumbnails?.medium?.url,
      matched_query: query,
    }))
    .filter((v) => v.video_id);
}

async function ytVideoStats(ids) {
  if (!ids.length) return {};
  const url =
    `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails` +
    `&id=${ids.join(",")}&key=${apiKey}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Videos ${r.status}`);
  const data = await r.json();
  const out = {};
  for (const item of data.items || []) {
    out[item.id] = {
      view_count: parseInt(item.statistics?.viewCount || "0", 10),
      duration_sec: parseIso(item.contentDetails?.duration || ""),
    };
  }
  return out;
}

function parseIso(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (
    parseInt(m[1] || 0, 10) * 3600 +
    parseInt(m[2] || 0, 10) * 60 +
    parseInt(m[3] || 0, 10)
  );
}

function renderRecommendations(videos) {
  if (!videos.length) {
    recommendationsDiv.innerHTML =
      '<div class="error">No videos found. Try refresh, or switch content type.</div>';
    return;
  }
  recommendationsDiv.innerHTML = videos
    .map(
      (v) => `
    <div class="video-card" data-video-id="${v.video_id}">
      <img class="video-thumb" src="${v.thumb_url || ""}" alt="">
      <div class="video-info">
        <div class="video-title">${escapeHtml(v.title)}</div>
        <div class="video-meta">
          ${humanViews(v.view_count)} views · ${humanDuration(v.duration_sec)}
        </div>
      </div>
    </div>`,
    )
    .join("");
  document.querySelectorAll(".video-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.getAttribute("data-video-id");
      chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${id}` });
    });
  });
}

function humanViews(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

function humanDuration(s) {
  if (s < 3600)
    return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
