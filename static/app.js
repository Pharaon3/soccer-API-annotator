const DEFAULT_FPS = 25;
const API_RESPONSE_SEC = 22;
const VIDEO_POLL_INTERVAL_MS = 2000;
const IS_TEST_PAGE = document.body.dataset.page === "test";
const PENDING_ANNOTATE_KEY = "pendingAnnotateJob";

let wsAuthed = false;
let wsConnectResolve = null;
let wsConnectingPromise = null;

const LABELS = [
  { id: "pass", key: "p", display: "Pass" },
  { id: "pass_received", key: "[", display: "Pass received" },
  { id: "recovery", key: "r", display: "Recovery" },
  { id: "tackle", key: "t", display: "Tackle" },
  { id: "interception", key: "i", display: "Interception" },
  { id: "ball_out_of_play", key: "o", display: "Ball out" },
  { id: "clearance", key: "c", display: "Clearance" },
  { id: "take_on", key: "y", display: "Take on" },
  { id: "substitution", key: "x", display: "Substitution" },
  { id: "block", key: "b", display: "Block" },
  { id: "aerial_duel", key: "a", display: "Aerial duel" },
  { id: "shot", key: "s", display: "Shot" },
  { id: "save", key: "v", display: "Save" },
  { id: "foul", key: "f", display: "Foul" },
  { id: "goal", key: "g", display: "Goal" },
];

const keyToLabel = Object.fromEntries(LABELS.map((l) => [l.key, l.id]));

const roleScreen = document.getElementById("role-screen");
const annotatorScreen = document.getElementById("annotator-screen");
const reviewerScreen = document.getElementById("reviewer-screen");
const rolePickerModal = document.getElementById("role-picker-modal");
const roleStatus = document.getElementById("role-status");
const labelButtons = document.getElementById("label-buttons");
const video = document.getElementById("annotator-video");
const overlay = document.getElementById("event-overlay");
const eventsList = document.getElementById("events-list");
const sessionInfo = document.getElementById("session-info");
const jobInfo = document.getElementById("job-info");
const reviewerVideo = document.getElementById("reviewer-video");
const videoList = document.getElementById("video-list");
const reviewerEvents = document.getElementById("reviewer-events");
const reviewerMeta = document.getElementById("reviewer-meta");
const btnPlayPause = document.getElementById("btn-play-pause");
const videoTimeDisplay = document.getElementById("video-time-display");
const videoFrameDisplay = document.getElementById("video-frame-display");
const apiCountdown = document.getElementById("api-countdown");
const countdownValue = document.getElementById("countdown-value");
const testNextCountdown = document.getElementById("test-next-countdown");
const testNextValue = document.getElementById("test-next-value");
const videoReady = document.getElementById("video-ready");
const videoSeek = document.getElementById("video-seek");
const timelineMarkers = document.getElementById("timeline-markers");
const videoTimeline = document.getElementById("video-timeline");
let timelineTooltip = null;

const LABEL_COLORS = {
  pass: "#2563eb",
  pass_received: "#7c3aed",
  recovery: "#059669",
  tackle: "#dc2626",
  interception: "#ea580c",
  ball_out_of_play: "#475569",
  clearance: "#0891b2",
  take_on: "#db2777",
  substitution: "#ca8a04",
  block: "#4f46e5",
  aerial_duel: "#0d9488",
  shot: "#b91c1c",
  save: "#16a34a",
  foul: "#c2410c",
  goal: "#eab308",
};

let ws = null;
let role = null;
let currentJobId = null;
let pendingAnnotateJob = null;
let notificationPermissionRequested = false;
let sessionEvents = [];
let jobEvents = [];
let myParticipantId = null;
let jobStartOffset = 0;
let jobSegmentEnd = null;
let jobWindowSec = 30;
let seekSyncing = false;
let nextEventId = 0;
let overlayTimer = null;
let videoFps = DEFAULT_FPS;
let frameRafId = null;
let countdownRafId = null;
let countdownDeadline = null;
let testNextRafId = null;
let testNextDeadline = null;
let pendingTestJob = null;
let nextTestRoundAtSec = null;
let loadedVideoJobId = null;
let videoPollAbort = null;

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

function timeToFrame(timeSec) {
  return Math.max(0, Math.round(timeSec * videoFps));
}

