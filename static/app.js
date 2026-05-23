const DEFAULT_FPS = 25;
const DEFAULT_PLAYBACK_RATE = 1;
const PLAYBACK_RATE_STEP = 0.1;
const MIN_PLAYBACK_RATE = 0.1;
const FIRST_PART_EXTRA_SEC = 2;
const ARROW_PLAYING_FRAME_STEP = 12;
const ARROW_PAUSED_FRAME_STEP = 2;
const ARROW_HOLD_DELAY_MS = 60;
const ARROW_HOLD_INTERVAL_MS = 28;
const API_RESPONSE_FALLBACK_SEC = 26;
const API_CALL_INTERVAL_SEC = 3600;
const API_NEXT_WARN_5_MIN_SEC = 5 * 60;
const API_NEXT_WARN_1_MIN_SEC = 60;
const VIDEO_POLL_INTERVAL_MS = 2000;
const ANNOTATOR_POST_DEADLINE_KEEP_MS = 60 * 1000;
const DEFAULT_PRESENCE_IDLE_MINUTES = 15;
const DEFAULT_EVENT_CANDIDATE_SNAP_RANGE_FRAMES = 5;
const PRESENCE_ACTIVE_RECHECK_MS = 30 * 1000;
const PAGE = document.body.dataset.page || "";
const IS_PRACTICE_PAGE = PAGE === "practice" || PAGE === "train";
const IS_ANNOTATOR_PAGE = PAGE === "annotator";
const IS_BOARD_PAGE = PAGE === "board" || PAGE === "review";
const PENDING_ANNOTATE_KEY = "pendingAnnotateJob";
const PLAYBACK_RATE_STORAGE_PREFIX = "playbackRate:";

function getPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getPlaybackRate(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatPlaybackRate(rate) {
  return Number(rate.toFixed(2)).toString();
}

let wsAuthed = false;
let wsConnectResolve = null;
let wsConnectingPromise = null;
let currentUserId = null;

const DEFAULT_LABEL_KEYBOARD_ROWS = [
  ["pass", "pass_received", "take_on", "recovery", "tackle"],
  ["aerial_duel", "save", "shot", "foul", "goal"],
  ["interception", "substitution", "clearance", "block", "ball_out_of_play"],
];

let LABELS = [];
let labelKeyboardRows = DEFAULT_LABEL_KEYBOARD_ROWS;
let keyToLabel = {};
let labelFrameOffsets = {};
let defaultLabelShortcuts = {};
let currentLabelShortcuts = {};

const roleScreen = document.getElementById("role-screen");
const annotatorScreen = document.getElementById("annotator-screen");
const reviewerScreen = document.getElementById("reviewer-screen");
const rolePickerModal = document.getElementById("role-picker-modal");
const roleStatus = document.getElementById("role-status");
const connectionStatus = document.getElementById("connection-status");
const labelButtons = document.getElementById("label-buttons");
const video = document.getElementById("annotator-video");
const videoAspect = video?.closest(".video-aspect");
const overlay = document.getElementById("event-overlay");
const eventsList = document.getElementById("events-list");
const annotatorRoster = document.getElementById("annotator-roster");
const sessionInfo = document.getElementById("session-info");
const jobInfo = document.getElementById("job-info");
const reviewerVideo = document.getElementById("reviewer-video");
const playbackSpeedInputs = Array.from(
  document.querySelectorAll("[data-playback-speed-input]")
);
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
let playbackRate = DEFAULT_PLAYBACK_RATE;
let privatePracticeDurationSec = 10;
let privatePracticeAvailableSec = 30;
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
const presenceOverlayTitle = document.getElementById("presence-overlay-title");
const btnPresenceConfirm = document.getElementById("btn-presence-confirm");
const kickAnnotatorModal = document.getElementById("kick-annotator-modal");
const kickAnnotatorMessage = document.getElementById("kick-annotator-message");
const btnKickAnnotatorYes = document.getElementById("btn-kick-annotator-yes");
const btnKickAnnotatorCancel = document.getElementById("btn-kick-annotator-cancel");
const btnPracticeSync = document.getElementById("btn-practice-sync");
const btnPracticePrivate = document.getElementById("btn-practice-private");
const btnPracticeExternal = document.getElementById("btn-practice-external");
const practiceModeHint = document.getElementById("practice-mode-hint");
const practiceVideoPanel = document.getElementById("practice-video-panel");
const practiceEventsHeading = document.getElementById("practice-events-heading");
const privatePracticeDurationControl = document.getElementById("private-practice-duration-control");
const privatePracticeDurationInput = document.getElementById("private-practice-duration");
const privatePracticeAvailableInput = document.getElementById("private-practice-available");
const externalVideoForm = document.getElementById("external-video-form");
const externalVideoUrl = document.getElementById("external-video-url");

let presenceOnline = true;
let presenceIdleTimer = null;
let presenceListenersBound = false;
let presenceIdleMinutes = DEFAULT_PRESENCE_IDLE_MINUTES;
let pendingKickAnnotator = null;

const PARTICIPANT_COLORS = [
  "#3d8bfd",
  "#3ecf8e",
  "#f59e0b",
  "#ec4899",
  "#a78bfa",
  "#22d3ee",
];

const LABEL_COLORS = {
  pass: "#285ea8",
  pass_received: "#b91c1c",
  take_on: "#0f766e",
  recovery: "#2563eb",
  tackle: "#b45309",
  aerial_duel: "#0e7490",
  save: "#0f766e",
  shot: "#4f46e5",
  foul: "#9333ea",
  goal: "#16a34a",
  interception: "#1d4ed8",
  substitution: "#6d28d9",
  clearance: "#0369a1",
  block: "#334155",
  ball_out_of_play: "#7c2d12",
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
let jobVideoLocalOrigin = 0;
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
let postDeadlineCleanupTimer = null;
let pendingApiVideoId = null;
let testNextRafId = null;
let practiceMode = "sync";
let testNextDeadline = null;
let pendingTestJob = null;
let nextTestRoundAtSec = null;
let loadedVideoJobId = null;
let videoPollAbort = null;
let annotationsLocked = false;
let selectedEventId = null;
let eventCandidateFrames = [];
let eventCandidateSnapRangeFrames = DEFAULT_EVENT_CANDIDATE_SNAP_RANGE_FRAMES;
let videoPaddingOverlay = null;
let timelineMarkerDrag = null;
let suppressTimelineMarkerClick = false;

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
  defaultLabelShortcuts = Object.fromEntries(LABELS.map((l) => [l.id, l.key]));
  currentLabelShortcuts = { ...defaultLabelShortcuts, ...(data.shortcuts || {}) };
  keyToLabel = Object.fromEntries(
    Object.entries(currentLabelShortcuts).map(([labelId, key]) => [key, labelId])
  );
  labelFrameOffsets = data.frame_offsets || {};
  eventCandidateSnapRangeFrames =
    Number.isFinite(Number(data.event_candidate_snap_range_frames))
      ? Math.max(0, Math.floor(Number(data.event_candidate_snap_range_frames)))
      : DEFAULT_EVENT_CANDIDATE_SNAP_RANGE_FRAMES;
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

function isExternalPractice() {
  return IS_PRACTICE_PAGE && practiceMode === "external";
}

function isLocalPractice() {
  return isPrivatePractice() || isExternalPractice();
}

function isSyncPractice() {
  return IS_PRACTICE_PAGE && practiceMode === "sync";
}

function normalizePrivatePracticeDuration(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 600) : 10;
}

function normalizePrivatePracticeAvailable(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 600) : 30;
}

