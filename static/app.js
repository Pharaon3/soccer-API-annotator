const DEFAULT_FPS = 25;
const FIRST_PART_EXTRA_SEC = 3;
const ARROW_HOLD_DELAY_MS = 60;
const ARROW_HOLD_INTERVAL_MS = 28;
const API_RESPONSE_FALLBACK_SEC = 26;
const API_CALL_INTERVAL_SEC = 3600;
const API_NEXT_WARN_5_MIN_SEC = 5 * 60;
const API_NEXT_WARN_1_MIN_SEC = 60;
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
const videoDateFilterLabel = document.getElementById("video-date-filter-label");
const btnClearDateFilter = document.getElementById("btn-clear-date-filter");
const btnDatePickerOpen = document.getElementById("btn-date-picker-open");
const boardVideoSeek = document.getElementById("board-video-seek");
const boardTimelineMarkers = document.getElementById("board-timeline-markers");
const boardVideoTimeline = document.getElementById("board-video-timeline");
const boardTimelineTrack = document.getElementById("board-timeline-track");
const boardBtnPlayPause = document.getElementById("board-btn-play-pause");
const boardVideoTimeDisplay = document.getElementById("board-video-time-display");
const boardVideoFrameDisplay = document.getElementById("board-video-frame-display");
const boardVideoLoading = document.getElementById("board-video-loading");
const apiNextCountdown = document.getElementById("api-next-countdown");
const apiNextValue = document.getElementById("api-next-value");
const apiNextVideoCountdown = document.getElementById("api-next-video-countdown");
const apiNextVideoValue = document.getElementById("api-next-video-value");

let boardVideosCache = [];
const boardDateExpandState = new Map();
let boardEvents = [];
let boardLabelers = {};
let boardWindowSec = 30;
let boardSeekSyncing = false;
let boardFrameRafId = null;
let boardTimelineTooltip = null;
let apiNextWarned5Min = false;
let apiNextWarned1Min = false;
let apiNextDeadlinePerf = null;
let apiNextRafId = null;
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
const btnPracticeSync = document.getElementById("btn-practice-sync");
const btnPracticePrivate = document.getElementById("btn-practice-private");
const practiceModeHint = document.getElementById("practice-mode-hint");
const practiceVideoPanel = document.getElementById("practice-video-panel");
const practiceEventsHeading = document.getElementById("practice-events-heading");

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
let practiceMode = "sync";
let testNextDeadline = null;
let pendingTestJob = null;
let nextTestRoundAtSec = null;
let loadedVideoJobId = null;
let videoPollAbort = null;
let annotationsLocked = false;
let selectedEventId = null;

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
  return IS_BOARD_PAGE || PAGE === "review" || IS_PRACTICE_PAGE || !!videoDateFilter;
}

function videoListOnSelect() {
  if (isPrivatePractice()) {
    return (video, btn) => startPrivatePractice(video, btn);
  }
  return (video, btn) => loadReviewerVideo(video, btn);
}

function isPrivatePractice() {
  return IS_PRACTICE_PAGE && practiceMode === "private";
}

function isSyncPractice() {
  return IS_PRACTICE_PAGE && practiceMode === "sync";
}

function hasBoardTimeline() {
  return !!boardVideoSeek && !!reviewerVideo;
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

function formatDateFilterLabel(dateKey) {
  if (!dateKey) return "All dates";
  if (isTodayDateKey(dateKey)) return "Today";
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function updateDateFilterLabel() {
  if (!videoDateFilterLabel) return;
  videoDateFilterLabel.textContent = formatDateFilterLabel(videoDateFilter?.value || "");
}

function yesterdayDateKey() {
  const today = new Date();
  const yesterday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 1
  );
  return dateKeyFromSavedAt(yesterday.getTime() / 1000);
}

function setVideoDateFilter(dateKey) {
  if (!videoDateFilter) return;
  videoDateFilter.value = dateKey || "";
  updateDateFilterLabel();
  renderVideoList(boardVideosCache);
}

function openDatePicker() {
  if (!videoDateFilter) return;
  if (typeof videoDateFilter.showPicker === "function") {
    videoDateFilter.showPicker();
    return;
  }
  videoDateFilter.focus();
  videoDateFilter.click();
}

function createVideoListButton(video, onSelect) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "video-card-btn";
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

const TEXT_ENTRY_INPUT_TYPES = new Set([
  "text",
  "search",
  "password",
  "email",
  "url",
  "tel",
  "number",
  "date",
  "datetime-local",
  "time",
  "month",
  "week",
]);

function isTextEntryElement(el) {
  if (!el || el.isContentEditable) return !!el?.isContentEditable;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    return TEXT_ENTRY_INPUT_TYPES.has(type);
  }
  return false;
}