function frameToTime(frame) {
  return frame / videoFps;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

const allScreens = [roleScreen, annotatorScreen, reviewerScreen].filter(Boolean);

function isAnnotatorView(screen) {
  return screen === annotatorScreen;
}

function showScreen(screen) {
  allScreens.forEach((el) => {
    if (el) el.classList.toggle("active", el === screen);
  });
  document.body.classList.toggle("no-scroll", isAnnotatorView(screen));
  if (!isAnnotatorView(screen)) {
    stopApiCountdown(true);
    if (IS_TEST_PAGE) stopTestNextCountdown(true);
  }
}

function isAnnotatingRole() {
  return (
    role === "annotator" ||
    role === "test" ||
    (role === "reviewer" && !!currentJobId)
  );
}

function clearSession() {
  wsAuthed = false;
  if (ws) {
    ws.close();
    ws = null;
  }
}

async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (res.status === 401) {
    window.location.href = "/";
    throw new Error("Not authenticated");
  }
  return res;
}

async function logout() {
  clearSession();
  role = null;
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    /* ignore */
  }
  window.location.href = "/";
}

function stopApiCountdown(hide = false) {
  if (countdownRafId !== null) {
    cancelAnimationFrame(countdownRafId);
    countdownRafId = null;
  }
  countdownDeadline = null;
  if (!apiCountdown) return;
  apiCountdown.classList.remove("active", "urgent", "critical", "done");
  if (hide) {
    apiCountdown.classList.add("hidden");
    if (countdownValue) countdownValue.textContent = "—";
  }
}

function stopTestNextCountdown(hide = false) {
  if (testNextRafId !== null) {
    cancelAnimationFrame(testNextRafId);
    testNextRafId = null;
  }
  testNextDeadline = null;
  if (!testNextCountdown) return;
  testNextCountdown.classList.remove("active");
  if (hide) {
    testNextCountdown.classList.add("hidden");
    if (testNextValue) testNextValue.textContent = "—";
  }
}

function startTestNextCountdown(nextRoundAtSec) {
  if (!IS_TEST_PAGE || !testNextCountdown || !testNextValue) return;
  stopTestNextCountdown();
  testNextCountdown.classList.remove("hidden");
  testNextCountdown.classList.add("active");
  testNextDeadline = nextRoundAtSec * 1000;

  const tick = () => {
    const leftMs = testNextDeadline - Date.now();
    const leftSec = Math.max(0, leftMs / 1000);
    testNextValue.textContent = String(Math.ceil(leftSec));
    if (leftSec <= 0) {
      testNextValue.textContent = "0";
      testNextRafId = null;
      return;
    }
    testNextRafId = requestAnimationFrame(tick);
  };
  testNextRafId = requestAnimationFrame(tick);
}

function startApiCountdownSecondsLeft(secondsLeft) {
  if (!apiCountdown || !countdownValue) return;
  stopApiCountdown();
  if (IS_TEST_PAGE) stopTestNextCountdown(true);
  apiCountdown.classList.remove("hidden", "done");
  apiCountdown.classList.add("active");
  const totalSec = Math.max(0, Number(secondsLeft) || 0);
  countdownDeadline = performance.now() + totalSec * 1000;

  const tick = () => {
    const leftMs = countdownDeadline - performance.now();
    const leftSec = Math.max(0, leftMs / 1000);
    const display = Math.ceil(leftSec);
    countdownValue.textContent = String(display);
    apiCountdown.classList.toggle("urgent", display <= 5 && display > 0);
    apiCountdown.classList.toggle("critical", display <= 3 && display > 0);

    if (leftSec <= 0) {
      countdownValue.textContent = "0";
      apiCountdown.classList.remove("urgent", "critical", "active");
      apiCountdown.classList.add("done");
      countdownRafId = null;
      if (IS_TEST_PAGE) {
        currentJobId = null;
        loadedVideoJobId = null;
        if (nextTestRoundAtSec) startTestNextCountdown(nextTestRoundAtSec);
      }
      return;
    }
    countdownRafId = requestAnimationFrame(tick);
  };
  countdownRafId = requestAnimationFrame(tick);
}

function startApiCountdown(durationSec = API_RESPONSE_SEC) {
  startApiCountdownSecondsLeft(durationSec);
}

function showRoleModal() {
  rolePickerModal?.classList.remove("hidden");
}

function hideRoleModal() {
  rolePickerModal?.classList.add("hidden");
}

function requestNotificationPermission() {
  if (notificationPermissionRequested || !("Notification" in window)) return;
  notificationPermissionRequested = true;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

function notifyNewAnnotationJob() {
  const title = "New annotation job";
  const body = "READY — switching to annotator…";
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const n = new Notification(title, { body, tag: "annotate-job" });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      /* ignore */
    }
  }
}

