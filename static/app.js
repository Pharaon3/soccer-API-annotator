const DEFAULT_FPS = 25;
const FIRST_PART_EXTRA_SEC = 3;
const ARROW_HOLD_DELAY_MS = 60;
const ARROW_HOLD_INTERVAL_MS = 28;
const API_RESPONSE_SEC = 22;
const VIDEO_POLL_INTERVAL_MS = 2000;
const PRESENCE_IDLE_MS = 15 * 60 * 1000;
const PRESENCE_ACTIVE_RECHECK_MS = 30 * 1000;
const PAGE = document.body.dataset.page || "";
const IS_PRACTICE_PAGE = PAGE === "practice" || PAGE === "train";
const IS_ANNOTATOR_PAGE = PAGE === "annotator";
const IS_BOARD_PAGE = PAGE === "board" || PAGE === "review";
const PENDING_ANNOTATE_KEY = "pendingAnnotateJob";

let wsAuthed = false;
let wsConnectResolve = null;
let wsConnectingPromise = null;

const DEFAULT_LABEL_KEYBOARD_ROWS = [
  ["pass", "pass_received", "take_on", "recovery", "tackle"],
  ["aerial_duel", "save", "shot", "foul", "goal"],
  ["interception", "substitution", "clearance", "block", "ball_out_of_play"],
];

let LABELS = [];
let labelKeyboardRows = DEFAULT_LABEL_KEYBOARD_ROWS;
let keyToLabel = {};

const roleScreen = document.getElementById("role-screen");
const annotatorScreen = document.getElementById("annotator-screen");
const reviewerScreen = document.getElementById("reviewer-screen");
const rolePickerModal = document.getElementById("role-picker-modal");
const roleStatus = document.getElementById("role-status");
const connectionStatus = document.getElementById("connection-status");
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
const videoDateFilter = document.getElementById("video-date-filter");
const btnClearDateFilter = document.getElementById("btn-clear-date-filter");

let boardVideosCache = [];
const boardDateExpandState = new Map();
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
const timelineTrack = document.getElementById("timeline-track");
let timelineTooltip = null;

const btnPresence = document.getElementById("btn-presence");
const presenceOverlay = document.getElementById("presence-overlay");
const btnPresenceConfirm = document.getElementById("btn-presence-confirm");

let presenceOnline = true;
let presenceIdleTimer = null;
let presenceListenersBound = false;

const PARTICIPANT_COLORS = [
  "#3d8bfd",
  "#3ecf8e",
  "#f59e0b",
  "#ec4899",
  "#a78bfa",
  "#22d3ee",
];

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
let jobPlaybackStart = 0;
let jobTimeOrigin = 0;
let jobPlaybackEnd = null;
let jobCoreGlobalStart = 0;
let jobCoreGlobalEnd = 10;
let jobPlayGlobalStart = 0;
let jobPlayGlobalEnd = 10;
let jobWindowSec = 30;
let arrowHoldTimer = null;
let arrowHoldDelay = null;
let arrowHoldDir = 0;
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
let annotationsLocked = false;

const EVENT_DELETE_ICON = `<svg class="event-delete-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M6 7h12v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7zm3-4h6l1 1h4v2H4V4h4l1-1zM9 9v9h2V9H9zm4 0v9h2V9h-2z"/></svg>`;

function labelDisplayName(labelId) {
  return LABELS.find((l) => l.id === labelId)?.display ?? labelId;
}

async function loadLabelConfig() {
  const res = await apiFetch("/api/labels");
  if (!res.ok) throw new Error("Failed to load labels");
  const data = await res.json();
  LABELS = data.labels || [];
  labelKeyboardRows = data.keyboard_rows || DEFAULT_LABEL_KEYBOARD_ROWS;
  keyToLabel = Object.fromEntries(LABELS.map((l) => [l.key, l.id]));
}

function participantColor(participantId) {
  const idx = Math.max(0, (participantId || 1) - 1);
  return PARTICIPANT_COLORS[idx % PARTICIPANT_COLORS.length];
}

function usesGroupedVideoList() {
  return !!videoDateFilter;
}