function privatePracticeDuration() {
  privatePracticeDurationSec = normalizePrivatePracticeDuration(
    privatePracticeDurationInput?.value ?? privatePracticeDurationSec
  );
  if (privatePracticeDurationInput) {
    privatePracticeDurationInput.value = String(privatePracticeDurationSec);
  }
  return privatePracticeDurationSec;
}

function privatePracticeAvailableTime() {
  privatePracticeAvailableSec = normalizePrivatePracticeAvailable(
    privatePracticeAvailableInput?.value ?? privatePracticeAvailableSec
  );
  if (privatePracticeAvailableInput) {
    privatePracticeAvailableInput.value = String(privatePracticeAvailableSec);
  }
  return privatePracticeAvailableSec;
}

function randomPrivatePracticeStart(videoDuration, taskDuration) {
  const available = Math.max(0, Number(videoDuration) - Number(taskDuration));
  if (!Number.isFinite(available) || available <= 0) return 0;
  return Math.random() * available;
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
  const timelineStart = jobPlayGlobalStart;
  const timelineEnd = Math.max(jobPlayGlobalEnd, timelineStart + 0.001);
  const timelineSec = timelineEnd - timelineStart;
  const segs = timelineSegmentsFromBounds(
    0,
    timelineSec,
    Math.max(0, jobCoreGlobalStart - timelineStart),
    Math.min(timelineSec, jobCoreGlobalEnd - timelineStart),
    timelineSec
  );
  timelineTrack.innerHTML = segs
    .map(({ from, to, type }) => {
      const pct = ((to - from) / timelineSec) * 100;
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

function ensureVideoPaddingOverlay() {
  if (!videoAspect) return null;
  if (videoPaddingOverlay) return videoPaddingOverlay;
  videoPaddingOverlay = document.createElement("div");
  videoPaddingOverlay.className = "video-padding-overlay hidden";
  videoPaddingOverlay.setAttribute("aria-hidden", "true");
  videoAspect.appendChild(videoPaddingOverlay);
  return videoPaddingOverlay;
}

function updateVideoPaddingOverlay() {
  const padOverlay = ensureVideoPaddingOverlay();
  if (!padOverlay) return;
  const show =
    !!video?.src &&
    jobPlayGlobalEnd > jobPlayGlobalStart &&
    !isInAnnotationRange(globalTimeFromVideo());
  padOverlay.classList.toggle("hidden", !show);
}

function canEditAnnotations() {
  return !!currentJobId && !annotationsLocked && !!video.src;
}

function updateAnnotatorInteractionState() {
  const hasVideo = !!video.src;
  const editable = canEditAnnotations();
  if (videoSeek) videoSeek.disabled = !hasVideo;
  if (videoTimeline) {
    videoTimeline.classList.toggle("timeline-disabled", !hasVideo);
    videoTimeline.setAttribute("aria-disabled", hasVideo ? "false" : "true");
  }
  if (videoFrameDisplay) {
    videoFrameDisplay.classList.toggle("disabled", !hasVideo);
    if (!video.src) videoFrameDisplay.textContent = "—";
  }
  if (videoTimeDisplay) {
    videoTimeDisplay.classList.toggle("disabled", !hasVideo);
    if (!video.src) videoTimeDisplay.textContent = "—";
  }
  if (labelButtons) {
    labelButtons.querySelectorAll(".label-btn").forEach((btn) => {
      btn.disabled = !editable;
    });
  }
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
  updateAnnotatorInteractionState();
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

function removeEventFromServer(event) {
  if (!event || !currentJobId || isLocalPractice()) return;
  const pid = myParticipantId ?? 0;
  send({
    type: "annotation_remove",
    job_id: currentJobId,
    time_sec: event.time_sec,
    label: event.label,
    uid: event.uid || `p${pid}-${roundTimeSec(event.time_sec)}-${event.label}`,
  });
}

function addEventToServer(event) {
  if (!event || !currentJobId || isLocalPractice()) return;
  send({
    type: "annotation",
    job_id: currentJobId,
    label: event.label,
    time_sec: event.time_sec,
    frame: event.frame,
    labeled_time_sec: event.labeled_time_sec ?? event.time_sec,
  });
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
    // Keep unchanged when the same label key/button is used.
    return;
  }
  const oldLabel = ev.label;
  const oldTimeSec = ev.time_sec;
  const oldUid = ev.uid;
  const currentFrame = ev.frame ?? timeToFrame(ev.time_sec);
  const candidateFrame = nearestEventCandidateFrame(currentFrame);
  const frame = candidateFrame ?? currentFrame;
  const time_sec = roundTimeSec(frameToTime(frame));
  const pid = myParticipantId ?? 0;
  ev.label = labelId;
  ev.time_sec = time_sec;
  ev.frame = frame;
  ev.uid = `p${pid}-${roundTimeSec(time_sec)}-${labelId}`;
  sessionEvents = jobEvents.filter((x) => x.participant_id === myParticipantId);
  renderSessionEvents();
  renderTimelineMarkers();
  showOverlay(labelId, frame);
  if (isLocalPractice()) return;
  removeEventFromServer({
    time_sec: oldTimeSec,
    label: oldLabel,
    uid: oldUid || `p${pid}-${roundTimeSec(oldTimeSec)}-${oldLabel}`,
  });
  addEventToServer(ev);
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

function markerStackOffsetAtFrame(events, index) {
  const target = events[index];
  if (!target) return 0;
  const targetFrame = target.frame ?? timeToFrame(target.time_sec);
  const sameFrame = events.filter(
    (e) => (e.frame ?? timeToFrame(e.time_sec)) === targetFrame
  );
  const idx = sameFrame.findIndex((e) => e === target);
  if (idx <= 0) return 0;
  return idx * 16;
}

function myEventsAtFrame(frame) {
  return jobEvents.filter(
    (e) =>
      e.participant_id === myParticipantId &&
      (e.frame ?? timeToFrame(e.time_sec)) === frame
  );
}

function moveMyEventsAtFrame(fromFrame, toFrame) {
  if (!canEditAnnotations() || fromFrame === toFrame) return false;
  const clampedFrame = Math.max(
    timeToFrame(jobCoreGlobalStart),
    Math.min(timeToFrame(jobCoreGlobalEnd), toFrame)
  );
  if (fromFrame === clampedFrame) return false;
  const eventsToMove = myEventsAtFrame(fromFrame);
  if (!eventsToMove.length) return false;

  const beforeEvents = eventsToMove.map((event) => ({ ...event }));
  beforeEvents.forEach(removeEventFromServer);
  eventsToMove.forEach((event) => {
    const adjusted = eventWithFrame(event, clampedFrame);
    event.time_sec = adjusted.time_sec;
    event.frame = adjusted.frame;
    event.uid = adjusted.uid;
    addEventToServer(event);
  });

  sessionEvents = jobEvents.filter((x) => x.participant_id === myParticipantId);
  renderSessionEvents();
  renderTimelineMarkers();
  clearSelectedEvent();
  seekToFrame(clampedFrame);
  return true;
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
  const timelineSec = Math.max(0.001, jobPlayGlobalEnd - jobPlayGlobalStart);
  const globalT = jobPlayGlobalStart + pct * timelineSec;
  const clamped = Math.min(jobPlayGlobalEnd, Math.max(jobPlayGlobalStart, globalT));
  clearSelectedEvent();
  video.pause();
  video.currentTime = localTimeFromGlobal(clamped);
  updateVideoHud();
  updatePlayPauseButton();
}

function frameFromTimelineClientX(clientX) {
  if (!videoTimeline) return null;
  const rect = videoTimeline.getBoundingClientRect();
  if (rect.width <= 0) return null;
  const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const timelineSec = Math.max(0.001, jobPlayGlobalEnd - jobPlayGlobalStart);
  const globalT = jobPlayGlobalStart + pct * timelineSec;
  const clamped = Math.min(jobCoreGlobalEnd, Math.max(jobCoreGlobalStart, globalT));
  return timeToFrame(clamped);
}

function timelinePctFromFrame(frame) {
  const timelineSec = Math.max(0.001, jobPlayGlobalEnd - jobPlayGlobalStart);
  const timeSec = frameToTime(frame);
  return Math.min(
    100,
    Math.max(0, ((timeSec - jobPlayGlobalStart) / timelineSec) * 100)
  );
}

function setTimelineMarkersFramePosition(frame, markers) {
  const pct = timelinePctFromFrame(frame);
  markers.forEach((marker) => {
    marker.style.left = `${pct}%`;
    marker.dataset.frame = String(frame);
    marker.dataset.time = String(roundTimeSec(frameToTime(frame)));
  });
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

function presenceIdleMs() {
  return presenceIdleMinutes * 60 * 1000;
}

function formatPresenceIdleMinutes(minutes) {
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

function setPresenceIdleMinutes(minutes) {
  const n = Math.floor(Number(minutes));
  presenceIdleMinutes = Number.isFinite(n) && n > 0
    ? n
    : DEFAULT_PRESENCE_IDLE_MINUTES;
  if (presenceOverlayTitle) {
    presenceOverlayTitle.textContent = `You've been idle for ${formatPresenceIdleMinutes(presenceIdleMinutes)}`;
  }
  resetPresenceIdleTimer();
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
  presenceIdleTimer = setTimeout(onPresenceIdleTimeout, presenceIdleMs());
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
  btnKickAnnotatorYes?.addEventListener("click", confirmKickAnnotator);
  btnKickAnnotatorCancel?.addEventListener("click", hideKickAnnotatorModal);
  kickAnnotatorModal?.addEventListener("click", (e) => {
    if (e.target === kickAnnotatorModal) hideKickAnnotatorModal();
  });
}

function handlePresenceStatus(data) {
  setPresenceOnline(data.online === true, { notifyServer: false });
}

function normalizeAnnotatorStatus(status) {
  if (status === "online" || status === "idle" || status === "offline") {
    return status;
  }
  return "offline";
}

function formatAnnotatorName(name) {
  const text = String(name || "").trim();
  if (!text) return "Annotator";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function hideKickAnnotatorModal() {
  pendingKickAnnotator = null;
  kickAnnotatorModal?.classList.add("hidden");
}

function showKickAnnotatorModal(annotator) {
  if (!kickAnnotatorModal || !annotator?.user_id) return;
  pendingKickAnnotator = annotator;
  const name = formatAnnotatorName(annotator.user_id);
  if (kickAnnotatorMessage) {
    kickAnnotatorMessage.textContent = `${name} will stop receiving new tasks until they click "I am Online".`;
  }
  kickAnnotatorModal.classList.remove("hidden");
}

function confirmKickAnnotator() {
  if (!pendingKickAnnotator?.user_id) {
    hideKickAnnotatorModal();
    return;
  }
  send({ type: "set_user_idle", user_id: pendingKickAnnotator.user_id });
  hideKickAnnotatorModal();
}

function renderAnnotatorRoster(annotators = []) {
  if (!annotatorRoster) return;
  annotatorRoster.innerHTML = "";
  annotators.forEach((annotator) => {
    const status = normalizeAnnotatorStatus(annotator.status);
    const item = document.createElement("li");
    item.className = `annotator-roster-item ${status}`;
    const canKick = status === "online" && !!annotator.user_id;
    if (canKick) {
      item.classList.add("can-kick");
      item.setAttribute("role", "button");
      item.tabIndex = 0;
      item.title = "Click to make this annotator idle";
      item.addEventListener("click", () => showKickAnnotatorModal(annotator));
      item.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        showKickAnnotatorModal(annotator);
      });
    }

    const name = document.createElement("span");
    name.className = "annotator-roster-name";
    name.textContent = formatAnnotatorName(
      annotator.user_id || `Annotator ${annotator.annotator_id ?? ""}`
    );

    item.append(name);
    annotatorRoster.appendChild(item);
  });
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

function annotationPointForLabel(labelId, timeSec) {
  const frame = timeToFrame(timeSec);
  const adjustedFrame = Math.max(0, frame - (Number(labelFrameOffsets[labelId]) || 0));
  const candidateFrame = nearestEventCandidateFrame(adjustedFrame);
  if (candidateFrame != null) {
    return {
      time_sec: roundTimeSec(frameToTime(candidateFrame)),
      frame: candidateFrame,
    };
  }
  return {
    time_sec: roundTimeSec(frameToTime(adjustedFrame)),
    frame: adjustedFrame,
  };
}

function nearestEventCandidateFrame(frame) {
  if (!eventCandidateFrames.length) return null;
  let nearest = null;
  let nearestDistance = Infinity;
  eventCandidateFrames.forEach((candidateFrame) => {
    const distance = Math.abs(candidateFrame - frame);
    if (distance < nearestDistance) {
      nearest = candidateFrame;
      nearestDistance = distance;
    }
  });
  return nearestDistance <= eventCandidateSnapRangeFrames ? nearest : null;
}

function eventWithFrame(event, frame) {
  const pid = event.participant_id ?? myParticipantId ?? 0;
  const timeSec = roundTimeSec(frameToTime(frame));
  return {
    ...event,
    frame,
    time_sec: timeSec,
    uid: `p${pid}-${timeSec}-${event.label}`,
  };
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
  currentUserId = null;
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
    currentUserId = data.user_id || null;
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
      } else if (IS_PRACTICE_PAGE && isPrivatePractice()) {
        video.pause();
        updatePlayPauseButton();
      } else if (IS_ANNOTATOR_PAGE && !IS_PRACTICE_PAGE) {
        const finishedJobId = currentJobId;
        clearPostDeadlineCleanupTimer();
        postDeadlineCleanupTimer = setTimeout(() => {
          if (currentJobId !== finishedJobId) return;
          clearAnnotatorVideo(true);
        }, ANNOTATOR_POST_DEADLINE_KEEP_MS);
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
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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

function clearPostDeadlineCleanupTimer() {
  if (postDeadlineCleanupTimer) {
    clearTimeout(postDeadlineCleanupTimer);
    postDeadlineCleanupTimer = null;
  }
}

function shouldShowNextChallengeTimer() {
  return (
    IS_ANNOTATOR_PAGE &&
    role === "annotator" &&
    !currentJobId &&
    !pendingApiVideoId &&
    !(pendingAnnotateJob && pendingAnnotateJob.api_pending)
  );
}

function stopApiNextCountdown(hide = false) {
  if (!apiNextVideoCountdown) return;
  apiNextVideoCountdown.classList.remove("active", "urgent", "critical");
  if (hide) {
    apiNextVideoCountdown.classList.add("hidden");
    if (apiNextVideoValue) apiNextVideoValue.textContent = "—";
  }
}

function showApiNextIdle() {
  if (!IS_ANNOTATOR_PAGE || !apiNextVideoCountdown || !apiNextVideoValue) return;
  const visible = shouldShowNextChallengeTimer();
  apiNextVideoCountdown.classList.toggle("hidden", !visible);
  apiNextVideoCountdown.classList.add("active");
  if (visible) {
    showAnnotatorIdleCountdown("—");
  } else {
    hideAnnotatorIdleCountdown();
  }
}

function renderApiNextCountdown(secondsLeft) {
  if (!IS_ANNOTATOR_PAGE || !apiNextVideoCountdown || !apiNextVideoValue) return;
  const n = Number(secondsLeft);
  if (!Number.isFinite(n)) {
    showApiNextIdle();
    return;
  }
  const leftSec = Math.max(0, Math.ceil(n));
  const visible = shouldShowNextChallengeTimer();
  apiNextVideoCountdown.classList.toggle("hidden", !visible);
  apiNextVideoCountdown.classList.add("active");
  apiNextVideoCountdown.classList.toggle("urgent", leftSec <= API_NEXT_WARN_5_MIN_SEC);
  apiNextVideoCountdown.classList.toggle("critical", leftSec <= API_NEXT_WARN_1_MIN_SEC);
  if (visible) {
    showAnnotatorIdleCountdown(formatApiCountdown(leftSec));
  } else {
    hideAnnotatorIdleCountdown();
  }
  if (leftSec > API_NEXT_WARN_5_MIN_SEC) apiNextWarned5Min = false;
  if (leftSec > API_NEXT_WARN_1_MIN_SEC) apiNextWarned1Min = false;
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
  renderApiNextCountdown(data.seconds_left);
  if (IS_BOARD_PAGE || IS_PRACTICE_PAGE) {
    redirectToAnnotatorForApiCall(data);
    return;
  }
  if (data.video_id && role === "annotator") {
    pendingApiVideoId = data.video_id;
    showConnectionStatus(`API job started: ${data.video_id}`, true);
    if (jobInfo && !currentJobId) {
      jobInfo.textContent = `API job started · ${data.video_id} · waiting for video…`;
    }
    hideAnnotatorIdleCountdown();
    showVideoReady();
  }
}

function handleApiSchedule(data) {
  if (!IS_ANNOTATOR_PAGE) return;
  if (data.seconds_left != null) {
    renderApiNextCountdown(data.seconds_left);
    return;
  }
  showApiNextIdle();
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
  const n = getPositiveNumber(raw);
  if (n !== null && n <= 600) {
    return Math.ceil(n);
  }
  return API_RESPONSE_FALLBACK_SEC;
}

function isExpiredAnnotateJob(data) {
  return data && "seconds_left" in data && getPositiveNumber(data.seconds_left) === null;
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
  // Prefer core bounds for the global timeline track so it always reflects
  // the user's assigned task window expanded as [x-1, y+1].
  if (
    data.segment_core_start_sec != null &&
    data.segment_core_end_sec != null
  ) {
    jobPlayGlobalStart = Math.max(0, jobCoreGlobalStart - 1);
    jobPlayGlobalEnd = Math.min(windowSec, jobCoreGlobalEnd + 1);
  } else if (data.time_origin_sec != null) {
    jobPlayGlobalStart = data.time_origin_sec;
    if (data.segment_end_sec != null) {
      jobPlayGlobalEnd = data.time_origin_sec + data.segment_end_sec;
    }
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

function annotateJobVideoUrl(data, videoId) {
  const index = data.annotator_index ?? 1;
  if (index === 1 && data.original_video_url) {
    return data.original_video_url;
  }
  return null;
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
      if (ev.code === 1008 || ev.code === 4001) {
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
  return (video.currentTime || 0) - (jobVideoLocalOrigin || 0) + (jobTimeOrigin || 0);
}

function localTimeFromGlobal(globalT) {
  return globalT - (jobTimeOrigin || 0) + (jobVideoLocalOrigin || 0);
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

function getVideoPlayers() {
  return [video, reviewerVideo].filter(Boolean);
}

function playbackRateStorageKey() {
  return currentUserId ? `${PLAYBACK_RATE_STORAGE_PREFIX}${currentUserId}` : null;
}

function savePlaybackRate() {
  const key = playbackRateStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, formatPlaybackRate(playbackRate));
  } catch {
    /* Browser storage may be unavailable in private or restricted modes. */
  }
}

function loadPlaybackRate() {
  const key = playbackRateStorageKey();
  if (!key) return;
  try {
    const storedRate = getPlaybackRate(localStorage.getItem(key));
    if (storedRate != null) {
      playbackRate = Math.max(MIN_PLAYBACK_RATE, storedRate);
    }
  } catch {
    /* Keep the default playback rate if storage is unavailable. */
  }
}

function syncPlaybackSpeedInputs() {
  const value = formatPlaybackRate(playbackRate);
  playbackSpeedInputs.forEach((input) => {
    input.value = value;
  });
}

function applyPlaybackRate() {
  getVideoPlayers().forEach((player) => {
    player.playbackRate = playbackRate;
  });
  syncPlaybackSpeedInputs();
}

function setPlaybackRate(nextRate) {
  const rate = getPlaybackRate(nextRate);
  if (rate == null) {
    syncPlaybackSpeedInputs();
    return;
  }
  playbackRate = Math.max(MIN_PLAYBACK_RATE, rate);
  applyPlaybackRate();
  savePlaybackRate();
}

function adjustPlaybackRate(delta) {
  setPlaybackRate(playbackRate + delta);
}

function handlePlaybackSpeedKeydown(e) {
  if (e.code !== "ArrowUp" && e.code !== "ArrowDown") return;
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  if (!getVideoPlayers().length) return;
  e.preventDefault();
  adjustPlaybackRate(e.code === "ArrowUp" ? PLAYBACK_RATE_STEP : -PLAYBACK_RATE_STEP);
}

function bindPlaybackSpeedControls() {
  if (!playbackSpeedInputs.length && !getVideoPlayers().length) return;
  playbackSpeedInputs.forEach((input) => {
    input.addEventListener("change", () => setPlaybackRate(input.value));
    input.addEventListener("blur", () => syncPlaybackSpeedInputs());
  });
  getVideoPlayers().forEach((player) => {
    player.addEventListener("loadedmetadata", applyPlaybackRate);
  });
  window.addEventListener("keydown", handlePlaybackSpeedKeydown, true);
  applyPlaybackRate();
}

function updateVideoHud() {
  if (!video.src) {
    updateVideoPaddingOverlay();
    updateAnnotatorInteractionState();
    return;
  }
  const globalT = globalTimeFromVideo();
  const frame = timeToFrame(globalT);
  if (videoTimeDisplay) videoTimeDisplay.textContent = globalT.toFixed(1);
  if (videoFrameDisplay) videoFrameDisplay.textContent = String(frame);
  if (videoSeek) {
    seekSyncing = true;
    videoSeek.min = String(jobPlayGlobalStart);
    videoSeek.max = String(jobPlayGlobalEnd);
    videoSeek.value = String(
      Math.min(jobPlayGlobalEnd, Math.max(jobPlayGlobalStart, globalT))
    );
    seekSyncing = false;
  }
  placeTimelineReadout(videoTimeline, videoSeek, videoTimeline?.querySelector(".timeline-live-readout"));
  updateVideoPaddingOverlay();
  updatePlayPauseButton();
  updateAnnotatorInteractionState();
}

function updateTimelineSeekRange() {
  if (!videoSeek) return;
  videoSeek.min = String(jobPlayGlobalStart);
  videoSeek.max = String(jobPlayGlobalEnd);
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
  const color =
    marker.dataset.markerColor || LABEL_COLORS[marker.dataset.label] || "#94a3b8";

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
  const timelineSec = Math.max(0.001, jobPlayGlobalEnd - jobPlayGlobalStart);
  const minePid = myParticipantId ?? 0;
  const sorted = jobEvents
    .slice()
    .filter((e) => e.participant_id === minePid)
    .sort((a, b) => a.time_sec - b.time_sec);
  const eventMarkers = sorted
    .map((e, i) => {
      const pct = Math.min(
        100,
        Math.max(0, ((e.time_sec - jobPlayGlobalStart) / timelineSec) * 100)
      );
      const color = LABEL_COLORS[e.label] || "#94a3b8";
      const mine = e.participant_id === myParticipantId;
      const labelName = labelDisplayName(e.label);
      const who = mine ? "You" : `Annotator #${e.participant_id}`;
      const stackY = markerStackOffsetAtFrame(sorted, i);
      const draggable = mine && canEditAnnotations();
      return `<button type="button" class="timeline-marker${mine ? " mine" : ""}${draggable ? " timeline-marker-draggable" : ""}" data-time="${e.time_sec}" data-frame="${e.frame}" data-label="${e.label}" data-label-name="${labelName}" data-who="${who}" data-event-id="${e.id ?? ""}" data-marker-color="${color}" style="left:${pct}%;background:${color};--stack-y:${stackY}px" aria-label="${labelName}, frame ${e.frame}" title="${draggable ? "Drag to move all events on this frame" : ""}"></button>`;
    })
    .join("");
  const candidateMarkers = eventCandidateFrames
    .filter((frame) => {
      const timeSec = frameToTime(frame);
      return timeSec >= jobPlayGlobalStart - 0.001 && timeSec <= jobPlayGlobalEnd + 0.001;
    })
    .map((frame) => {
      const timeSec = frameToTime(frame);
      const pct = Math.min(
        100,
        Math.max(0, ((timeSec - jobPlayGlobalStart) / timelineSec) * 100)
      );
      return `<button type="button" class="timeline-marker timeline-candidate-marker" data-time="${timeSec}" data-frame="${frame}" data-label-name="Candidate event frame" data-who="Candidate" data-marker-color="#22d3ee" style="left:${pct}%;" aria-label="Candidate event frame ${frame}"></button>`;
    })
    .join("");
  timelineMarkers.innerHTML = candidateMarkers + eventMarkers;
}

function applyEventFrameCandidates(data) {
  if (data.job_id && data.job_id !== currentJobId) return;
  const frames = Array.isArray(data.frames) ? data.frames : [];
  eventCandidateFrames = normalizeEventCandidateFrames(frames);
  retargetMyEventsToCandidates();
  renderTimelineMarkers();
}

function normalizeEventCandidateFrames(frames) {
  return Array.from(
    new Set(
      (frames || [])
        .map((frame) => Math.floor(Number(frame)))
        .filter((frame) => Number.isFinite(frame) && frame >= 0)
    )
  ).sort((a, b) => a - b);
}

function retargetMyEventsToCandidates() {
  if (!eventCandidateFrames.length || !canEditAnnotations()) return;
  const minePid = myParticipantId ?? 0;
  const moves = [];
  jobEvents = jobEvents.map((event) => {
    if (event.participant_id !== minePid) return event;
    const frame = event.frame ?? timeToFrame(event.time_sec);
    const candidateFrame = nearestEventCandidateFrame(frame);
    if (candidateFrame == null || candidateFrame === frame) return event;
    const adjusted = eventWithFrame(event, candidateFrame);
    moves.push({ before: event, after: adjusted });
    return adjusted;
  });
  if (!moves.length) return;
  sessionEvents = jobEvents.filter((x) => x.participant_id === myParticipantId);
  renderSessionEvents();
  if (isLocalPractice()) return;
  moves.forEach(({ before, after }) => {
    send({
      type: "annotation_remove",
      job_id: currentJobId,
      time_sec: before.time_sec,
      label: before.label,
      uid: before.uid,
    });
    send({
      type: "annotation",
      job_id: currentJobId,
      label: after.label,
      time_sec: after.time_sec,
      frame: after.frame,
      labeled_time_sec: after.labeled_time_sec ?? before.labeled_time_sec ?? before.time_sec,
    });
  });
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
    labeled_time_sec: e.labeled_time_sec ?? e.time_sec,
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
    video.currentTime = start;
    video.play().catch(() => {});
  }
}

function loopAnnotatorVideo() {
  if (!canEditAnnotations()) return;
  const { start } = playbackLocalBounds();
  video.currentTime = start;
  video.play().catch(() => {});
}

function stepFrame(delta) {
  if (!video.src) return;
  clearSelectedEvent();
  const wasPlaying = !video.paused;
  const frameTime = 1 / videoFps;
  const { start, end } = playbackLocalBounds();
  video.currentTime = Math.min(
    end,
    Math.max(start, video.currentTime + delta * frameTime)
  );
  if (wasPlaying) video.play().catch(() => {});
  updateVideoHud();
}

function arrowFrameDelta(dir) {
  return dir * (video.paused ? ARROW_PAUSED_FRAME_STEP : ARROW_PLAYING_FRAME_STEP);
}

function startArrowHold(dir) {
  stopArrowHold();
  stepFrame(arrowFrameDelta(dir));
  arrowHoldDir = dir;
  arrowHoldDelay = setTimeout(() => {
    arrowHoldDelay = null;
    arrowHoldTimer = setInterval(
      () => stepFrame(arrowFrameDelta(dir)),
      ARROW_HOLD_INTERVAL_MS
    );
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

function clearAnnotatorVideo(showNextTimer = false) {
  clearPostDeadlineCleanupTimer();
  stopVideoPoll();
  stopVideoHudLoop();
  stopApiCountdown(true);
  hideVideoReady();
  video.pause();
  video.removeAttribute("src");
  video.load();
  updatePlayPauseButton();
  updateVideoHud();
  jobEvents = [];
  sessionEvents = [];
  selectedEventId = null;
  timelineMarkers.innerHTML = "";
  renderSessionEvents();
  hideTimelineMarkerTooltipFor(videoTimeline);
  clearSelectedEvent();
  currentJobId = null;
  loadedVideoJobId = null;
  pendingApiVideoId = null;
  eventCandidateFrames = [];
  updateAnnotatorInteractionState();
  if (showNextTimer) showApiNextIdle();
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

function normalizeShortcutKey(key) {
  const value = String(key || "").trim().toLowerCase();
  return /^[a-z0-9]$/.test(value) ? value : "";
}

function applyLabelShortcuts(shortcuts) {
  currentLabelShortcuts = { ...defaultLabelShortcuts, ...(shortcuts || {}) };
  keyToLabel = Object.fromEntries(
    Object.entries(currentLabelShortcuts).map(([labelId, key]) => [key, labelId])
  );
}

function labelShortcut(labelId) {
  return currentLabelShortcuts[labelId] || defaultLabelShortcuts[labelId] || "";
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
      btn.textContent = `${label.display.toUpperCase()} (${formatLabelKey(labelShortcut(label.id))})`;
      btn.title = `${label.display} — ${label.id}`;
      btn.addEventListener("click", () => annotate(label.id));
      labelButtons.appendChild(btn);
    });
  });
  buildShortcutEditor();
}

function rebuildLabelUi() {
  buildLabelButtons();
}

function buildShortcutEditor() {
  if (!labelButtons || !LABELS.length) return;
  const panel = document.createElement("details");
  panel.className = "shortcut-editor";
  panel.innerHTML = `
    <summary>Customize shortcuts</summary>
    <div class="shortcut-editor-grid"></div>
    <div class="shortcut-editor-actions">
      <button type="button" class="small-btn" data-shortcut-save>Save shortcuts</button>
      <button type="button" class="small-btn" data-shortcut-reset>Reset defaults</button>
      <span class="shortcut-editor-status" role="status"></span>
    </div>
  `;
  const grid = panel.querySelector(".shortcut-editor-grid");
  LABELS.forEach((label) => {
    const row = document.createElement("label");
    row.className = "shortcut-editor-row";
    row.innerHTML = `
      <span>${label.display}</span>
      <input type="text" maxlength="1" value="${labelShortcut(label.id)}" data-shortcut-label="${label.id}" aria-label="${label.display} shortcut" />
    `;
    grid.appendChild(row);
  });
  panel.querySelector("[data-shortcut-save]").addEventListener("click", () => saveShortcutEditor(panel));
  panel.querySelector("[data-shortcut-reset]").addEventListener("click", () => resetShortcutEditor(panel));
  panel.addEventListener("input", (e) => {
    const input = e.target.closest("[data-shortcut-label]");
    if (!input) return;
    input.value = normalizeShortcutKey(input.value);
    setShortcutEditorStatus(panel, "");
  });
  labelButtons.appendChild(panel);
}

function shortcutEditorValues(panel) {
  const values = {};
  panel.querySelectorAll("[data-shortcut-label]").forEach((input) => {
    values[input.dataset.shortcutLabel] = normalizeShortcutKey(input.value);
  });
  return values;
}

function validateShortcutEditor(values) {
  const used = new Map();
  for (const label of LABELS) {
    const key = values[label.id];
    if (!key) return `${label.display} needs one letter or digit.`;
    if (used.has(key)) {
      return `${formatLabelKey(key)} is already used by ${used.get(key)}.`;
    }
    used.set(key, label.display);
  }
  return "";
}

function setShortcutEditorStatus(panel, message, isError = false) {
  const status = panel.querySelector(".shortcut-editor-status");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function saveShortcutEditor(panel) {
  const shortcuts = shortcutEditorValues(panel);
  const error = validateShortcutEditor(shortcuts);
  if (error) {
    setShortcutEditorStatus(panel, error, true);
    return;
  }
  setShortcutEditorStatus(panel, "Saving...");
  try {
    const res = await apiFetch("/api/label-shortcuts", {
      method: "PUT",
      body: JSON.stringify({ shortcuts }),
    });
    if (!res.ok) throw new Error("Shortcut save failed");
    const data = await res.json();
    applyLabelShortcuts(data.shortcuts || shortcuts);
    rebuildLabelUi();
  } catch {
    setShortcutEditorStatus(panel, "Could not save shortcuts.", true);
  }
}

async function resetShortcutEditor(panel) {
  setShortcutEditorStatus(panel, "Saving...");
  try {
    const res = await apiFetch("/api/label-shortcuts", {
      method: "PUT",
      body: JSON.stringify({ shortcuts: defaultLabelShortcuts }),
    });
    if (!res.ok) throw new Error("Shortcut reset failed");
    const data = await res.json();
    applyLabelShortcuts(data.shortcuts || defaultLabelShortcuts);
    rebuildLabelUi();
  } catch {
    setShortcutEditorStatus(panel, "Could not reset shortcuts.", true);
  }
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
  const minePid = myParticipantId ?? 0;
  eventsList.innerHTML = jobEvents
    .slice()
    .filter((e) => e.participant_id === minePid)
    .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
    .map((e) => {
      const labelName = labelDisplayName(e.label);
      const mine = e.participant_id === myParticipantId;
      const annotatorColor = participantColor(e.participant_id);
      const eventColor = LABEL_COLORS[e.label] || "#94a3b8";
      const style = `border-left: 4px solid ${annotatorColor}; background: color-mix(in srgb, ${eventColor} 20%, transparent)`;
      const selected = mine && e.id === selectedEventId;
      const text = `${e.frame} - ${labelName}`;
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
  if (currentJobId && !isLocalPractice()) {
    send({
      type: "annotation_remove",
      job_id: currentJobId,
      time_sec: removed.time_sec,
      label: removed.label,
      uid: removed.uid,
    });
  }
}

function latestMyEvent() {
  const minePid = myParticipantId ?? 0;
  return jobEvents
    .filter((e) => e.participant_id === minePid)
    .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];
}

function selectedOrLatestMyEvent() {
  if (selectedEventId != null) {
    const selected = jobEvents.find(
      (x) => x.id === selectedEventId && x.participant_id === myParticipantId
    );
    if (selected) return selected;
  }
  return latestMyEvent();
}

function seekToFrame(frame) {
  if (!video.src) return;
  const { start, end } = playbackLocalBounds();
  const wasPlaying = !video.paused;
  const localTime = localTimeFromGlobal(frameToTime(frame));
  video.currentTime = Math.min(end, Math.max(start, localTime));
  if (wasPlaying) video.play().catch(() => {});
  updateVideoHud();
  updatePlayPauseButton();
}

function scrubPausedToFrame(frame) {
  if (!video.src) return;
  const { start, end } = playbackLocalBounds();
  const localTime = localTimeFromGlobal(frameToTime(frame));
  video.pause();
  video.currentTime = Math.min(end, Math.max(start, localTime));
  updateVideoHud();
  updatePlayPauseButton();
}

function deleteEventAndSeekBack(event, frameOffset) {
  if (!event) return false;
  const frame = event.frame ?? timeToFrame(event.time_sec);
  removeSessionEvent(event.id);
  seekToFrame(Math.max(0, frame - frameOffset));
  return true;
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
    labeled_time_sec: globalTimeFromVideo(),
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
  const currentTimeSec = globalTimeFromVideo();
  if (!isInAnnotationRange(currentTimeSec)) return;
  const { time_sec, frame } = annotationPointForLabel(labelId, currentTimeSec);
  if (isLocalPractice()) {
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
    labeled_time_sec: currentTimeSec,
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
  const directVideoUrl = annotateJobVideoUrl(data, videoId);

  if (data.job_id === loadedVideoJobId && video.src) {
    const expected = directVideoUrl || serverVideoApiPath(videoId);
    if (
      sameVideoUrl(video.src, expected) ||
      video.src.includes(encodeURIComponent(videoId)) ||
      video.src.includes(videoId)
    ) {
      return;
    }
  }

  stopVideoPoll();
  clearPostDeadlineCleanupTimer();
  pendingApiVideoId = null;
  hideAnnotatorIdleCountdown();
  currentJobId = data.job_id;
  loadedVideoJobId = data.job_id;
  setAnnotationsLocked(false);
  resetPresenceIdleTimer();
  jobEvents = [];
  sessionEvents = [];
  selectedEventId = null;
  nextEventId = 0;
  eventCandidateFrames = normalizeEventCandidateFrames(data.candidate_frames);
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
    jobInfo.textContent = directVideoUrl
      ? `${prefix} · loading original video… · ${index}/${total}`
      : `${prefix} · waiting for video ${videoId}… · ${index}/${total}`;
  }

  showVideoReady();
  video.pause();
  const url = directVideoUrl || (await waitForServerVideo(videoId, secondsLeft));
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
    applyPlaybackRate();
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

async function startDirectPracticeJob(data) {
  const url = data.video_file || data.source_url;
  if (!url) return;

  stopVideoPoll();
  clearPostDeadlineCleanupTimer();
  pendingApiVideoId = null;
  hideAnnotatorIdleCountdown();
  currentJobId = data.job_id;
  loadedVideoJobId = data.job_id;
  setAnnotationsLocked(false);
  resetPresenceIdleTimer();
  jobEvents = [];
  sessionEvents = [];
  selectedEventId = null;
  nextEventId = 0;
  eventCandidateFrames = [];
  applyJobTiming(data);
  jobVideoLocalOrigin = 0;
  myParticipantId = myParticipantId ?? 1;
  renderSessionEvents();
  renderTimelineMarkers();

  if (jobInfo) {
    jobInfo.textContent = `${isExternalPractice() ? "External video" : "Private practice"} · loading ${data.video_id || "video"}…`;
  }

  showVideoReady();
  video.pause();
  try {
    await waitForVideoMetadata(url);
    applyPlaybackRate();
    const duration =
      video.duration && Number.isFinite(video.duration) ? video.duration : 30;
    const isPrivate = isPrivatePractice();
    const taskDuration = isPrivate
      ? Math.min(privatePracticeDuration(), duration)
      : duration;
    const clipStart = isPrivate
      ? randomPrivatePracticeStart(duration, taskDuration)
      : 0;
    const clipEnd = clipStart + taskDuration;
    data.segment_window_sec = duration;
    data.start_offset_sec = clipStart;
    data.time_origin_sec = 0;
    data.segment_end_sec = taskDuration;
    data.clip_duration_sec = taskDuration;
    data.segment_core_start_sec = 0;
    data.segment_core_end_sec = taskDuration;
    data.duration_sec = taskDuration;
    jobVideoLocalOrigin = clipStart;
    applyJobTiming(data);
    await waitForVideoAtOffset(clipStart);
    updateTimelineSeekRange();
    updateTimelineZones();
    estimateFps();
    video.currentTime = clipStart;
    await video.play().catch(() => {});
    startVideoHudLoop();
    updateVideoHud();
    renderTimelineMarkers();
    if (jobInfo) {
      const label = isExternalPractice() ? "External video" : "Private practice";
      const windowText = isPrivate
        ? `${taskDuration.toFixed(0)}s from ${clipStart.toFixed(1)}s`
        : "full video";
      jobInfo.textContent = `${label} · ${windowText} · ${data.video_id || "video"}`;
    }
  } catch {
    setStatusMessage(`Video failed to load (${data.video_id || "external video"})`, jobInfo);
  } finally {
    hideVideoReady();
  }
}

function handleAnnotateStart(data) {
  if (isExpiredAnnotateJob(data)) {
    currentJobId = null;
    loadedVideoJobId = null;
    pendingApiVideoId = null;
    pendingAnnotateJob = null;
    eventCandidateFrames = [];
    stopApiCountdown(true);
    hideVideoReady();
    showApiNextIdle();
    return;
  }
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
  setAnnotationsLocked(true);
  jobEvents = [];
  sessionEvents = [];
  selectedEventId = null;
  eventCandidateFrames = [];
  renderSessionEvents();
  renderTimelineMarkers();
  clearAnnotatorVideo(false);
  showApiNextIdle();
}

function handleTestStart(data) {
  if (!isSyncPractice()) return;
  goToTestJob(data);
}

function buildPrivatePracticeJob(video, durationSec = privatePracticeDuration()) {
  return {
    job_id: `private-${video.video_id}-${Date.now()}`,
    video_id: video.video_id,
    video_file: serverVideoApiPath(video.video_id),
    source_url: video.video_url,
    annotator_index: 1,
    annotator_total: 1,
    segment_window_sec: durationSec,
    start_offset_sec: 0,
    time_origin_sec: 0,
    segment_end_sec: durationSec,
    clip_duration_sec: durationSec,
    segment_core_start_sec: 0,
    segment_core_end_sec: durationSec,
    duration_sec: durationSec,
    seconds_left: durationSec,
  };
}

function externalVideoId(url) {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.split("/").filter(Boolean).pop() || "external-video";
    return decodeURIComponent(name).replace(/\.[^.]+$/, "") || "external-video";
  } catch {
    return "external-video";
  }
}

function buildExternalPracticeJob(url) {
  const videoId = externalVideoId(url);
  return {
    job_id: `external-${Date.now()}`,
    video_id: videoId,
    video_file: url,
    source_url: url,
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
  jobEvents = [];
  sessionEvents = [];
  selectedEventId = null;
  eventCandidateFrames = [];
  renderSessionEvents();
  renderTimelineMarkers();
  clearAnnotatorVideo(false);
  if (IS_ANNOTATOR_PAGE && !IS_PRACTICE_PAGE) showApiNextIdle();
}

function updatePracticeModeUI() {
  const sync = practiceMode === "sync";
  const privateMode = practiceMode === "private";
  const externalMode = practiceMode === "external";
  document.body.classList.toggle("practice-private", privateMode);
  btnPracticeSync?.classList.toggle("active", sync);
  btnPracticePrivate?.classList.toggle("active", privateMode);
  btnPracticeExternal?.classList.toggle("active", externalMode);
  btnPracticeSync?.setAttribute("aria-pressed", sync ? "true" : "false");
  btnPracticePrivate?.setAttribute("aria-pressed", privateMode ? "true" : "false");
  btnPracticeExternal?.setAttribute("aria-pressed", externalMode ? "true" : "false");
  practiceVideoPanel?.classList.toggle("hidden", !privateMode);
  privatePracticeDurationControl?.classList.toggle("hidden", !privateMode);
  externalVideoForm?.classList.toggle("hidden", !externalMode);
  testNextCountdown?.classList.toggle("hidden", !sync);
  if (!sync) {
    apiCountdown?.classList.add("hidden");
  }
  if (practiceModeHint) {
    practiceModeHint.textContent = sync
      ? "Scheduled rounds with other online practice users."
      : externalMode
        ? "Paste a direct video URL and practice locally on that video."
        : "Pick a saved video and practice a random clip with the selected task time.";
  }
  if (practiceEventsHeading) {
    practiceEventsHeading.textContent = sync
      ? "Events this session"
      : "Your annotations";
  }
}

function setPracticeMode(mode) {
  if (!IS_PRACTICE_PAGE || !["sync", "private", "external"].includes(mode)) return;
  if (mode === practiceMode) return;
  practiceMode = mode;
  updatePracticeModeUI();
  resetPracticeJob();
  send({ type: "set_practice_mode", mode: mode === "sync" ? "sync" : "private" });
  if (mode === "private") {
    stopTestNextCountdown(true);
    send({ type: "list_videos" });
    if (jobInfo) {
      jobInfo.textContent = "Private practice — choose a video from the list";
    }
  } else if (mode === "external") {
    stopTestNextCountdown(true);
    if (jobInfo) {
      jobInfo.textContent = "External video — paste a video URL to start";
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
  const durationSec = privatePracticeDuration();
  const availableSec = privatePracticeAvailableTime();
  const data = buildPrivatePracticeJob(video, durationSec);
  stopApiCountdown(true);
  stopTestNextCountdown(true);
  setAnnotationsLocked(false);
  if (jobInfo) {
    jobInfo.textContent = `Private practice · task ${durationSec}s · available ${availableSec}s · ${video.video_id}`;
  }
  await startDirectPracticeJob(data);
  startApiCountdownSecondsLeft(availableSec);
}

async function startExternalPractice(url) {
  const trimmed = String(url || "").trim();
  if (!isExternalPractice() || !trimmed) return;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    setStatusMessage("Enter a valid video URL.", jobInfo);
    return;
  }
  const data = buildExternalPracticeJob(parsed.href);
  stopApiCountdown(true);
  stopTestNextCountdown(true);
  setAnnotationsLocked(false);
  await startDirectPracticeJob(data);
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
  btnPracticeExternal?.addEventListener("click", () => setPracticeMode("external"));
  privatePracticeDurationInput?.addEventListener("change", () => {
    privatePracticeDuration();
  });
  privatePracticeDurationInput?.addEventListener("blur", () => {
    privatePracticeDuration();
  });
  privatePracticeAvailableInput?.addEventListener("change", () => {
    privatePracticeAvailableTime();
  });
  privatePracticeAvailableInput?.addEventListener("blur", () => {
    privatePracticeAvailableTime();
  });
  externalVideoForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    startExternalPractice(externalVideoUrl?.value);
  });
  bindVideoListDateHandlers();
  updatePracticeModeUI();
}

function goToTestJob(data) {
  if (!isSyncPractice()) return;
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
  if (!isSyncPractice()) return;
  nextTestRoundAtSec = data.next_round_at;
  if (!currentJobId) {
    startTestNextCountdown(nextTestRoundAtSec);
  }
}

function handleMessage(data) {
  switch (data.type) {
    case "role_ack":
      if (data.annotator_id != null) myParticipantId = data.annotator_id;
      setPresenceIdleMinutes(data.presence_idle_minutes);
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
        if (!(pendingAnnotateJob && pendingAnnotateJob.api_pending) && !pendingApiVideoId) {
          showApiNextIdle();
        } else {
          hideAnnotatorIdleCountdown();
        }
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
        clearAnnotatorVideo(false);
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
    case "annotator_roster":
      renderAnnotatorRoster(data.annotators);
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
    case "api_schedule":
      handleApiSchedule(data);
      break;
    case "annotate_start":
      handleAnnotateStart(data);
      break;
    case "job_event":
      handleJobEvent(data);
      break;
    case "event_frame_candidates":
      applyEventFrameCandidates(data);
      break;
    case "test_start":
      if (IS_PRACTICE_PAGE) handleTestStart(data);
      break;
    case "test_schedule":
      if (IS_PRACTICE_PAGE) handleTestSchedule(data);
      break;
    case "practice_mode_ack":
      if (IS_PRACTICE_PAGE && data.mode) {
        if (practiceMode !== "external") {
          practiceMode = data.mode === "private" ? "private" : "sync";
        }
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
  if (selectedRole !== "annotator" && selectedRole !== "test") {
    clearAnnotatorVideo(false);
    hideAnnotatorIdleCountdown();
  }
  role = selectedRole;
  send({ type: "set_role", role: selectedRole });
}

function handleAnnotatorKeydown(e) {
  if (!isAnnotatingRole()) return;

  if (e.code === "Delete" || e.key === "Delete") {
    if (isAnnotatorShortcutBlocked(e)) return;
    if (!canEditAnnotations()) return;
    const eventToDelete = selectedOrLatestMyEvent();
    if (!eventToDelete) return;
    e.preventDefault();
    removeSessionEvent(eventToDelete.id);
    return;
  }

  if (e.code === "Backspace" || e.key === "Backspace") {
    if (isAnnotatorShortcutBlocked(e)) return;
    if (!canEditAnnotations()) return;
    const eventToDelete = selectedOrLatestMyEvent();
    if (!eventToDelete) return;
    e.preventDefault();
    deleteEventAndSeekBack(eventToDelete, 10);
    return;
  }

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
  if (e.defaultPrevented) return;
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
  loadPlaybackRate();
  applyPlaybackRate();

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

bindPlaybackSpeedControls();
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
  if (suppressTimelineMarkerClick) {
    suppressTimelineMarkerClick = false;
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const btn = e.target.closest(".timeline-marker");
  if (!btn) return;
  const eventId = Number(btn.dataset.eventId);
  if (Number.isFinite(eventId)) {
    const ev = jobEvents.find((x) => x.id === eventId);
    if (ev?.participant_id === myParticipantId && canEditAnnotations()) {
      setSelectedEvent(eventId);
      return;
    }
  }
  clearSelectedEvent();
  const globalTime = parseFloat(btn.dataset.time);
  if (!Number.isFinite(globalTime)) return;
  video.pause();
  video.currentTime = localTimeFromGlobal(globalTime);
  updateVideoHud();
  updatePlayPauseButton();
});

timelineMarkers?.addEventListener("pointerdown", (e) => {
  const btn = e.target.closest(".timeline-marker-draggable");
  if (!btn || !canEditAnnotations()) return;
  const frame = Number(btn.dataset.frame);
  if (!Number.isFinite(frame)) return;
  e.preventDefault();
  e.stopPropagation();
  hideTimelineMarkerTooltipFor(videoTimeline);
  const markers = Array.from(
    timelineMarkers.querySelectorAll(".timeline-marker-draggable")
  ).filter((marker) => Number(marker.dataset.frame) === frame);
  timelineMarkerDrag = {
    pointerId: e.pointerId,
    fromFrame: frame,
    currentFrame: frame,
    markers,
    wasPlaying: !video.paused,
    moved: false,
  };
  scrubPausedToFrame(frame);
  markers.forEach((marker) => marker.classList.add("dragging"));
  timelineMarkers.setPointerCapture?.(e.pointerId);
});

timelineMarkers?.addEventListener("pointermove", (e) => {
  if (!timelineMarkerDrag || timelineMarkerDrag.pointerId !== e.pointerId) return;
  const frame = frameFromTimelineClientX(e.clientX);
  if (frame == null) return;
  if (frame !== timelineMarkerDrag.fromFrame) timelineMarkerDrag.moved = true;
  timelineMarkerDrag.currentFrame = frame;
  setTimelineMarkersFramePosition(frame, timelineMarkerDrag.markers);
  scrubPausedToFrame(frame);
});

function finishTimelineMarkerDrag(e, commit) {
  if (!timelineMarkerDrag || timelineMarkerDrag.pointerId !== e.pointerId) return;
  const drag = timelineMarkerDrag;
  timelineMarkerDrag = null;
  timelineMarkers?.querySelectorAll(".timeline-marker.dragging").forEach((marker) => {
    marker.classList.remove("dragging");
  });
  if (timelineMarkers?.hasPointerCapture?.(e.pointerId)) {
    timelineMarkers.releasePointerCapture?.(e.pointerId);
  }
  if (commit && drag.moved) {
    suppressTimelineMarkerClick = true;
    setTimeout(() => {
      suppressTimelineMarkerClick = false;
    }, 0);
    moveMyEventsAtFrame(drag.fromFrame, drag.currentFrame);
  }
  if (commit && drag.wasPlaying) {
    video.play().catch(() => {});
    updatePlayPauseButton();
  }
}

timelineMarkers?.addEventListener("pointerup", (e) => {
  finishTimelineMarkerDrag(e, true);
});

timelineMarkers?.addEventListener("pointercancel", (e) => {
  finishTimelineMarkerDrag(e, false);
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
  video.addEventListener("ended", loopAnnotatorVideo);
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
      const stackY = markerStackOffsetAtFrame(sorted, i);
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

function handleBoardPlayerKeydown(e) {
  if (e.code !== "Space") return;
  if (e.isComposing || isTextEntryElement(document.activeElement)) return;
  if (!reviewerVideo?.src) return;
  e.preventDefault();
  toggleBoardPlayPause();
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
  window.addEventListener("keydown", handleBoardPlayerKeydown, true);
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
      const annotatorColor = participantColor(pid);
      const eventColor = LABEL_COLORS[e.label] || "#94a3b8";
      const labelName = labelDisplayName(e.label);
      const frame = e.frame ?? timeToFrame(e.time_sec);
      const text = `${frame} - ${labelName}`;
      return `<li class="event-row" style="border-left: 4px solid ${annotatorColor}; background: color-mix(in srgb, ${eventColor} 20%, transparent)"><button type="button" class="event-item event-goto" data-time="${e.time_sec}">${text}</button></li>`;
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
  applyPlaybackRate();
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