function showVideoReady() {
  if (videoReady) videoReady.classList.remove("hidden");
}

function hideVideoReady() {
  if (videoReady) videoReady.classList.add("hidden");
}

function redirectToAnnotatorForApiJob(data) {
  sessionStorage.setItem(PENDING_ANNOTATE_KEY, JSON.stringify(data));
  window.location.href = "/app";
}

function normalizeApiSecondsLeft(data) {
  const raw = data.seconds_left ?? data.duration_sec;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0 && n <= API_RESPONSE_SEC + 1) {
    return Math.ceil(n);
  }
  return API_RESPONSE_SEC;
}

function beginJobCountdown(data) {
  startApiCountdownSecondsLeft(normalizeApiSecondsLeft(data));
}

function jobSecondsLeft(data) {
  return normalizeApiSecondsLeft(data);
}

function goToAnnotatorForJob(data) {
  if (IS_TEST_PAGE) {
    redirectToAnnotatorForApiJob(data);
    return;
  }
  hideRoleModal();
  buildLabelButtons();
  showScreen(annotatorScreen);
  showVideoReady();
  beginJobCountdown(data);

  if (data.annotator_index != null) {
    startAnnotatorJob(data);
    return;
  }
  if (role !== "annotator") {
    pendingAnnotateJob = data;
    role = "annotator";
    send({ type: "set_role", role: "annotator" });
    return;
  }
  startAnnotatorJob(data);
}

function applyRoleAckToJob(data, ack) {
  const total = ack.annotator_total ?? data.annotator_total ?? 1;
  const index = ack.annotator_index ?? data.annotator_index ?? 1;
  const windowSec = data.segment_window_sec ?? 30;
  const slice = windowSec / total;
  const start =
    ack.start_offset_sec ??
    data.start_offset_sec ??
    slice * (index - 1);
  return {
    ...data,
    annotator_index: index,
    annotator_total: total,
    start_offset_sec: start,
    time_origin_sec: ack.time_origin_sec ?? data.time_origin_sec ?? start,
    segment_end_sec:
      ack.segment_end_sec ?? data.segment_end_sec ?? start + slice,
    clip_duration_sec:
      ack.clip_duration_sec ?? data.clip_duration_sec ?? slice,
    segment_window_sec: windowSec,
  };
}

function stripVideoUrlHash(url) {
  if (!url) return "";
  const i = url.indexOf("#");
  return i >= 0 ? url.slice(0, i) : url;
}

function jobVideoId(data) {
  return data.video_id || data.video_key || null;
}

function serverVideoApiPath(videoId) {
  return `/api/video/${encodeURIComponent(videoId)}`;
}

function stopVideoPoll() {
  if (videoPollAbort) {
    videoPollAbort.aborted = true;
    videoPollAbort = null;
  }
}

function waitForServerVideo(videoId, secondsLeft = API_RESPONSE_SEC) {
  stopVideoPoll();

  const path = serverVideoApiPath(videoId);
  const abort = { aborted: false, controllers: [] };
  videoPollAbort = abort;

  return new Promise((resolve) => {
    let resolved = false;

    const stop = (value) => {
      if (resolved) return;
      resolved = true;
      clearInterval(interval);
      clearTimeout(totalTimeout);
      abort.controllers.forEach((c) => c.abort());
      videoPollAbort = null;
      resolve(value);
    };

    const callVideoApi = () => {
      if (abort.aborted || resolved) return;

      const controller = new AbortController();
      abort.controllers.push(controller);

      const requestTimeout = setTimeout(() => {
        controller.abort();
      }, 5000);

      fetch(path, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      })
        .then((resp) => {
          clearTimeout(requestTimeout);

          if (resp.ok) {
            stop(new URL(path, location.origin).href);
          }
        })
        .catch(() => {
          clearTimeout(requestTimeout);
        });
    };

    const interval = setInterval(callVideoApi, 2000);

    const totalTimeout = setTimeout(() => {
      stop(null);
    }, secondsLeft * 1000);
  });
}

function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN && wsAuthed) {
    return Promise.resolve();
  }

  if (wsConnectingPromise) {
    return wsConnectingPromise;
  }

  wsConnectingPromise = new Promise((resolve, reject) => {
    wsAuthed = false;
    ws = new WebSocket(wsUrl());

    ws.onopen = () => {
      wsAuthed = true;
      wsConnectingPromise = null;
      resolve();
    };

    ws.onerror = () => {
      wsConnectingPromise = null;
      reject(new Error("WebSocket connection failed"));
    };

    ws.onmessage = (ev) => handleMessage(JSON.parse(ev.data));

    ws.onclose = () => {
      wsAuthed = false;
      wsConnectingPromise = null;
      if (roleStatus) roleStatus.textContent = "Disconnected. Refresh the page.";
    };
  });

  return wsConnectingPromise;
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function updatePlayPauseButton() {
  if (!btnPlayPause) return;
  btnPlayPause.textContent = video.paused ? "▶" : "⏸";
  btnPlayPause.setAttribute("aria-label", video.paused ? "Play" : "Pause");
}