function dateKeyFromSavedAt(savedAt) {
  if (!savedAt) return "unknown";
  const d = new Date(Number(savedAt) * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayDateKey() {
  return dateKeyFromSavedAt(Date.now() / 1000);
}

function isTodayDateKey(dateKey) {
  return dateKey === todayDateKey();
}

function formatDateGroupHeader(dateKey) {
  if (dateKey === "unknown") return "Unknown date";
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const label = dt.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  if (isTodayDateKey(dateKey)) return `Today · ${label}`;
  const today = new Date();
  const yesterday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 1
  );
  if (dateKey === dateKeyFromSavedAt(yesterday.getTime() / 1000)) {
    return `Yesterday · ${label}`;
  }
  return label;
}

function formatSavedTime(savedAt) {
  if (!savedAt) return "—";
  return new Date(Number(savedAt) * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isDateGroupExpanded(dateKey, filterDate) {
  if (filterDate) return dateKey === filterDate;
  if (boardDateExpandState.has(dateKey)) {
    return boardDateExpandState.get(dateKey);
  }
  return isTodayDateKey(dateKey);
}

function labelerName(labelers, participantId, userId) {
  if (userId) return userId;
  const key = String(participantId ?? "");
  return labelers?.[key] ?? labelers?.[participantId] ?? `Annotator #${participantId}`;
}

function formatLabelerList(labelerNames) {
  if (!labelerNames?.length) return "Unknown labeler";
  return labelerNames.join(", ");
}

function createVideoListButton(video, onSelect) {
  const btn = document.createElement("button");
  btn.type = "button";
  const time = formatSavedTime(video.saved_at);
  const labelers = formatLabelerList(video.labeler_names);
  btn.innerHTML = `<strong class="video-list-id">${video.video_id}</strong><span class="video-list-meta">${video.event_count} events · ${time}</span><span class="video-list-labelers">${labelers}</span>`;
  btn.addEventListener("click", () => onSelect(video, btn));
  return btn;
}

function computeSegmentCoreBounds(index, total, windowSec = 30) {
  const x = Math.max(total, 1);
  const base = windowSec / x;
  if (index === 1) {
    return { coreStart: 0, coreEnd: Math.min(windowSec, base + FIRST_PART_EXTRA_SEC) };
  }
  const firstEnd = Math.min(windowSec, base + FIRST_PART_EXTRA_SEC);
  const remaining = windowSec - firstEnd;
  const sliceOther = remaining / (x - 1);
  const coreStart = firstEnd + sliceOther * (index - 2);
  return { coreStart, coreEnd: coreStart + sliceOther };
}

function computeSegmentBounds(index, total, windowSec = 30) {
  const { coreStart, coreEnd } = computeSegmentCoreBounds(index, total, windowSec);
  const playStart = Math.max(0, coreStart - 1);
  const playEnd = Math.min(windowSec, coreEnd + 1);
  return { coreStart, coreEnd, playStart, playEnd };
}

function timelineSegmentsFromBounds(
  playStart,
  playEnd,
  coreStart,
  coreEnd,
  windowSec
) {
  const segs = [];
  let t = 0;
  const push = (to, type) => {
    const end = Math.min(to, windowSec);
    if (end > t + 0.001) {
      segs.push({ from: t, to: end, type });
      t = end;
    }
  };
  if (playStart > 0) push(playStart, "disabled");
  if (coreStart > playStart) push(coreStart, "padding");
  if (coreEnd > coreStart) push(coreEnd, "core");
  if (playEnd > coreEnd) push(playEnd, "padding");
  if (windowSec > playEnd) push(windowSec, "disabled");
  return segs;
}

function updateTimelineZones() {
  if (!timelineTrack) return;
  const windowSec = jobWindowSec || 30;
  const segs = timelineSegmentsFromBounds(
    jobPlayGlobalStart,
    jobPlayGlobalEnd,
    jobCoreGlobalStart,
    jobCoreGlobalEnd,
    windowSec
  );
  timelineTrack.innerHTML = segs
    .map(({ from, to, type }) => {
      const pct = ((to - from) / windowSec) * 100;
      return `<div class="timeline-zone timeline-zone-${type}" style="width:${pct}%"></div>`;
    })
    .join("");
}

function isInAnnotationRange(globalT) {
  return (
    globalT >= jobCoreGlobalStart - 0.001 &&
    globalT <= jobCoreGlobalEnd + 0.001
  );
}

function canEditAnnotations() {
  return !!currentJobId && !annotationsLocked && !!video.src;
}

function setAnnotationsLocked(locked) {
  annotationsLocked = locked;
  document.body.classList.toggle("annotations-locked", locked);
  if (labelButtons) {
    labelButtons.querySelectorAll(".label-btn").forEach((btn) => {
      btn.disabled = locked;
    });
  }
  renderSessionEvents();
}

function roundTimeSec(timeSec) {
  return Math.round(Number(timeSec) * 100) / 100;
}

function findMyEventAtTime(timeSec) {
  const t = roundTimeSec(timeSec);
  return jobEvents.find(
    (e) =>
      e.participant_id === myParticipantId &&
      roundTimeSec(e.time_sec) === t
  );
}

function seekToEvent(event) {
  if (!video.src || !event) return;
  video.pause();
  video.currentTime = localTimeFromGlobal(event.time_sec);
  updateVideoHud();
  updatePlayPauseButton();
}

function setStatusMessage(text, target = roleStatus) {
  if (target) target.textContent = text;
  else if (jobInfo) jobInfo.textContent = text;
}

function showConnectionStatus(text, ok = false) {
  if (!connectionStatus) return;
  connectionStatus.textContent = text;
  connectionStatus.classList.toggle("hidden", !text);
  connectionStatus.classList.toggle("ok", !!ok && !!text);
}

function clearConnectionStatus() {
  showConnectionStatus("", false);
}

function tracksPresenceRole() {
  return role === "annotator" || role === "test";
}

function isActivelyAnnotating() {
  return !!currentJobId && !annotationsLocked;
}

function updatePresenceUi() {
  if (!btnPresence) return;
  btnPresence.classList.toggle("online", presenceOnline);
  btnPresence.classList.toggle("offline", !presenceOnline);
  btnPresence.textContent = presenceOnline ? "Online" : "I am Online";
  btnPresence.setAttribute("aria-pressed", presenceOnline ? "true" : "false");
}

function showPresenceOverlay() {
  presenceOverlay?.classList.remove("hidden");
  document.body.classList.add("presence-prompt-open");
}

function hidePresenceOverlay() {
  presenceOverlay?.classList.add("hidden");
  document.body.classList.remove("presence-prompt-open");
}

function sendPresenceOnline(online) {
  send({ type: "set_online", online: !!online });
}

function setPresenceOnline(online, { notifyServer = true } = {}) {
  presenceOnline = !!online;
  updatePresenceUi();
  if (notifyServer) {
    sendPresenceOnline(presenceOnline);
  }
  if (presenceOnline) {
    hidePresenceOverlay();
    if (isActivelyAnnotating()) {
      setAnnotationsLocked(false);
    }
    resetPresenceIdleTimer();
    showConnectionStatus("", false);
  } else {
    showPresenceOverlay();
    setAnnotationsLocked(true);
    if (presenceIdleTimer) {
      clearTimeout(presenceIdleTimer);
      presenceIdleTimer = null;
    }
  }
}

function onPresenceIdleTimeout() {
  presenceIdleTimer = null;
  if (!tracksPresenceRole()) return;
  if (isActivelyAnnotating()) {
    resetPresenceIdleTimer();
    return;
  }
  if (!presenceOnline) return;
  setPresenceOnline(false);
}

function resetPresenceIdleTimer() {
  if (presenceIdleTimer) {
    clearTimeout(presenceIdleTimer);
    presenceIdleTimer = null;
  }
  if (!tracksPresenceRole() || !presenceOnline) return;
  if (isActivelyAnnotating()) {
    presenceIdleTimer = setTimeout(resetPresenceIdleTimer, PRESENCE_ACTIVE_RECHECK_MS);
    return;
  }
  presenceIdleTimer = setTimeout(onPresenceIdleTimeout, PRESENCE_IDLE_MS);
}

function onPresenceUserActivity() {
  if (!tracksPresenceRole() || !presenceOnline) return;
  if (presenceOverlay && !presenceOverlay.classList.contains("hidden")) return;
  resetPresenceIdleTimer();
}

function bindPresenceActivityListeners() {
  if (presenceListenersBound) return;
  presenceListenersBound = true;
  const events = ["mousedown", "keydown", "touchstart", "wheel", "click", "scroll"];
  events.forEach((name) => {
    document.addEventListener(name, onPresenceUserActivity, { passive: true });
  });
}

function initPresenceTracking(online = true) {
  if (!btnPresence && !presenceOverlay) return;
  bindPresenceActivityListeners();
  presenceOnline = online !== false;
  updatePresenceUi();
  if (presenceOnline) {
    hidePresenceOverlay();
    resetPresenceIdleTimer();
  } else {
    showPresenceOverlay();
    setAnnotationsLocked(true);
  }
}

function stopPresenceTracking() {
  if (presenceIdleTimer) {
    clearTimeout(presenceIdleTimer);
    presenceIdleTimer = null;
  }
  hidePresenceOverlay();
}

function bindPresenceControls() {
  btnPresence?.addEventListener("click", () => {
    if (!presenceOnline) {
      setPresenceOnline(true);
    }
  });
  btnPresenceConfirm?.addEventListener("click", () => {
    setPresenceOnline(true);
  });
}

function handlePresenceStatus(data) {
  setPresenceOnline(data.online === true, { notifyServer: false });
}

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
    if (IS_PRACTICE_PAGE) stopTestNextCountdown(true);
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
  wsConnectingPromise = null;
  if (ws) {
    ws.close();
    ws = null;
  }
}

function redirectToLogin() {
  clearSession();
  window.location.replace("/login");
}

function hideAppBoot() {
  document.body.classList.add("app-ready");
}

async function checkAuthStatus() {
  try {
    const res = await fetch("/api/auth/status", { credentials: "same-origin" });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.authenticated;
  } catch {
    return false;
  }
}

async function ensureAuthenticated() {
  const ok = await checkAuthStatus();
  if (!ok) {
    redirectToLogin();
    return false;
  }
  return true;
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
    redirectToLogin();
    throw new Error("Not authenticated");
  }
  return res;
}

async function logout() {
  stopPresenceTracking();
  clearSession();
  role = null;
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    /* ignore */
  }
  redirectToLogin();
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
  if (!IS_PRACTICE_PAGE || !testNextCountdown || !testNextValue) return;
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
  if (IS_PRACTICE_PAGE) stopTestNextCountdown(true);
  apiCountdown.classList.remove("hidden", "done");
  apiCountdown.classList.add("active");
  setAnnotationsLocked(false);
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
      setAnnotationsLocked(true);
      if (IS_PRACTICE_PAGE) {
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
  window.location.href = "/annotator";
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
  resetPresenceIdleTimer();
}

function jobSecondsLeft(data) {
  return normalizeApiSecondsLeft(data);
}

function goToAnnotatorForJob(data) {
  if (IS_PRACTICE_PAGE) {
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
  const windowSec = data.segment_window_sec ?? ack.segment_window_sec ?? 30;
  const slice = windowSec / total;
  const globalStart =
    ack.time_origin_sec ?? data.time_origin_sec ?? slice * (index - 1);
  const playbackStart =
    ack.start_offset_sec ?? data.start_offset_sec ?? (index === 1 ? globalStart : 0);
  const playbackEnd =
    ack.segment_end_sec ??
    data.segment_end_sec ??
    (index === 1 ? globalStart + slice : slice);
  return {
    ...data,
    annotator_index: index,
    annotator_total: total,
    start_offset_sec: playbackStart,
    time_origin_sec: globalStart,
    segment_end_sec: playbackEnd,
    clip_duration_sec: ack.clip_duration_sec ?? data.clip_duration_sec ?? slice,
    segment_window_sec: windowSec,
  };
}

function applyJobTiming(data) {
  const index = data.annotator_index ?? 1;
  const total = data.annotator_total ?? 1;
  const windowSec = data.segment_window_sec ?? 30;
  const bounds = computeSegmentBounds(index, total, windowSec);
  jobCoreGlobalStart = data.segment_core_start_sec ?? bounds.coreStart;
  jobCoreGlobalEnd = data.segment_core_end_sec ?? bounds.coreEnd;
  jobPlayGlobalStart = bounds.playStart;
  jobPlayGlobalEnd = bounds.playEnd;
  if (data.time_origin_sec != null) {
    jobPlayGlobalStart = data.time_origin_sec;
    if (data.segment_end_sec != null) {
      jobPlayGlobalEnd = data.time_origin_sec + data.segment_end_sec;
    }
  } else if (data.segment_core_start_sec != null) {
    jobPlayGlobalStart = Math.max(0, jobCoreGlobalStart - 1);
    jobPlayGlobalEnd = Math.min(windowSec, jobCoreGlobalEnd + 1);
  }
  const playbackStart =
    data.start_offset_sec ?? (index === 1 ? jobPlayGlobalStart : 0);
  const playbackEnd =
    data.segment_end_sec ??
    (index === 1 ? jobPlayGlobalEnd : jobPlayGlobalEnd - jobPlayGlobalStart);
  jobPlaybackStart = playbackStart;
  jobTimeOrigin = data.time_origin_sec ?? jobPlayGlobalStart;
  jobPlaybackEnd = playbackEnd;
  jobWindowSec = windowSec;
  updateTimelineZones();
}

function stripVideoUrlHash(url) {
  if (!url) return "";
  const i = url.indexOf("#");
  return i >= 0 ? url.slice(0, i) : url;
}

function jobVideoId(data) {
  const index = data.annotator_index ?? 1;
  if (index === 1 && data.original_video_id) {
    return data.original_video_id;
  }
  return data.video_id || data.original_video_id || null;
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

    callVideoApi();
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

    ws.onmessage = (ev) => {
      try {
        handleMessage(JSON.parse(ev.data));
      } catch (err) {
        console.error("WebSocket message error:", err);
      }
    };

    ws.onclose = (ev) => {
      wsAuthed = false;
      wsConnectingPromise = null;
      if (ev.code === 1008) {
        redirectToLogin();
        return;
      }
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

function globalTimeFromVideo() {
  return (video.currentTime || 0) + (jobTimeOrigin || 0);
}

function localTimeFromGlobal(globalT) {
  return globalT - (jobTimeOrigin || 0);
}

function updateVideoHud() {
  if (!video.src) return;
  const globalT = globalTimeFromVideo();
  const frame = timeToFrame(globalT);
  if (videoTimeDisplay) videoTimeDisplay.textContent = formatTime(globalT);
  if (videoFrameDisplay) videoFrameDisplay.textContent = `frame ${frame}`;
  if (videoSeek) {
    seekSyncing = true;
    videoSeek.min = "0";
    videoSeek.max = String(jobWindowSec || 30);
    videoSeek.value = String(
      Math.min(jobWindowSec || 30, Math.max(0, globalT))
    );
    seekSyncing = false;
  }
  updatePlayPauseButton();
}

function updateTimelineSeekRange() {
  if (!videoSeek) return;
  videoSeek.min = "0";
  videoSeek.max = String(jobWindowSec || 30);
  videoSeek.step = "0.01";
  updateTimelineZones();
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
    marker.dataset.labelName || labelDisplayName(marker.dataset.label) || "Event";
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
  if (!video.src) {
    timelineMarkers.innerHTML = "";
    hideTimelineMarkerTooltip();
    return;
  }
  const windowSec = jobWindowSec || 30;
  timelineMarkers.innerHTML = jobEvents
    .slice()
    .sort((a, b) => a.time_sec - b.time_sec)
    .map((e) => {
      const pct = Math.min(100, Math.max(0, (e.time_sec / windowSec) * 100));
      const color = LABEL_COLORS[e.label] || "#94a3b8";
      const mine = e.participant_id === myParticipantId;
      const labelName = labelDisplayName(e.label);
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

function playbackLocalBounds() {
  const start = localTimeFromGlobal(jobPlayGlobalStart);
  let end = localTimeFromGlobal(jobPlayGlobalEnd);
  if (video.duration && Number.isFinite(video.duration)) {
    end = Math.min(end, video.duration);
  }
  return { start, end: Math.max(start, end) };
}

function clampPlaybackToSegment() {
  if (video.paused) return;
  const { start, end } = playbackLocalBounds();
  if (video.currentTime < start - 0.05) {
    video.currentTime = start;
  }
  if (Number.isFinite(end) && video.currentTime >= end - 0.05) {
    video.pause();
    video.currentTime = end;
  }
}

function stepFrame(delta) {
  if (!video.src) return;
  const frameTime = 1 / videoFps;
  const { start, end } = playbackLocalBounds();
  video.pause();
  video.currentTime = Math.min(
    end,
    Math.max(start, video.currentTime + delta * frameTime)
  );
  updateVideoHud();
}

function startArrowHold(dir) {
  stopArrowHold();
  stepFrame(dir);
  arrowHoldDir = dir;
  arrowHoldDelay = setTimeout(() => {
    arrowHoldDelay = null;
    arrowHoldTimer = setInterval(() => stepFrame(dir), ARROW_HOLD_INTERVAL_MS);
  }, ARROW_HOLD_DELAY_MS);
}

function stopArrowHold() {
  if (arrowHoldDelay) {
    clearTimeout(arrowHoldDelay);
    arrowHoldDelay = null;
  }
  if (arrowHoldTimer) {
    clearInterval(arrowHoldTimer);
    arrowHoldTimer = null;
  }
  arrowHoldDir = 0;
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
  const labelById = Object.fromEntries(LABELS.map((l) => [l.id, l]));
  labelKeyboardRows.forEach((row, rowIndex) => {
    row.forEach((labelId) => {
      const label = labelById[labelId];
      if (!label) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `label-btn kb-row-${rowIndex}`;
      btn.dataset.label = label.id;
      btn.textContent = `${label.display.toUpperCase()} (${formatLabelKey(label.key)})`;
      btn.title = `${label.display} — ${label.id}`;
      btn.addEventListener("click", () => annotate(label.id));
      labelButtons.appendChild(btn);
    });
  });
}

function showOverlay(labelId, frame) {
  if (!overlay) return;
  const name = labelDisplayName(labelId);
  overlay.innerHTML = `<span class="overlay-label">${name}</span><span class="overlay-frame">frame ${frame}</span>`;
  overlay.classList.remove("hidden");
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => {
    overlay.classList.add("hidden");
  }, 500);
}

function renderSessionEvents() {
  if (!eventsList) return;
  const editable = canEditAnnotations();
  eventsList.innerHTML = jobEvents
    .slice()
    .sort((a, b) => a.time_sec - b.time_sec)
    .map((e) => {
      const labelName = labelDisplayName(e.label);
      const mine = e.participant_id === myParticipantId;
      const who = mine ? "you" : `#${e.participant_id}`;
      const color = participantColor(e.participant_id);
      const style = `border-left: 4px solid ${color}`;
      const text = `frame ${e.frame} · ${e.time_sec.toFixed(2)}s — ${labelName} (${who})`;
      const gotoBtn = `<button type="button" class="event-item event-goto" data-event-id="${e.id}" data-time-sec="${e.time_sec}" title="Go to this frame">${text}</button>`;
      const deleteBtn =
        mine && editable
          ? `<button type="button" class="event-delete" data-event-id="${e.id}" title="Delete annotation" aria-label="Delete annotation">${EVENT_DELETE_ICON}</button>`
          : "";
      return `<li class="event-row${mine ? " event-row-mine" : ""}" style="${style}">${gotoBtn}${deleteBtn}</li>`;
    })
    .join("");
}

function removeSessionEvent(eventId) {
  if (!canEditAnnotations()) return;
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
  if (!canEditAnnotations()) return;
  const time_sec = globalTimeFromVideo();
  if (!isInAnnotationRange(time_sec)) return;
  const frame = timeToFrame(time_sec);
  const existing = findMyEventAtTime(time_sec);
  if (existing) {
    if (existing.label === labelId) return;
    removeSessionEvent(existing.id);
  }
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
  setAnnotationsLocked(false);
  resetPresenceIdleTimer();
  jobEvents = [];
  sessionEvents = [];
  nextEventId = 0;
  applyJobTiming(data);
  if (data.annotator_id != null) myParticipantId = data.annotator_id;
  renderSessionEvents();
  renderTimelineMarkers();

  const index = data.annotator_index ?? 1;
  const total = data.annotator_total ?? 1;
  const prefix = IS_PRACTICE_PAGE ? "Practice round" : "Job active";
  if (jobInfo) {
    jobInfo.textContent = `${prefix} · waiting for video ${videoId}… · ${index}/${total}`;
  }

  showVideoReady();
  video.pause();
  const url = await waitForServerVideo(videoId, secondsLeft);
  if (!url) {
    setStatusMessage(`Video not ready before deadline (${videoId})`, jobInfo);
    hideVideoReady();
    return;
  }

  if (jobInfo) {
    jobInfo.textContent = `${prefix} · global ${jobTimeOrigin.toFixed(1)}s · ${index}/${total}`;
  }

  try {
    await waitForVideoMetadata(url);
    const offset = jobPlaybackStart || 0;
    await waitForVideoAtOffset(offset);
    updateTimelineSeekRange();
    updateTimelineZones();
    estimateFps();
    try {
      video.currentTime = offset;
      await video.play();
    } catch {
      video.muted = true;
      video.currentTime = offset;
      await video.play();
    }
    startVideoHudLoop();
    updateVideoHud();
    renderTimelineMarkers();
  } catch {
    setStatusMessage(`Video failed to load (${videoId})`, jobInfo);
  } finally {
    hideVideoReady();
  }
}

function handleAnnotateStart(data) {
  notifyNewAnnotationJob();
  goToAnnotatorForJob(data);
}

function handleDuplicateCacheHit(data) {
  const msg =
    data.message ||
    "This video was already annotated. Stop working — your labels will not be saved.";
  showConnectionStatus(msg, false);
  setStatusMessage(msg, jobInfo);
  stopApiCountdown(true);
  stopVideoPoll();
  stopVideoHudLoop();
  setAnnotationsLocked(true);
  currentJobId = null;
  loadedVideoJobId = null;
  jobEvents = [];
  sessionEvents = [];
  renderSessionEvents();
  renderTimelineMarkers();
  hideVideoReady();
  video.pause();
  video.removeAttribute("src");
  updatePlayPauseButton();
  updateVideoHud();
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
        sessionInfo.textContent = `Practice test · annotator #${data.annotator_index} of ${data.annotator_total} · offset ${Number(data.start_offset_sec ?? 0).toFixed(2)}s`;
        if (!pendingTestJob) {
          jobInfo.textContent = "Next practice round loads automatically twice per minute…";
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
        sessionInfo.textContent = `You are annotator #${data.annotator_index} of ${data.annotator_total} · offset ${Number(data.start_offset_sec ?? 0).toFixed(2)}s`;
        if (!pendingAnnotateJob) {
          jobInfo.textContent = "Waiting for API request…";
        }
        clearConnectionStatus();
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
      if (data.role === "annotator" || data.role === "test") {
        initPresenceTracking(data.online !== false);
      } else {
        stopPresenceTracking();
      }
      hideRoleModal();
      break;
    case "presence_status":
      handlePresenceStatus(data);
      break;
    case "annotator_count":
      if (sessionInfo && isAnnotatingRole()) {
        const online = data.online_count ?? data.count;
        sessionInfo.textContent = `Annotators: ${online} online / ${data.count} connected`;
      }
      break;
    case "annotate_start":
      handleAnnotateStart(data);
      break;
    case "job_event":
      handleJobEvent(data);
      break;
    case "test_start":
      if (IS_PRACTICE_PAGE) handleTestStart(data);
      break;
    case "test_schedule":
      if (IS_PRACTICE_PAGE) handleTestSchedule(data);
      break;
    case "videos_list":
      renderVideoList(data.videos);
      break;
    case "videos_updated":
      if (role === "reviewer") {
        send({ type: "list_videos" });
      }
      break;
    case "duplicate_cache_hit":
      handleDuplicateCacheHit(data);
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
  } catch {
    const msg = "Could not connect to server. Refresh and try again.";
    setStatusMessage(msg);
    showConnectionStatus(msg);
  }
}

async function switchToRole(selectedRole) {
  if (selectedRole === role) {
    hideRoleModal();
    return;
  }
  hideRoleModal();
  if (tracksPresenceRole()) {
    stopPresenceTracking();
  }
  role = selectedRole;
  send({ type: "set_role", role: selectedRole });
}

document.addEventListener(
  "keydown",
  (e) => {
    if (!isAnnotatingRole()) return;

    if (e.code === "Space") {
      e.preventDefault();
      togglePlayPause();
      return;
    }

    if (e.code === "ArrowLeft") {
      e.preventDefault();
      if (!e.repeat) startArrowHold(-1);
      return;
    }

    if (e.code === "ArrowRight") {
      e.preventDefault();
      if (!e.repeat) startArrowHold(1);
      return;
    }

    if (e.target.matches("input, textarea, select")) return;

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const labelId = keyToLabel[key];
    if (labelId) {
      e.preventDefault();
      annotate(labelId);
    }
  },
  true
);

document.addEventListener(
  "keyup",
  (e) => {
    if (!isAnnotatingRole()) return;
    if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
      stopArrowHold();
    }
  },
  true
);

requestNotificationPermission();

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

async function bootApp() {
  if (!(await ensureAuthenticated())) {
    hideAppBoot();
    return;
  }

  try {
    await loadLabelConfig();
  } catch {
    setStatusMessage("Could not load label configuration.");
    showConnectionStatus("Could not load label configuration.");
    return;
  } finally {
    hideAppBoot();
  }

  document.querySelectorAll("#btn-logout, [data-action=logout]").forEach((btn) => {
    btn.addEventListener("click", logout);
  });

  if (IS_ANNOTATOR_PAGE || IS_PRACTICE_PAGE) {
    bindPresenceControls();
  }

  if (IS_PRACTICE_PAGE) {
    document.body.classList.add("no-scroll");
    buildLabelButtons();
    showScreen(annotatorScreen);
    await enterRole("test");
    return;
  }

  if (IS_ANNOTATOR_PAGE) {
    document.body.classList.add("no-scroll");
    showScreen(annotatorScreen);
    buildLabelButtons();
    const raw = sessionStorage.getItem(PENDING_ANNOTATE_KEY);
    if (raw) {
      try {
        pendingAnnotateJob = JSON.parse(raw);
      } catch {
        pendingAnnotateJob = null;
      }
      sessionStorage.removeItem(PENDING_ANNOTATE_KEY);
    }
    showConnectionStatus("Connecting…");
    await enterRole("annotator");
    return;
  }

  if (IS_BOARD_PAGE) {
    bindReviewHandlers();
    document.body.classList.add("no-scroll");
    showScreen(reviewerScreen);
    await enterRole("reviewer");
    return;
  }

  bindRoleScreenHandlers();
  const resumed = await resumePendingAnnotateJob();
  if (!resumed) {
    connectWebSocket().catch(() => {});
    showScreen(roleScreen);
  }
}

function bindReviewHandlers() {
  document.getElementById("btn-refresh-videos")?.addEventListener("click", () => {
    send({ type: "list_videos" });
  });
  videoDateFilter?.addEventListener("change", () => {
    renderVideoList(boardVideosCache);
  });
  btnClearDateFilter?.addEventListener("click", () => {
    if (videoDateFilter) videoDateFilter.value = "";
    renderVideoList(boardVideosCache);
  });
}

bootApp();

btnPlayPause?.addEventListener("click", togglePlayPause);

videoSeek?.addEventListener("input", () => {
  if (seekSyncing) return;
  const globalT = parseFloat(videoSeek.value);
  const clamped = Math.min(
    jobPlayGlobalEnd,
    Math.max(jobPlayGlobalStart, globalT)
  );
  video.currentTime = localTimeFromGlobal(clamped);
  updateVideoHud();
});

timelineMarkers?.addEventListener("click", (e) => {
  const btn = e.target.closest(".timeline-marker");
  if (!btn) return;
  const globalTime = parseFloat(btn.dataset.time);
  video.currentTime = localTimeFromGlobal(globalTime);
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
  const deleteBtn = e.target.closest(".event-delete");
  if (deleteBtn) {
    e.preventDefault();
    const eventId = Number(deleteBtn.dataset.eventId);
    if (Number.isFinite(eventId)) removeSessionEvent(eventId);
    return;
  }
  const gotoBtn = e.target.closest(".event-goto");
  if (!gotoBtn) return;
  const eventId = Number(gotoBtn.dataset.eventId);
  const ev = jobEvents.find((x) => x.id === eventId);
  if (ev) seekToEvent(ev);
});

if (video) {
  video.addEventListener("play", updatePlayPauseButton);
  video.addEventListener("pause", updatePlayPauseButton);
  video.addEventListener("seeked", updateVideoHud);
  video.addEventListener("loadedmetadata", () => {
    estimateFps();
    updateTimelineSeekRange();
    renderTimelineMarkers();
  });
}

function renderVideoList(videos) {
  if (!videoList) return;
  boardVideosCache = videos || [];
  videoList.innerHTML = "";
  if (!boardVideosCache.length) {
    videoList.innerHTML = "<li><em>No saved videos yet</em></li>";
    return;
  }

  if (!usesGroupedVideoList()) {
    boardVideosCache.forEach((v) => {
      const li = document.createElement("li");
      li.appendChild(
        createVideoListButton(v, (video, btn) => loadReviewerVideo(video, btn))
      );
      videoList.appendChild(li);
    });
    return;
  }

  const filterDate = videoDateFilter?.value || "";
  const groups = new Map();
  for (const video of boardVideosCache) {
    const key = dateKeyFromSavedAt(video.saved_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(video);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => Number(b.saved_at || 0) - Number(a.saved_at || 0));
  }
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    if (a === "unknown") return 1;
    if (b === "unknown") return -1;
    return b.localeCompare(a);
  });
  const visibleKeys = filterDate
    ? sortedKeys.filter((key) => key === filterDate)
    : sortedKeys;

  if (!visibleKeys.length) {
    videoList.innerHTML = "<li><em>No videos on this date</em></li>";
    return;
  }

  for (const dateKey of visibleKeys) {
    const groupVideos = groups.get(dateKey) || [];
    const expanded = isDateGroupExpanded(dateKey, filterDate);
    const section = document.createElement("li");
    section.className = "video-list-date-group";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "video-list-date-toggle";
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    toggle.innerHTML = `<span class="video-list-date-chevron" aria-hidden="true">${expanded ? "▾" : "▸"}</span><span class="video-list-date-label">${formatDateGroupHeader(dateKey)}</span><span class="video-list-date-count">${groupVideos.length}</span>`;
    toggle.addEventListener("click", () => {
      const next = !isDateGroupExpanded(dateKey, filterDate);
      boardDateExpandState.set(dateKey, next);
      renderVideoList(boardVideosCache);
    });

    const items = document.createElement("ul");
    items.className = `video-list-date-items${expanded ? "" : " collapsed"}`;
    for (const video of groupVideos) {
      const row = document.createElement("li");
      row.appendChild(
        createVideoListButton(video, (entry, btn) => loadReviewerVideo(entry, btn))
      );
      items.appendChild(row);
    }

    section.appendChild(toggle);
    section.appendChild(items);
    videoList.appendChild(section);
  }
}

function normalizeReviewerEvents(data) {
  const labelers = data.labelers || {};
  const source = data.events?.length
    ? data.events
    : (data.predictions || []).map((item) => {
        if (item.action != null) {
          const frame = item.frame ?? 0;
          return {
            frame,
            label: item.action,
            time_sec: frame / videoFps,
            participant_id: item.participant_id,
            user_id: item.user_id,
          };
        }
        return {
          frame: item.frame ?? timeToFrame(item.time_sec),
          label: item.label,
          time_sec: item.time_sec,
          participant_id: item.participant_id,
          user_id: item.user_id,
        };
      });
  return {
    labelers: { ...labelers, ..._labelersFromEvents(source) },
    events: source,
  };
}

function _labelersFromEvents(events) {
  const labelers = {};
  for (const event of events) {
    const pid = event.participant_id;
    const uid = event.user_id;
    if (pid != null && uid) labelers[String(pid)] = uid;
  }
  return labelers;
}

function renderReviewerEvents(events, labelers) {
  if (!reviewerEvents) return;
  const rows = events
    .slice()
    .sort((a, b) => Number(a.time_sec) - Number(b.time_sec))
    .map((e) => {
      const pid = e.participant_id ?? 1;
      const color = participantColor(pid);
      const who = labelerName(labelers, pid, e.user_id);
      const labelName = labelDisplayName(e.label);
      const frame = e.frame ?? timeToFrame(e.time_sec);
      const text = `frame ${frame} · ${Number(e.time_sec).toFixed(2)}s — ${labelName} (${who})`;
      return `<li class="event-row" style="border-left: 4px solid ${color}"><button type="button" class="event-item event-goto" data-time="${e.time_sec}">${text}</button></li>`;
    });
  reviewerEvents.innerHTML = rows.length
    ? rows.join("")
    : "<li><em>No annotations</em></li>";
  reviewerEvents.querySelectorAll("button.event-goto").forEach((b) => {
    b.addEventListener("click", () => {
      reviewerVideo.pause();
      reviewerVideo.currentTime = parseFloat(b.dataset.time);
    });
  });
}

async function loadReviewerVideo(item, btn) {
  videoList?.querySelectorAll("button.active").forEach((b) => {
    b.classList.remove("active");
  });
  btn.classList.add("active");
  const vid = item.video_id;
  reviewerVideo.src = vid
    ? new URL(serverVideoApiPath(vid), location.origin).href
    : item.video_url || "";
  const labelerLine = formatLabelerList(item.labeler_names);
  reviewerMeta.innerHTML = `<div><strong>${vid}</strong></div>${item.video_url ? `<div class="reviewer-meta-url">${item.video_url}</div>` : ""}<div class="reviewer-meta-labelers">Labeled by: ${labelerLine}</div></div>`;
  try {
    const res = await apiFetch(item.annotations_file);
    const data = await res.json();
    const { events, labelers } = normalizeReviewerEvents(data);
    renderReviewerEvents(events, labelers);
  } catch {
    reviewerEvents.innerHTML = "<li>Failed to load annotations</li>";
  }
}