function isAnnotatorShortcutBlocked(e) {
  if (e.isComposing) return true;
  const el = document.activeElement;
  if (isTextEntryElement(el)) return true;
  if (rolePickerModal && !rolePickerModal.classList.contains("hidden")) return true;
  return false;
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

function clearSelectedEvent() {
  if (selectedEventId == null) return;
  selectedEventId = null;
  renderSessionEvents();
}

function setSelectedEvent(eventId) {
  const ev = jobEvents.find((e) => e.id === eventId);
  if (
    !ev ||
    ev.participant_id !== myParticipantId ||
    !canEditAnnotations()
  ) {
    clearSelectedEvent();
    if (ev) seekToEvent(ev);
    return;
  }
  selectedEventId = eventId;
  renderSessionEvents();
  seekToEvent(ev);
}

function replaceSelectedEventLabel(labelId) {
  const ev = jobEvents.find(
    (e) => e.id === selectedEventId && e.participant_id === myParticipantId
  );
  if (!ev) {
    clearSelectedEvent();
    return;
  }
  if (ev.label === labelId) {
    removeSessionEvent(ev.id);
    clearSelectedEvent();
    return;
  }
  const oldLabel = ev.label;
  const time_sec = ev.time_sec;
  const frame = ev.frame ?? timeToFrame(time_sec);
  const pid = myParticipantId ?? 0;
  ev.label = labelId;
  ev.uid = `p${pid}-${roundTimeSec(time_sec)}-${labelId}`;
  sessionEvents = jobEvents.filter((x) => x.participant_id === myParticipantId);
  renderSessionEvents();
  renderTimelineMarkers();
  showOverlay(labelId, frame);
  if (isPrivatePractice()) return;
  send({
    type: "annotation_remove",
    job_id: currentJobId,
    time_sec,
    label: oldLabel,
    uid: `p${pid}-${roundTimeSec(time_sec)}-${oldLabel}`,
  });
  send({
    type: "annotation",
    job_id: currentJobId,
    label: labelId,
    time_sec,
    frame,
  });
}

function findMyEventAtTimeAndLabel(timeSec, labelId) {
  const t = roundTimeSec(timeSec);
  return jobEvents.find(
    (e) =>
      e.participant_id === myParticipantId &&
      roundTimeSec(e.time_sec) === t &&
      e.label === labelId
  );
}

function markerStackOffsetAtTime(events, timeSec, index) {
  const t = roundTimeSec(timeSec);
  const sameFrame = events.filter((e) => roundTimeSec(e.time_sec) === t);
  const idx = sameFrame.findIndex((e) => e === events[index]);
  if (idx <= 0) return 0;
  return idx * 13;
}

function seekToEvent(event) {
  if (!video.src || !event) return;
  video.pause();
  video.currentTime = localTimeFromGlobal(event.time_sec);
  updateVideoHud();
  updatePlayPauseButton();
}

function seekAnnotatorByClientX(clientX) {
  if (!videoTimeline || !video.src) return;
  const rect = videoTimeline.getBoundingClientRect();
  if (rect.width <= 0) return;
  const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const windowSec = jobWindowSec || 30;
  const globalT = pct * windowSec;
  const clamped = Math.min(jobPlayGlobalEnd, Math.max(jobPlayGlobalStart, globalT));
  clearSelectedEvent();
  video.pause();
  video.currentTime = localTimeFromGlobal(clamped);
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

function ensureWorkspaceOnline() {
  presenceOnline = true;
  updatePresenceUi();
  hidePresenceOverlay();
  sendPresenceOnline(true);
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
    if (IS_ANNOTATOR_PAGE) stopApiNextCountdown(true);
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
      if (IS_PRACTICE_PAGE && isSyncPractice()) {
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

function startApiCountdown(durationSec = API_RESPONSE_FALLBACK_SEC) {
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

function showDesktopNotification(title, body, tag = "annotator") {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }
  try {
    const n = new Notification(title, { body, tag });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* ignore */
  }
}

function notifyNewAnnotationJob() {
  showDesktopNotification(
    "Annotation ready",
    "Your video segment is ready — start labeling.",
    "annotate-job-ready"
  );
}

function notifyApiCallRequested(videoId) {
  showDesktopNotification(
    "New API annotation job",
    videoId
      ? `Video «${videoId}» was requested. Get ready to annotate.`
      : "A new annotation job was requested.",
    "api-call-started"
  );
}

function formatApiCountdown(secLeft) {
  const total = Math.max(0, Math.ceil(secLeft));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function showAnnotatorIdleCountdown(text = "—") {
  if (!IS_ANNOTATOR_PAGE || !apiNextVideoCountdown || !apiNextVideoValue) return;
  if (currentJobId) return;
  apiNextVideoValue.textContent = text;
  apiNextVideoCountdown.classList.remove("hidden");
}

function hideAnnotatorIdleCountdown() {
  if (!apiNextVideoCountdown) return;
  apiNextVideoCountdown.classList.add("hidden");
}

function stopApiNextCountdown(hide = false) {
  if (apiNextRafId !== null) {
    cancelAnimationFrame(apiNextRafId);
    apiNextRafId = null;
  }
  apiNextDeadlinePerf = null;
  if (!apiNextCountdown) return;
  apiNextCountdown.classList.remove("active", "urgent", "critical");
  if (hide) {
    apiNextCountdown.classList.add("hidden");
    if (apiNextValue) apiNextValue.textContent = "—";
  }
}

function showApiNextIdle() {
  if (!IS_ANNOTATOR_PAGE || !apiNextCountdown || !apiNextValue) return;
  stopApiNextCountdown();
  apiNextCountdown.classList.remove("hidden");
  apiNextCountdown.classList.add("active");
  apiNextValue.textContent = "—";
  showAnnotatorIdleCountdown("—");
}

function startApiNextCountdown(durationSec = API_CALL_INTERVAL_SEC) {
  const totalSec = Math.max(0, Number(durationSec) || API_CALL_INTERVAL_SEC);
  startApiNextCountdownAt(Date.now() / 1000 + totalSec);
}

function startApiNextCountdownAt(nextCallAtSec) {
  if (!IS_ANNOTATOR_PAGE || !apiNextCountdown || !apiNextValue) return;
  const targetMs = Number(nextCallAtSec) * 1000;
  if (!Number.isFinite(targetMs)) return;
  stopApiNextCountdown();
  apiNextWarned5Min = false;
  apiNextWarned1Min = false;
  apiNextCountdown.classList.remove("hidden");
  apiNextCountdown.classList.add("active");

  const tick = () => {
    const leftSec = Math.max(0, (targetMs - Date.now()) / 1000);
    if (leftSec <= 0) {
      apiNextValue.textContent = "0:00";
      apiNextCountdown.classList.remove("urgent", "critical");
      showAnnotatorIdleCountdown("0:00");
      apiNextRafId = null;
      return;
    }
    const display = formatApiCountdown(leftSec);
    apiNextValue.textContent = display;
    showAnnotatorIdleCountdown(display);
    apiNextCountdown.classList.toggle("urgent", leftSec <= API_NEXT_WARN_5_MIN_SEC);
    apiNextCountdown.classList.toggle("critical", leftSec <= API_NEXT_WARN_1_MIN_SEC);

    if (leftSec <= API_NEXT_WARN_5_MIN_SEC && !apiNextWarned5Min) {
      apiNextWarned5Min = true;
      showDesktopNotification(
        "Next API call soon",
        "About 5 minutes until the next annotation request is expected.",
        "api-next-5m"
      );
    }
    if (leftSec <= API_NEXT_WARN_1_MIN_SEC && !apiNextWarned1Min) {
      apiNextWarned1Min = true;
      showDesktopNotification(
        "Next API call in 1 minute",
        "Stay online — a new annotation request is expected soon.",
        "api-next-1m"
      );
    }
    apiNextRafId = requestAnimationFrame(tick);
  };
  apiNextRafId = requestAnimationFrame(tick);
}

function redirectToAnnotatorForApiCall(data) {
  sessionStorage.setItem(
    PENDING_ANNOTATE_KEY,
    JSON.stringify({
      api_pending: true,
      video_id: data?.video_id ?? null,
    })
  );
  window.location.href = "/annotator";
}

function handleApiCallStarted(data) {
  notifyApiCallRequested(data.video_id);
  if (data.next_call_at != null) {
    startApiNextCountdownAt(data.next_call_at);
  } else {
    startApiNextCountdown(data.interval_sec || API_CALL_INTERVAL_SEC);
  }
  if (IS_BOARD_PAGE || IS_PRACTICE_PAGE) {
    redirectToAnnotatorForApiCall(data);
    return;
  }
  if (data.video_id && role === "annotator") {
    showConnectionStatus(`API job started: ${data.video_id}`, true);
    if (jobInfo && !currentJobId) {
      jobInfo.textContent = `API job started · ${data.video_id} · waiting for video…`;
    }
    showVideoReady();
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
  if (Number.isFinite(n) && n > 0 && n <= 600) {
    return Math.ceil(n);
  }
  return API_RESPONSE_FALLBACK_SEC;
}

function beginJobCountdown(data) {
  startApiCountdownSecondsLeft(normalizeApiSecondsLeft(data));
  resetPresenceIdleTimer();
}

function jobSecondsLeft(data) {
  return normalizeApiSecondsLeft(data);
}

function goToAnnotatorForJob(data) {
  if (IS_PRACTICE_PAGE || IS_BOARD_PAGE) {
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

function waitForServerVideo(videoId, secondsLeft = API_RESPONSE_FALLBACK_SEC) {
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
        const data = JSON.parse(ev.data);
        if (IS_ANNOTATOR_PAGE && data?.type) {
          console.debug("[ws]", data.type, data);
        }
        handleMessage(data);
      } catch (err) {
        console.error("WebSocket message error:", err, ev.data);
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

function placeTimelineReadout(timelineEl, seekEl, readoutEl) {
  if (!timelineEl || !seekEl || !readoutEl) return;
  const min = parseFloat(seekEl.min || "0");
  const max = parseFloat(seekEl.max || "0");
  const value = parseFloat(seekEl.value || "0");
  const range = max - min;
  const ratio = range > 0 ? (value - min) / range : 0;
  const clamped = Math.min(1, Math.max(0, ratio));
  const x = clamped * timelineEl.clientWidth;
  readoutEl.style.left = `${x}px`;
}

function updateVideoHud() {
  if (!video.src) return;
  const globalT = globalTimeFromVideo();
  const frame = timeToFrame(globalT);
  if (videoTimeDisplay) videoTimeDisplay.textContent = globalT.toFixed(1);
  if (videoFrameDisplay) videoFrameDisplay.textContent = String(frame);
  if (videoSeek) {
    seekSyncing = true;
    videoSeek.min = "0";
    videoSeek.max = String(jobWindowSec || 30);
    videoSeek.value = String(
      Math.min(jobWindowSec || 30, Math.max(0, globalT))
    );
    seekSyncing = false;
  }
  placeTimelineReadout(videoTimeline, videoSeek, videoTimeline?.querySelector(".timeline-live-readout"));
  updatePlayPauseButton();
}

function updateTimelineSeekRange() {
  if (!videoSeek) return;
  videoSeek.min = "0";
  videoSeek.max = String(jobWindowSec || 30);
  videoSeek.step = "0.01";
  updateTimelineZones();
}

const timelineTooltipByRoot = new WeakMap();

function ensureTimelineTooltipFor(timelineEl) {
  if (!timelineEl) return null;
  let tip = timelineTooltipByRoot.get(timelineEl);
  if (tip) return tip;
  tip = document.createElement("div");
  tip.className = "timeline-marker-tooltip hidden";
  tip.setAttribute("role", "tooltip");
  timelineEl.appendChild(tip);
  timelineTooltipByRoot.set(timelineEl, tip);
  if (timelineEl === videoTimeline) timelineTooltip = tip;
  if (timelineEl === boardVideoTimeline) boardTimelineTooltip = tip;
  return tip;
}

function showTimelineMarkerTooltipFor(marker, timelineEl, tip) {
  if (!tip || !marker || !timelineEl) return;

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

  const timelineRect = timelineEl.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const centerX = markerRect.left + markerRect.width / 2 - timelineRect.left;
  tip.style.left = `${centerX}px`;
}

function hideTimelineMarkerTooltipFor(timelineEl) {
  timelineTooltipByRoot.get(timelineEl)?.classList.add("hidden");
}

function bindTimelineMarkerTooltips(timelineEl) {
  if (!timelineEl || timelineEl.dataset.markerTooltipsBound === "1") return;
  timelineEl.dataset.markerTooltipsBound = "1";
  const tip = ensureTimelineTooltipFor(timelineEl);
  let hoverMarker = null;

  timelineEl.addEventListener("mouseover", (e) => {
    const marker = e.target.closest(".timeline-marker");
    if (!marker || !timelineEl.contains(marker)) return;
    if (hoverMarker === marker) return;
    hoverMarker = marker;
    showTimelineMarkerTooltipFor(marker, timelineEl, tip);
  });

  timelineEl.addEventListener("mouseout", (e) => {
    const marker = e.target.closest(".timeline-marker");
    if (!marker || hoverMarker !== marker) return;
    const to = e.relatedTarget;
    if (to && (marker === to || marker.contains(to))) return;
    if (to?.closest?.(".timeline-marker") === marker) return;
    hoverMarker = null;
    hideTimelineMarkerTooltipFor(timelineEl);
  });
}

function renderTimelineMarkers() {
  if (!timelineMarkers) return;
  if (!video.src) {
    timelineMarkers.innerHTML = "";
    hideTimelineMarkerTooltipFor(videoTimeline);
    return;
  }
  const windowSec = jobWindowSec || 30;
  const sorted = jobEvents.slice().sort((a, b) => a.time_sec - b.time_sec);
  timelineMarkers.innerHTML = sorted
    .map((e, i) => {
      const pct = Math.min(100, Math.max(0, (e.time_sec / windowSec) * 100));
      const color = LABEL_COLORS[e.label] || "#94a3b8";
      const mine = e.participant_id === myParticipantId;
      const labelName = labelDisplayName(e.label);
      const who = mine ? "You" : `Annotator #${e.participant_id}`;
      const stackY = markerStackOffsetAtTime(sorted, e.time_sec, i);
      return `<button type="button" class="timeline-marker${mine ? " mine" : ""}" data-time="${e.time_sec}" data-frame="${e.frame}" data-label="${e.label}" data-label-name="${labelName}" data-who="${who}" data-event-id="${e.id ?? ""}" style="left:${pct}%;background:${color};--stack-y:${stackY}px" aria-label="${labelName}, frame ${e.frame}"></button>`;
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
  clearSelectedEvent();
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
  if (!LABELS.length) {
    labelButtons.innerHTML = "<p class=\"label-grid-empty\">Labels not loaded</p>";
    return;
  }
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

function rebuildLabelUi() {
  buildLabelButtons();
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
      const selected = mine && e.id === selectedEventId;
      const text = `frame ${e.frame} · ${e.time_sec.toFixed(2)}s — ${labelName} (${who})`;
      const gotoTitle = mine && editable
        ? selected
          ? "Selected — click a label to change it"
          : "Select to edit, or go to this frame"
        : "Go to this frame";
      const gotoBtn = `<button type="button" class="event-item event-goto${selected ? " event-goto-selected" : ""}" data-event-id="${e.id}" data-time-sec="${e.time_sec}" title="${gotoTitle}"${selected ? ' aria-pressed="true"' : ""}>${text}</button>`;
      const deleteBtn =
        mine && editable
          ? `<button type="button" class="event-delete" data-event-id="${e.id}" title="Delete annotation" aria-label="Delete annotation">${EVENT_DELETE_ICON}</button>`
          : "";
      return `<li class="event-row${mine ? " event-row-mine" : ""}${selected ? " event-row-selected" : ""}" style="${style}">${deleteBtn}${gotoBtn}</li>`;
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
  if (selectedEventId === eventId) selectedEventId = null;
  sessionEvents = jobEvents.filter((x) => x.participant_id === myParticipantId);
  renderSessionEvents();
  renderTimelineMarkers();
  if (currentJobId && !isPrivatePractice()) {
    send({
      type: "annotation_remove",
      job_id: currentJobId,
      time_sec: removed.time_sec,
      label: removed.label,
      uid: removed.uid,
    });
  }
}

function applyLocalAnnotation(labelId, time_sec, frame) {
  const existing = findMyEventAtTimeAndLabel(time_sec, labelId);
  if (existing) {
    removeSessionEvent(existing.id);
    return;
  }
  const pid = myParticipantId ?? 0;
  const uid = `p${pid}-${time_sec}-${labelId}`;
  jobEvents.push({
    id: ++nextEventId,
    time_sec,
    frame,
    label: labelId,
    participant_id: pid,
    uid,
  });
  sessionEvents = jobEvents.filter((x) => x.participant_id === myParticipantId);
  renderSessionEvents();
  renderTimelineMarkers();
  showOverlay(labelId, frame);
}

function annotate(labelId) {
  if (!canEditAnnotations()) return;
  if (selectedEventId != null) {
    replaceSelectedEventLabel(labelId);
    return;
  }
  const time_sec = globalTimeFromVideo();
  if (!isInAnnotationRange(time_sec)) return;
  const frame = timeToFrame(time_sec);
  if (isPrivatePractice()) {
    applyLocalAnnotation(labelId, time_sec, frame);
    return;
  }
  const existing = findMyEventAtTimeAndLabel(time_sec, labelId);
  if (existing) {
    removeSessionEvent(existing.id);
    return;
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
  hideAnnotatorIdleCountdown();
  currentJobId = data.job_id;
  loadedVideoJobId = data.job_id;
  setAnnotationsLocked(false);
  resetPresenceIdleTimer();
  jobEvents = [];
  sessionEvents = [];
  selectedEventId = null;
  nextEventId = 0;
  applyJobTiming(data);
  if (data.annotator_id != null) myParticipantId = data.annotator_id;
  renderSessionEvents();
  renderTimelineMarkers();

  const index = data.annotator_index ?? 1;
  const total = data.annotator_total ?? 1;
  const prefix = isPrivatePractice()
    ? "Private practice"
    : IS_PRACTICE_PAGE
      ? "Practice round"
      : "Job active";
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
  clearConnectionStatus();
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
  selectedEventId = null;
  renderSessionEvents();
  renderTimelineMarkers();
  hideVideoReady();
  video.pause();
  video.removeAttribute("src");
  updatePlayPauseButton();
  updateVideoHud();
  showApiNextIdle();
}

function handleTestStart(data) {
  if (isPrivatePractice()) return;
  goToTestJob(data);
}

function buildPrivatePracticeJob(video) {
  return {
    job_id: `private-${video.video_id}-${Date.now()}`,
    video_id: video.video_id,
    video_file: serverVideoApiPath(video.video_id),
    source_url: video.video_url,
    annotator_index: 1,
    annotator_total: 1,
    segment_window_sec: 30,
    start_offset_sec: 0,
    time_origin_sec: 0,
    segment_end_sec: 30,
    clip_duration_sec: 30,
    segment_core_start_sec: 0,
    segment_core_end_sec: 30,
    duration_sec: 30,
    seconds_left: 3600,
  };
}

function resetPracticeJob() {
  stopApiCountdown(true);
  stopVideoPoll();
  stopVideoHudLoop();
  currentJobId = null;
  loadedVideoJobId = null;
  jobEvents = [];
  sessionEvents = [];
  selectedEventId = null;
  renderSessionEvents();
  renderTimelineMarkers();
  hideVideoReady();
  video.pause();
  video.removeAttribute("src");
  updatePlayPauseButton();
  updateVideoHud();
  if (IS_ANNOTATOR_PAGE && !IS_PRACTICE_PAGE) showApiNextIdle();
}

function updatePracticeModeUI() {
  const sync = practiceMode === "sync";
  document.body.classList.toggle("practice-private", !sync);
  btnPracticeSync?.classList.toggle("active", sync);
  btnPracticePrivate?.classList.toggle("active", !sync);
  btnPracticeSync?.setAttribute("aria-pressed", sync ? "true" : "false");
  btnPracticePrivate?.setAttribute("aria-pressed", sync ? "false" : "true");
  practiceVideoPanel?.classList.toggle("hidden", sync);
  testNextCountdown?.classList.toggle("hidden", !sync);
  if (!sync) {
    apiCountdown?.classList.add("hidden");
  }
  if (practiceModeHint) {
    practiceModeHint.textContent = sync
      ? "Scheduled rounds with other online practice users."
      : "Pick a saved video and practice on the full 30s clip by yourself.";
  }
  if (practiceEventsHeading) {
    practiceEventsHeading.textContent = sync
      ? "Events this session"
      : "Your annotations (local only)";
  }
}

function setPracticeMode(mode) {
  if (!IS_PRACTICE_PAGE || (mode !== "sync" && mode !== "private")) return;
  if (mode === practiceMode) return;
  practiceMode = mode;
  updatePracticeModeUI();
  resetPracticeJob();
  send({ type: "set_practice_mode", mode });
  if (mode === "private") {
    stopTestNextCountdown(true);
    send({ type: "list_videos" });
    if (jobInfo) {
      jobInfo.textContent = "Private practice — choose a video from the list";
    }
  } else {
    videoList?.querySelectorAll("button.active").forEach((b) => {
      b.classList.remove("active");
    });
    if (nextTestRoundAtSec) startTestNextCountdown(nextTestRoundAtSec);
    if (jobInfo) {
      jobInfo.textContent = "Next practice round loads automatically twice per minute…";
    }
  }
}

async function startPrivatePractice(video, btn) {
  if (!isPrivatePractice() || !video?.video_id) return;
  videoList?.querySelectorAll("button.active").forEach((el) => {
    el.classList.remove("active");
  });
  btn?.classList.add("active");
  const data = buildPrivatePracticeJob(video);
  stopApiCountdown(true);
  stopTestNextCountdown(true);
  setAnnotationsLocked(false);
  if (jobInfo) {
    jobInfo.textContent = `Private practice · full 30s · ${video.video_id}`;
  }
  await startAnnotatorJob(data);
}

function bindVideoListDateHandlers() {
  videoDateFilter?.addEventListener("change", () => {
    setVideoDateFilter(videoDateFilter.value);
  });
  btnClearDateFilter?.addEventListener("click", () => {
    setVideoDateFilter("");
  });
  btnDatePickerOpen?.addEventListener("click", openDatePicker);
  document.querySelectorAll("[data-date-quick]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const quick = chip.dataset.dateQuick;
      if (quick === "today") setVideoDateFilter(todayDateKey());
      else if (quick === "yesterday") setVideoDateFilter(yesterdayDateKey());
    });
  });
}

function bindPracticeModeControls() {
  btnPracticeSync?.addEventListener("click", () => setPracticeMode("sync"));
  btnPracticePrivate?.addEventListener("click", () => setPracticeMode("private"));
  bindVideoListDateHandlers();
  updatePracticeModeUI();
}

function goToTestJob(data) {
  if (isPrivatePractice()) return;
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
  if (isPrivatePractice()) return;
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
        if (!pendingTestJob && !currentJobId) {
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
        if (!pendingAnnotateJob && !currentJobId) {
          stopApiCountdown(true);
        }
        showScreen(annotatorScreen);
        requestNotificationPermission();
        showApiNextIdle();
        if (pendingAnnotateJob && !pendingAnnotateJob.api_pending) {
          const job = applyRoleAckToJob(pendingAnnotateJob, data);
          pendingAnnotateJob = null;
          beginJobCountdown(job);
          startAnnotatorJob(job);
        } else if (pendingAnnotateJob?.api_pending) {
          const pendingVid = pendingAnnotateJob.video_id;
          pendingAnnotateJob = null;
          if (pendingVid) {
            jobInfo.textContent = `API job started · ${pendingVid} · waiting for video…`;
          }
        }
      }
      if (data.role === "reviewer") {
        if (data.videos) renderVideoList(data.videos);
        stopApiCountdown(true);
        showScreen(reviewerScreen);
        stopVideoHudLoop();
        video.pause();
        video.removeAttribute("src");
        ensureWorkspaceOnline();
      }
      if (data.role === "annotator" || data.role === "test") {
        initPresenceTracking(data.online !== false);
        ensureWorkspaceOnline();
      } else if (data.role !== "reviewer") {
        stopPresenceTracking();
      }
      rebuildLabelUi();
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
    case "api_call_started":
      handleApiCallStarted(data);
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
    case "practice_mode_ack":
      if (IS_PRACTICE_PAGE && data.mode) {
        practiceMode = data.mode === "private" ? "private" : "sync";
        updatePracticeModeUI();
      }
      break;
    case "videos_list":
      if (videoList && (IS_BOARD_PAGE || isPrivatePractice())) {
        renderVideoList(data.videos);
      }
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

function handleAnnotatorKeydown(e) {
  if (!isAnnotatingRole()) return;

  if (e.code === "Space") {
    if (isAnnotatorShortcutBlocked(e)) return;
    e.preventDefault();
    togglePlayPause();
    return;
  }

  if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
    if (isAnnotatorShortcutBlocked(e)) return;
    e.preventDefault();
    if (!e.repeat) startArrowHold(e.code === "ArrowLeft" ? -1 : 1);
    return;
  }

  if (isAnnotatorShortcutBlocked(e)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const labelId = keyToLabel[key];
  if (labelId) {
    e.preventDefault();
    annotate(labelId);
  }
}

function handleAnnotatorKeyup(e) {
  if (!isAnnotatingRole()) return;
  if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
    stopArrowHold();
  }
}

window.addEventListener("keydown", handleAnnotatorKeydown, true);
window.addEventListener("keyup", handleAnnotatorKeyup, true);

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
    rebuildLabelUi();
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
    bindPracticeModeControls();
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
        const pending = JSON.parse(raw);
        if (pending?.api_pending) {
          if (pending.video_id && jobInfo) {
            jobInfo.textContent = `API job started · ${pending.video_id} · waiting for video…`;
          }
        } else {
          pendingAnnotateJob = pending;
        }
      } catch {
        pendingAnnotateJob = null;
      }
      sessionStorage.removeItem(PENDING_ANNOTATE_KEY);
    }
    showConnectionStatus("Connecting…");
    requestNotificationPermission();
    await enterRole("annotator");
    return;
  }

  if (IS_BOARD_PAGE) {
    bindReviewHandlers();
    updateDateFilterLabel();
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
  bindVideoListDateHandlers();
  bindBoardPlayerHandlers();
}

bootApp();

btnPlayPause?.addEventListener("click", togglePlayPause);
video?.addEventListener("click", togglePlayPause);

videoSeek?.addEventListener("input", () => {
  if (seekSyncing) return;
  clearSelectedEvent();
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
  clearSelectedEvent();
  const globalTime = parseFloat(btn.dataset.time);
  video.pause();
  video.currentTime = localTimeFromGlobal(globalTime);
  updateVideoHud();
  updatePlayPauseButton();
});

videoTimeline?.addEventListener("pointerdown", (e) => {
  if (!video.src) return;
  const marker = e.target.closest(".timeline-marker");
  if (marker) return;
  seekAnnotatorByClientX(e.clientX);

  videoTimeline.setPointerCapture?.(e.pointerId);
});

videoTimeline?.addEventListener("pointermove", (e) => {
  if (!video.src) return;
  if (!videoTimeline.hasPointerCapture?.(e.pointerId)) return;
  seekAnnotatorByClientX(e.clientX);
});

videoTimeline?.addEventListener("pointerup", (e) => {
  if (!videoTimeline.hasPointerCapture?.(e.pointerId)) return;
  videoTimeline.releasePointerCapture?.(e.pointerId);
});

videoTimeline?.addEventListener("pointercancel", (e) => {
  if (!videoTimeline.hasPointerCapture?.(e.pointerId)) return;
  videoTimeline.releasePointerCapture?.(e.pointerId);
});

videoFrameDisplay?.addEventListener("pointerdown", (e) => {
  if (!video.src) return;
  seekAnnotatorByClientX(e.clientX);
});

boardVideoFrameDisplay?.addEventListener("pointerdown", (e) => {
  if (!reviewerVideo?.src) return;
  reviewerVideo.pause();
  seekBoardToClientX(e.clientX);
  updateBoardPlayPauseButton();
});

bindTimelineMarkerTooltips(videoTimeline);

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
  if (!Number.isFinite(eventId)) return;
  const ev = jobEvents.find((x) => x.id === eventId);
  if (!ev) return;
  if (ev.participant_id === myParticipantId && canEditAnnotations()) {
    if (selectedEventId === eventId) {
      clearSelectedEvent();
      return;
    }
    setSelectedEvent(eventId);
    return;
  }
  clearSelectedEvent();
  seekToEvent(ev);
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

function showBoardVideoLoading() {
  if (!boardVideoLoading) return;
  boardVideoLoading.classList.remove("hidden");
  boardVideoLoading.setAttribute("aria-busy", "true");
}

function hideBoardVideoLoading() {
  if (!boardVideoLoading) return;
  boardVideoLoading.classList.add("hidden");
  boardVideoLoading.setAttribute("aria-busy", "false");
}

function updateBoardPlayPauseButton() {
  if (!boardBtnPlayPause || !reviewerVideo) return;
  boardBtnPlayPause.textContent = reviewerVideo.paused ? "▶" : "⏸";
  boardBtnPlayPause.setAttribute(
    "aria-label",
    reviewerVideo.paused ? "Play" : "Pause"
  );
}

function updateBoardVideoHud() {
  if (!reviewerVideo?.src) return;
  const t = reviewerVideo.currentTime || 0;
  const frame = timeToFrame(t);
  if (boardVideoTimeDisplay) boardVideoTimeDisplay.textContent = t.toFixed(1);
  if (boardVideoFrameDisplay) {
    boardVideoFrameDisplay.textContent = String(frame);
  }
  if (boardVideoSeek) {
    boardSeekSyncing = true;
    boardVideoSeek.min = "0";
    boardVideoSeek.max = String(boardWindowSec || 30);
    boardVideoSeek.value = String(Math.min(boardWindowSec || 30, Math.max(0, t)));
    boardSeekSyncing = false;
  }
  placeTimelineReadout(
    boardVideoTimeline,
    boardVideoSeek,
    boardVideoTimeline?.querySelector(".timeline-live-readout")
  );
  updateBoardPlayPauseButton();
}

function updateBoardTimelineTrack() {
  if (!boardTimelineTrack) return;
  boardTimelineTrack.innerHTML = `<div class="timeline-zone timeline-zone-core" style="width:100%"></div>`;
}

function updateBoardTimelineSeekRange() {
  if (!boardVideoSeek) return;
  boardWindowSec =
    reviewerVideo?.duration && Number.isFinite(reviewerVideo.duration)
      ? reviewerVideo.duration
      : 30;
  boardVideoSeek.min = "0";
  boardVideoSeek.max = String(boardWindowSec);
  boardVideoSeek.step = "0.01";
  updateBoardTimelineTrack();
}

function seekBoardToClientX(clientX) {
  if (!boardVideoTimeline || !boardVideoSeek || !reviewerVideo?.src) return;
  const rect = boardVideoTimeline.getBoundingClientRect();
  if (rect.width <= 0) return;
  const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const maxSec = boardWindowSec || 30;
  const t = pct * maxSec;
  reviewerVideo.currentTime = t;
  boardSeekSyncing = true;
  boardVideoSeek.value = String(t);
  boardSeekSyncing = false;
  updateBoardVideoHud();
}

function renderBoardTimelineMarkers() {
  if (!boardTimelineMarkers) return;
  if (!reviewerVideo?.src) {
    boardTimelineMarkers.innerHTML = "";
    hideTimelineMarkerTooltipFor(boardVideoTimeline);
    return;
  }
  const windowSec = boardWindowSec || 30;
  const sorted = boardEvents
    .slice()
    .sort((a, b) => Number(a.time_sec) - Number(b.time_sec));
  boardTimelineMarkers.innerHTML = sorted
    .map((e, i) => {
      const pct = Math.min(100, Math.max(0, (Number(e.time_sec) / windowSec) * 100));
      const color = LABEL_COLORS[e.label] || "#94a3b8";
      const labelName = labelDisplayName(e.label);
      const who = labelerName(boardLabelers, e.participant_id, e.user_id);
      const frame = e.frame ?? timeToFrame(e.time_sec);
      const stackY = markerStackOffsetAtTime(sorted, e.time_sec, i);
      return `<button type="button" class="timeline-marker" data-time="${e.time_sec}" data-frame="${frame}" data-label="${e.label}" data-label-name="${labelName}" data-who="${who}" style="left:${pct}%;background:${color};--stack-y:${stackY}px" aria-label="${labelName}, frame ${frame}"></button>`;
    })
    .join("");
}

function startBoardVideoHudLoop() {
  stopBoardVideoHudLoop();
  const tick = () => {
    updateBoardVideoHud();
    boardFrameRafId = requestAnimationFrame(tick);
  };
  boardFrameRafId = requestAnimationFrame(tick);
}

function stopBoardVideoHudLoop() {
  if (boardFrameRafId !== null) {
    cancelAnimationFrame(boardFrameRafId);
    boardFrameRafId = null;
  }
}

function toggleBoardPlayPause() {
  if (!reviewerVideo?.src) return;
  if (reviewerVideo.paused) {
    reviewerVideo.play().catch(() => {});
  } else {
    reviewerVideo.pause();
  }
  updateBoardPlayPauseButton();
}

function bindBoardPlayerHandlers() {
  if (!hasBoardTimeline()) return;

  boardBtnPlayPause?.addEventListener("click", toggleBoardPlayPause);
  reviewerVideo?.addEventListener("click", toggleBoardPlayPause);
  reviewerVideo?.addEventListener("play", updateBoardPlayPauseButton);
  reviewerVideo?.addEventListener("pause", updateBoardPlayPauseButton);
  reviewerVideo?.addEventListener("loadstart", showBoardVideoLoading);
  reviewerVideo?.addEventListener("waiting", showBoardVideoLoading);
  reviewerVideo?.addEventListener("canplay", hideBoardVideoLoading);
  reviewerVideo?.addEventListener("loadeddata", hideBoardVideoLoading);
  reviewerVideo?.addEventListener("error", hideBoardVideoLoading);
  reviewerVideo?.addEventListener("emptied", showBoardVideoLoading);
  reviewerVideo?.addEventListener("loadedmetadata", () => {
    if (reviewerVideo.duration && Number.isFinite(reviewerVideo.duration)) {
      videoFps = DEFAULT_FPS;
    }
    updateBoardTimelineSeekRange();
    renderBoardTimelineMarkers();
    updateBoardVideoHud();
    if (reviewerVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      hideBoardVideoLoading();
    }
  });

  const onBoardSeek = () => {
    if (boardSeekSyncing || !reviewerVideo?.src) return;
    reviewerVideo.pause();
    reviewerVideo.currentTime = parseFloat(boardVideoSeek.value);
    updateBoardVideoHud();
    updateBoardPlayPauseButton();
  };
  boardVideoSeek?.addEventListener("input", onBoardSeek);
  boardVideoSeek?.addEventListener("change", onBoardSeek);

  boardVideoTimeline?.addEventListener("pointerdown", (e) => {
    if (!reviewerVideo?.src) return;
    const marker = e.target.closest(".timeline-marker");
    if (marker) {
      reviewerVideo.pause();
      reviewerVideo.currentTime = parseFloat(marker.dataset.time);
      updateBoardVideoHud();
      return;
    }
    seekBoardToClientX(e.clientX);
    boardVideoTimeline.setPointerCapture?.(e.pointerId);
  });

  boardVideoTimeline?.addEventListener("pointermove", (e) => {
    if (!reviewerVideo?.src) return;
    if (!boardVideoTimeline.hasPointerCapture?.(e.pointerId)) return;
    reviewerVideo.pause();
    seekBoardToClientX(e.clientX);
  });

  boardVideoTimeline?.addEventListener("pointerup", (e) => {
    if (!boardVideoTimeline.hasPointerCapture?.(e.pointerId)) return;
    boardVideoTimeline.releasePointerCapture?.(e.pointerId);
  });

  boardVideoTimeline?.addEventListener("pointercancel", (e) => {
    if (!boardVideoTimeline.hasPointerCapture?.(e.pointerId)) return;
    boardVideoTimeline.releasePointerCapture?.(e.pointerId);
  });

  bindTimelineMarkerTooltips(boardVideoTimeline);
}

function renderVideoList(videos) {
  if (!videoList) return;
  boardVideosCache = videos || [];
  updateDateFilterLabel();
  videoList.innerHTML = "";
  if (!boardVideosCache.length) {
    videoList.innerHTML = "<li><em>No saved videos yet</em></li>";
    return;
  }

  const onSelect = videoListOnSelect();

  if (!usesGroupedVideoList()) {
    boardVideosCache.forEach((v) => {
      const li = document.createElement("li");
      li.appendChild(createVideoListButton(v, onSelect));
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
    section.className = `video-list-date-group${expanded ? " is-expanded" : ""}`;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "video-list-date-toggle";
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    toggle.innerHTML = `<span class="video-list-date-chevron" aria-hidden="true">${expanded ? "▾" : "▸"}</span><span class="video-list-date-label">${formatDateGroupHeader(dateKey)}</span><span class="video-list-date-count">${groupVideos.length}</span>`;
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = !(toggle.getAttribute("aria-expanded") === "true");
      boardDateExpandState.set(dateKey, next);
      renderVideoList(boardVideosCache);
    });

    const items = document.createElement("ul");
    items.className = `video-list-date-items${expanded ? "" : " collapsed"}`;
    for (const video of groupVideos) {
      const row = document.createElement("li");
      row.appendChild(createVideoListButton(video, onSelect));
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
      if (!reviewerVideo) return;
      reviewerVideo.pause();
      reviewerVideo.currentTime = parseFloat(b.dataset.time);
      updateBoardVideoHud();
    });
  });
}

async function loadReviewerVideo(item, btn) {
  videoList?.querySelectorAll("button.active").forEach((b) => {
    b.classList.remove("active");
  });
  btn.classList.add("active");
  const vid = item.video_id;
  boardEvents = [];
  boardLabelers = {};
  renderBoardTimelineMarkers();
  showBoardVideoLoading();
  const playbackUrl = vid
    ? new URL(serverVideoApiPath(vid), location.origin).href
    : item.video_url || "";
  if (IS_BOARD_PAGE && !vid) {
    hideBoardVideoLoading();
    reviewerVideo.removeAttribute("src");
    reviewerMeta.innerHTML = `<div><strong>${vid || "unknown"}</strong></div><div class="reviewer-meta-url">No server video id available for this item.</div>`;
    reviewerEvents.innerHTML = "<li><em>Cannot play video without server video id</em></li>";
    return;
  }
  reviewerVideo.src = playbackUrl;
  const labelerLine = formatLabelerList(item.labeler_names);
  reviewerMeta.innerHTML = `<div><strong>${vid}</strong></div>${item.video_url ? `<div class="reviewer-meta-url">${item.video_url}</div>` : ""}<div class="reviewer-meta-labelers">Labeled by: ${labelerLine}</div></div>`;
  try {
    const res = await apiFetch(item.annotations_file);
    const data = await res.json();
    const { events, labelers } = normalizeReviewerEvents(data);
    boardEvents = events;
    boardLabelers = labelers;
    renderReviewerEvents(events, labelers);
    renderBoardTimelineMarkers();
    if (reviewerVideo.readyState >= HTMLMediaElement.HAVE_METADATA) {
      updateBoardTimelineSeekRange();
      updateBoardVideoHud();
    }
    if (reviewerVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      hideBoardVideoLoading();
    }
    startBoardVideoHudLoop();
  } catch {
    hideBoardVideoLoading();
    reviewerEvents.innerHTML = "<li>Failed to load annotations</li>";
    boardEvents = [];
    renderBoardTimelineMarkers();
  }
}