function updateVideoHud() {
  if (!video.src) return;
  const t = video.currentTime || 0;
  const frame = timeToFrame(t);
  if (videoTimeDisplay) videoTimeDisplay.textContent = formatTime(t);
  if (videoFrameDisplay) videoFrameDisplay.textContent = `frame ${frame}`;
  if (videoSeek && video.duration && Number.isFinite(video.duration)) {
    seekSyncing = true;
    videoSeek.value = String(t);
    seekSyncing = false;
  }
  updatePlayPauseButton();
}

function updateTimelineSeekRange() {
  if (!videoSeek || !video.duration || !Number.isFinite(video.duration)) return;
  videoSeek.min = "0";
  videoSeek.max = String(video.duration);
  videoSeek.step = "0.01";
}

function ensureTimelineTooltip() {
  if (timelineTooltip) return timelineTooltip;
  if (!videoTimeline) return null;
  timelineTooltip = document.createElement("div");
  timelineTooltip.id = "timeline-marker-tooltip";
  timelineTooltip.className = "timeline-marker-tooltip hidden";
  timelineTooltip.setAttribute("role", "tooltip");
  videoTimeline.appendChild(timelineTooltip);
  return timelineTooltip;
}

function showTimelineMarkerTooltip(marker) {
  const tip = ensureTimelineTooltip();
  if (!tip || !marker) return;

  const labelName =
    marker.dataset.labelName ||
    LABELS.find((l) => l.id === marker.dataset.label)?.display ||
    marker.dataset.label ||
    "Event";
  const frame = marker.dataset.frame ?? "—";
  const timeSec = Number(marker.dataset.time);
  const timeText = Number.isFinite(timeSec) ? `${timeSec.toFixed(2)}s` : "—";
  const who = marker.dataset.who || "";
  const color = marker.style.background || LABEL_COLORS[marker.dataset.label] || "#94a3b8";

  tip.style.setProperty("--tooltip-accent", color);
  tip.innerHTML = `
    <span class="timeline-tooltip-swatch" style="background:${color}"></span>
    <span class="timeline-tooltip-label">${labelName}</span>
    <span class="timeline-tooltip-meta">frame ${frame} · ${timeText}</span>
    <span class="timeline-tooltip-who">${who}</span>
  `;
  tip.classList.remove("hidden");

  const timelineRect = videoTimeline.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const centerX = markerRect.left + markerRect.width / 2 - timelineRect.left;
  tip.style.left = `${centerX}px`;
}

function hideTimelineMarkerTooltip() {
  timelineTooltip?.classList.add("hidden");
}

function renderTimelineMarkers() {
  if (!timelineMarkers) return;
  const duration = video.duration;
  if (!duration || !Number.isFinite(duration) || duration <= 0) {
    timelineMarkers.innerHTML = "";
    hideTimelineMarkerTooltip();
    return;
  }
  timelineMarkers.innerHTML = jobEvents
    .slice()
    .sort((a, b) => a.time_sec - b.time_sec)
    .map((e) => {
      const pct = Math.min(100, Math.max(0, (e.time_sec / duration) * 100));
      const color = LABEL_COLORS[e.label] || "#94a3b8";
      const mine = e.participant_id === myParticipantId;
      const labelName =
        LABELS.find((l) => l.id === e.label)?.display ?? e.label;
      const who = mine ? "You" : `Annotator #${e.participant_id}`;
      return `<button type="button" class="timeline-marker${mine ? " mine" : ""}" data-time="${e.time_sec}" data-frame="${e.frame}" data-label="${e.label}" data-label-name="${labelName}" data-who="${who}" data-event-id="${e.id ?? ""}" style="left:${pct}%;background:${color}" aria-label="${labelName}, frame ${e.frame}"></button>`;
    })
    .join("");
}

