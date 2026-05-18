const DEFAULT_FPS = 25;

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

let ws = null;
let role = null;
let currentJobId = null;
let sessionEvents = [];
let overlayTimer = null;
let videoFps = DEFAULT_FPS;
let frameRafId = null;

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

function showScreen(screen) {
  [roleScreen, annotatorScreen, reviewerScreen].forEach((el) => {
    el.classList.toggle("active", el === screen);
  });
}

function showRoleModal() {
  rolePickerModal.classList.remove("hidden");
}

function hideRoleModal() {
  rolePickerModal.classList.add("hidden");
}

function connectWebSocket() {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    ws = new WebSocket(wsUrl());
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("WebSocket connection failed"));
    ws.onmessage = (ev) => handleMessage(JSON.parse(ev.data));
    ws.onclose = () => {
      roleStatus.textContent = "Disconnected. Refresh the page.";
    };
  });
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
  updatePlayPauseButton();
}

function startVideoHudLoop() {
  stopVideoHudLoop();
  const tick = () => {
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

function buildLabelButtons() {
  labelButtons.innerHTML = "";
  LABELS.forEach((label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "label-btn";
    btn.innerHTML = `${label.display}<kbd>${label.key.toUpperCase()}</kbd>`;
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
  eventsList.innerHTML = sessionEvents
    .slice()
    .sort((a, b) => a.time_sec - b.time_sec)
    .map(
      (e) =>
        `<li>frame ${e.frame} · ${e.time_sec.toFixed(2)}s — ${e.label}</li>`
    )
    .join("");
}

function annotate(labelId) {
  if (!currentJobId || !video.src) return;
  const time_sec = video.currentTime;
  const frame = timeToFrame(time_sec);
  const event = { time_sec, frame, label: labelId };
  sessionEvents.push(event);
  renderSessionEvents();
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

async function startAnnotatorJob(data) {
  currentJobId = data.job_id;
  sessionEvents = [];
  renderSessionEvents();

  jobInfo.textContent = `Job active · start ${data.start_offset_sec.toFixed(2)}s · ${data.annotator_index}/${data.annotator_total}`;

  video.src = data.video_url;
  video.load();

  const offset = data.start_offset_sec || 0;

  const playFromOffset = async () => {
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
  };

  if (video.readyState >= 1) {
    await playFromOffset();
  } else {
    video.addEventListener("loadedmetadata", () => playFromOffset(), {
      once: true,
    });
  }
}

function handleMessage(data) {
  switch (data.type) {
    case "role_ack":
      if (data.role === "annotator") {
        sessionInfo.textContent = `You are annotator #${data.annotator_index} of ${data.annotator_total} · offset ${data.start_offset_sec.toFixed(2)}s`;
        jobInfo.textContent = "Waiting for API request…";
        buildLabelButtons();
        showScreen(annotatorScreen);
      }
      if (data.role === "reviewer") {
        if (data.videos) renderVideoList(data.videos);
        showScreen(reviewerScreen);
        stopVideoHudLoop();
        video.pause();
        video.removeAttribute("src");
      }
      hideRoleModal();
      break;
    case "annotator_count":
      if (role === "annotator") {
        sessionInfo.textContent = `Connected annotators: ${data.count}`;
      }
      break;
    case "annotate_start":
      if (role === "annotator") {
        startAnnotatorJob(data);
      }
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
    role = selectedRole;
    send({ type: "set_role", role: selectedRole });
    if (selectedRole === "annotator") {
      buildLabelButtons();
    }
  } catch {
    roleStatus.textContent = "Could not connect to server.";
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
    if (role !== "annotator") return;
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

document.getElementById("btn-annotator").addEventListener("click", () => {
  roleStatus.textContent = "Connecting…";
  enterRole("annotator").then(() => {
    roleStatus.textContent = "";
  });
});

document.getElementById("btn-reviewer").addEventListener("click", () => {
  roleStatus.textContent = "Connecting…";
  enterRole("reviewer").then(() => {
    roleStatus.textContent = "";
  });
});

document.getElementById("btn-switch-role-annotator").addEventListener("click", showRoleModal);
document.getElementById("btn-switch-role-reviewer").addEventListener("click", showRoleModal);
document.getElementById("modal-btn-cancel").addEventListener("click", hideRoleModal);
document.getElementById("modal-btn-annotator").addEventListener("click", () => switchToRole("annotator"));
document.getElementById("modal-btn-reviewer").addEventListener("click", () => switchToRole("reviewer"));

document.getElementById("btn-refresh-videos").addEventListener("click", () => {
  send({ type: "list_videos" });
});

btnPlayPause.addEventListener("click", togglePlayPause);

video.addEventListener("play", updatePlayPauseButton);
video.addEventListener("pause", updatePlayPauseButton);
video.addEventListener("seeked", updateVideoHud);
video.addEventListener("loadedmetadata", estimateFps);

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
    btn.innerHTML = `<strong>${v.video_key}</strong><br>${v.event_count} events · ${date}`;
    btn.addEventListener("click", () => loadReviewerVideo(v, btn));
    li.appendChild(btn);
    videoList.appendChild(li);
  });
}

async function loadReviewerVideo(item, btn) {
  videoList.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  reviewerVideo.src = item.video_file;
  reviewerMeta.textContent = item.video_url || item.video_key;
  try {
    const res = await fetch(item.annotations_file);
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
        reviewerVideo.currentTime = parseFloat(b.dataset.time);
        reviewerVideo.play();
      });
    });
  } catch {
    reviewerEvents.innerHTML = "<li>Failed to load annotations</li>";
  }
}