function handleJobEvent(data) {
  if (data.job_id !== currentJobId || !data.event) return;
  const e = data.event;
  const uid =
    e.uid || `p${e.participant_id}-${e.time_sec}-${e.label}`;
  if (data.action === "remove") {
    jobEvents = jobEvents.filter((x) => (x.uid || `p${x.participant_id}-${x.time_sec}-${x.label}`) !== uid);
  } else if (!jobEvents.some((x) => (x.uid || `p${x.participant_id}-${x.time_sec}-${x.label}`) === uid)) {
    jobEvents.push({
      id: ++nextEventId,
      time_sec: e.time_sec,
      frame: e.frame ?? timeToFrame(e.time_sec),
      label: e.label,
      participant_id: e.participant_id,
      uid,
    });
  }
  sessionEvents = jobEvents.filter((x) => x.participant_id === myParticipantId);
  renderSessionEvents();
  renderTimelineMarkers();
}

function clampPlaybackToSegment() {
  if (video.paused) return;
  const end =
    jobSegmentEnd != null && Number.isFinite(jobSegmentEnd)
      ? jobSegmentEnd
      : video.duration;
  if (Number.isFinite(end) && video.currentTime >= end - 0.05) {
    video.pause();
    video.currentTime = end;
  }
}

function startVideoHudLoop() {
  stopVideoHudLoop();
  const tick = () => {
    clampPlaybackToSegment();
    updateVideoHud();
    frameRafId = requestAnimationFrame(tick);
  };
  frameRafId = requestAnimationFrame(tick);
}

function stopVideoHudLoop() {
  if (frameRafId !== null) {
    cancelAnimationFrame(frameRafId);
    frameRafId = null;
  }
}

function togglePlayPause() {
  if (!video.src) return;
  if (video.paused) {
    video.play().catch(() => {});
  } else {
    video.pause();
  }
  updatePlayPauseButton();
}

function formatLabelKey(key) {
  return key.length === 1 ? key.toUpperCase() : key;
}

function buildLabelButtons() {
  if (!labelButtons) return;
  labelButtons.innerHTML = "";
  LABELS.forEach((label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "label-btn";
    btn.dataset.label = label.id;
    btn.textContent = `${label.display.toUpperCase()} (${formatLabelKey(label.key)})`;
    btn.title = `${label.display} — ${label.id}`;
    btn.addEventListener("click", () => annotate(label.id));
    labelButtons.appendChild(btn);
  });
}

function showOverlay(labelId, frame) {
  const item = LABELS.find((l) => l.id === labelId);
  const name = item ? item.display : labelId;
  overlay.innerHTML = `<span class="overlay-label">${name}</span><span class="overlay-frame">frame ${frame}</span>`;
  overlay.classList.remove("hidden");
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => {
    overlay.classList.add("hidden");
  }, 500);
}

function renderSessionEvents() {
  if (!eventsList) return;
  eventsList.innerHTML = jobEvents
    .slice()
    .sort((a, b) => a.time_sec - b.time_sec)
    .map((e) => {
      const labelName =
        LABELS.find((l) => l.id === e.label)?.display ?? e.label;
      const mine = e.participant_id === myParticipantId;
      const who = mine ? "you" : `#${e.participant_id}`;
      if (mine) {
        return `<li><button type="button" class="event-item" data-event-id="${e.id}" title="Click to remove">frame ${e.frame} · ${e.time_sec.toFixed(2)}s — ${labelName} (${who})</button></li>`;
      }
      return `<li><span class="event-item event-other">frame ${e.frame} · ${e.time_sec.toFixed(2)}s — ${labelName} (${who})</span></li>`;
    })
    .join("");
}

function removeSessionEvent(eventId) {
  const idx = jobEvents.findIndex(
    (e) => e.id === eventId && e.participant_id === myParticipantId
  );
  if (idx === -1) return;
  const removed = jobEvents.splice(idx, 1)[0];
  sessionEvents = jobEvents.filter((x) => x.participant_id === myParticipantId);
  renderSessionEvents();
  renderTimelineMarkers();
  if (currentJobId) {
    send({
      type: "annotation_remove",
      job_id: currentJobId,
      time_sec: removed.time_sec,
      label: removed.label,
      uid: removed.uid,
    });
  }
}

function annotate(labelId) {
  if (!currentJobId || !video.src) return;
  const time_sec = video.currentTime + (jobStartOffset || 0);
  const frame = timeToFrame(time_sec);
  showOverlay(labelId, frame);
  send({
    type: "annotation",
    job_id: currentJobId,
    label: labelId,
    time_sec,
    frame,
  });
}

function estimateFps() {
  videoFps = DEFAULT_FPS;
  if (video.videoWidth && video.duration) {
    // Keep default unless we add server-side fps later.
  }
}

function sameVideoUrl(currentSrc, nextUrl) {
  if (!currentSrc || !nextUrl) return false;
  try {
    const a = new URL(stripVideoUrlHash(currentSrc), location.href).href;
    const b = new URL(stripVideoUrlHash(nextUrl), location.href).href;
    return a === b;
  } catch {
    return stripVideoUrlHash(currentSrc) === stripVideoUrlHash(nextUrl);
  }
}

function waitForVideoMetadata(url) {
  return new Promise((resolve, reject) => {
    if (!sameVideoUrl(video.src, url)) {
      video.preload = "auto";
      video.src = url;
      video.load();
    }
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      resolve();
      return;
    }
    const onReady = () => {
      video.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      video.removeEventListener("loadedmetadata", onReady);
      reject(new Error(`Video failed to load: ${url}`));
    };
    video.addEventListener("loadedmetadata", onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function waitForVideoAtOffset(offset) {
  const target = Math.max(0, offset || 0);
  const atTarget = () =>
    video.readyState >= HTMLMediaElement.HAVE_METADATA &&
    (Math.abs(video.currentTime - target) < 0.1 || video.currentTime >= target);

  if (atTarget()) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadedmetadata", onMetadata);
      video.removeEventListener("canplay", onSeeked);
      resolve();
    };
    const onSeeked = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) finish();
    };
    const onMetadata = () => {
      video.currentTime = target;
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("canplay", onSeeked);
    video.addEventListener("loadedmetadata", onMetadata, { once: true });
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      video.currentTime = target;
    }
    setTimeout(finish, 12_000);
  });
}

async function startAnnotatorJob(data) {
  const videoId = jobVideoId(data);
  if (!videoId) return;

  const secondsLeft = jobSecondsLeft(data);

  if (data.job_id === loadedVideoJobId && video.src) {
    const expected = serverVideoApiPath(videoId);
    if (video.src.includes(encodeURIComponent(videoId)) || video.src.includes(videoId)) {
      return;
    }
  }

  stopVideoPoll();
  currentJobId = data.job_id;
  loadedVideoJobId = data.job_id;
  jobEvents = [];
  sessionEvents = [];
  nextEventId = 0;
  jobStartOffset = data.start_offset_sec ?? 0;
  jobSegmentEnd = data.segment_end_sec ?? null;
  jobWindowSec = data.segment_window_sec ?? 30;
  if (data.annotator_id != null) myParticipantId = data.annotator_id;
  renderSessionEvents();
  renderTimelineMarkers();

  const index = data.annotator_index ?? 1;
  const total = data.annotator_total ?? 1;
  const prefix = IS_TEST_PAGE ? "Test round" : "Job active";
  if (jobInfo) {
    jobInfo.textContent = `${prefix} · waiting for video ${videoId}… · ${index}/${total}`;
  }

  showVideoReady();
  video.pause();
  const url = await waitForServerVideo(videoId, secondsLeft);
  if (!url) {
    if (jobInfo) {
      jobInfo.textContent = `Video not ready before API deadline (${videoId})`;
    }
    hideVideoReady();
    return;
  }

  if (jobInfo) {
    jobInfo.textContent = `${prefix} · start ${jobStartOffset.toFixed(1)}s · ${index}/${total}`;
  }

  try {
    await waitForVideoMetadata(url);
    const offset = 0;
    await waitForVideoAtOffset(offset);
    updateTimelineSeekRange();
    estimateFps();
    try {
      video.currentTime = offset;
      await video.play();
    } catch (err) {
      console.warn("Autoplay blocked, retrying muted", err);
      video.muted = true;
      video.currentTime = offset;
      await video.play();
    }
    startVideoHudLoop();
    updateVideoHud();
    renderTimelineMarkers();
  } catch (err) {
    console.error("Failed to load job video", err);
    if (jobInfo) {
      jobInfo.textContent = `Video failed to load (${url})`;
    }
  } finally {
    hideVideoReady();
  }
}

function handleAnnotateStart(data) {
  notifyNewAnnotationJob();
  goToAnnotatorForJob(data);
}

function handleTestStart(data) {
  goToTestJob(data);
}

function goToTestJob(data) {
  buildLabelButtons();
  showScreen(annotatorScreen);
  showVideoReady();
  beginJobCountdown(data);

  if (role !== "test") {
    pendingTestJob = data;
    role = "test";
    send({ type: "set_role", role: "test" });
    return;
  }
  startAnnotatorJob(data);
}

function handleTestSchedule(data) {
  nextTestRoundAtSec = data.next_round_at;
  if (!currentJobId) {
    startTestNextCountdown(nextTestRoundAtSec);
  }
}

function handleMessage(data) {
  switch (data.type) {
    case "role_ack":
      if (data.annotator_id != null) myParticipantId = data.annotator_id;
      if (data.role === "test") {
        sessionInfo.textContent = `Practice test · annotator #${data.annotator_index} of ${data.annotator_total} · offset ${data.start_offset_sec.toFixed(2)}s`;
        if (!pendingTestJob) {
          jobInfo.textContent = "Next test loads automatically every 30 seconds…";
        }
        buildLabelButtons();
        if (!pendingTestJob) {
          stopApiCountdown(true);
        }
        showScreen(annotatorScreen);
        if (pendingTestJob) {
          const job = applyRoleAckToJob(pendingTestJob, data);
          pendingTestJob = null;
          beginJobCountdown(job);
          startAnnotatorJob(job);
        }
      }
      if (data.role === "annotator") {
        sessionInfo.textContent = `You are annotator #${data.annotator_index} of ${data.annotator_total} · offset ${data.start_offset_sec.toFixed(2)}s`;
        if (!pendingAnnotateJob) {
          jobInfo.textContent = "Waiting for API request…";
        }
        buildLabelButtons();
        if (!pendingAnnotateJob) {
          stopApiCountdown(true);
        }
        showScreen(annotatorScreen);
        if (pendingAnnotateJob) {
          const job = applyRoleAckToJob(pendingAnnotateJob, data);
          pendingAnnotateJob = null;
          beginJobCountdown(job);
          startAnnotatorJob(job);
        }
      }
      if (data.role === "reviewer") {
        if (data.videos) renderVideoList(data.videos);
        stopApiCountdown(true);
        showScreen(reviewerScreen);
        stopVideoHudLoop();
        video.pause();
        video.removeAttribute("src");
      }
      hideRoleModal();
      break;
    case "annotator_count":
      if (sessionInfo && isAnnotatingRole()) {
        sessionInfo.textContent = `Connected annotators: ${data.count}`;
      }
      break;
    case "annotate_start":
      handleAnnotateStart(data);
      break;
    case "job_event":
      handleJobEvent(data);
      break;
    case "test_start":
      if (IS_TEST_PAGE) handleTestStart(data);
      break;
    case "test_schedule":
      if (IS_TEST_PAGE) handleTestSchedule(data);
      break;
    case "videos_list":
      renderVideoList(data.videos);
      break;
    case "videos_updated":
      if (role === "reviewer") {
        send({ type: "list_videos" });
      }
      break;
    default:
      break;
  }
}

async function enterRole(selectedRole) {
  try {
    await connectWebSocket();
    requestNotificationPermission();
    role = selectedRole;
    send({ type: "set_role", role: selectedRole });
    if (selectedRole === "annotator" || selectedRole === "test") {
      buildLabelButtons();
    }
  } catch (err) {
    if (roleStatus) roleStatus.textContent = "Could not connect to server.";
    else if (jobInfo) jobInfo.textContent = "Could not connect to server.";
    console.warn(err);
  }
}

async function switchToRole(selectedRole) {
  if (selectedRole === role) {
    hideRoleModal();
    return;
  }
  hideRoleModal();
  role = selectedRole;
  send({ type: "set_role", role: selectedRole });
}

document.addEventListener(
  "keydown",
  (e) => {
    if (!isAnnotatingRole()) return;
    if (e.target.matches("input, textarea, select")) return;

    if (e.code === "Space") {
      e.preventDefault();
      togglePlayPause();
      return;
    }

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const labelId = keyToLabel[key];
    if (labelId) {
      e.preventDefault();
      annotate(labelId);
    }
  },
  true
);

requestNotificationPermission();

document.getElementById("btn-logout")?.addEventListener("click", logout);

async function resumePendingAnnotateJob() {
  const raw = sessionStorage.getItem(PENDING_ANNOTATE_KEY);
  if (!raw) return false;
  sessionStorage.removeItem(PENDING_ANNOTATE_KEY);
  try {
    await connectWebSocket();
    requestNotificationPermission();
    buildLabelButtons();
    showScreen(annotatorScreen);
    role = "annotator";
    send({ type: "set_role", role: "annotator" });
    return true;
  } catch {
    return false;
  }
}

function bindRoleScreenHandlers() {
  document.getElementById("btn-annotator")?.addEventListener("click", () => {
    roleStatus.textContent = "Connecting…";
    enterRole("annotator").then(() => {
      roleStatus.textContent = "";
    });
  });

  document.getElementById("btn-reviewer")?.addEventListener("click", () => {
    roleStatus.textContent = "Connecting…";
    enterRole("reviewer").then(() => {
      roleStatus.textContent = "";
    });
  });

  document.getElementById("btn-switch-role-annotator")?.addEventListener("click", showRoleModal);
  document.getElementById("btn-switch-role-reviewer")?.addEventListener("click", showRoleModal);
  document.getElementById("modal-btn-cancel")?.addEventListener("click", hideRoleModal);
  document.getElementById("modal-btn-annotator")?.addEventListener("click", () => switchToRole("annotator"));
  document.getElementById("modal-btn-reviewer")?.addEventListener("click", () => switchToRole("reviewer"));

  document.getElementById("btn-refresh-videos")?.addEventListener("click", () => {
    send({ type: "list_videos" });
  });
}

if (IS_TEST_PAGE) {
  document.body.classList.add("no-scroll");
  buildLabelButtons();
  enterRole("test");
} else {
  (async () => {
    const resumed = await resumePendingAnnotateJob();
    if (!resumed) {
      connectWebSocket().catch(() => {});
      showScreen(roleScreen);
    }
    bindRoleScreenHandlers();
  })();
}

btnPlayPause?.addEventListener("click", togglePlayPause);

videoSeek?.addEventListener("input", () => {
  if (seekSyncing || !video.duration) return;
  const t = parseFloat(videoSeek.value);
  const max = Math.min(jobWindowSec, video.duration);
  video.currentTime = Math.min(max, Math.max(0, t));
  updateVideoHud();
});

timelineMarkers?.addEventListener("click", (e) => {
  const btn = e.target.closest(".timeline-marker");
  if (!btn || !video.duration) return;
  video.currentTime = parseFloat(btn.dataset.time);
  updateVideoHud();
});

videoTimeline?.addEventListener("mouseover", (e) => {
  const marker = e.target.closest(".timeline-marker");
  if (marker) showTimelineMarkerTooltip(marker);
});

videoTimeline?.addEventListener("mouseout", (e) => {
  const marker = e.target.closest(".timeline-marker");
  if (!marker) return;
  const to = e.relatedTarget;
  if (!to || !marker.contains(to)) hideTimelineMarkerTooltip();
});

eventsList?.addEventListener("click", (e) => {
  const btn = e.target.closest(".event-item");
  if (!btn) return;
  const eventId = Number(btn.dataset.eventId);
  if (Number.isFinite(eventId)) removeSessionEvent(eventId);
});

video.addEventListener("play", updatePlayPauseButton);
video.addEventListener("pause", updatePlayPauseButton);
video.addEventListener("seeked", updateVideoHud);
video.addEventListener("loadedmetadata", () => {
  estimateFps();
  updateTimelineSeekRange();
  renderTimelineMarkers();
});

function renderVideoList(videos) {
  videoList.innerHTML = "";
  if (!videos.length) {
    videoList.innerHTML = "<li><em>No saved videos yet</em></li>";
    return;
  }
  videos.forEach((v) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    const date = v.saved_at
      ? new Date(v.saved_at * 1000).toLocaleString()
      : "—";
    btn.innerHTML = `<strong>${v.video_id || v.video_key}</strong><br>${v.event_count} events · ${date}`;
    btn.addEventListener("click", () => loadReviewerVideo(v, btn));
    li.appendChild(btn);
    videoList.appendChild(li);
  });
}

async function loadReviewerVideo(item, btn) {
  videoList.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  const vid = item.video_id || item.video_key;
  reviewerVideo.src = vid
    ? new URL(serverVideoApiPath(vid), location.origin).href
    : item.video_url || "";
  reviewerMeta.textContent = item.video_url || vid;
  try {
    const res = await apiFetch(item.annotations_file);
    const data = await res.json();
    const events = data.events || [];
    reviewerEvents.innerHTML = events
      .slice()
      .sort((a, b) => a.time_sec - b.time_sec)
      .map((e) => {
        const frame =
          e.frame !== undefined
            ? e.frame
            : timeToFrame(e.time_sec);
        return `<li><button type="button" data-time="${e.time_sec}">frame ${frame} · ${e.time_sec.toFixed(2)}s — ${e.label}</button></li>`;
      })
      .join("");
    reviewerEvents.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        reviewerVideo.pause();
        reviewerVideo.currentTime = parseFloat(b.dataset.time);
      });
    });
  } catch {
    reviewerEvents.innerHTML = "<li>Failed to load annotations</li>";
  }
}
