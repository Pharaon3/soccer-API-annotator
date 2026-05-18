const DEFAULT_FPS = 25;
const API_RESPONSE_SEC = 22;
const AUTH_TOKEN_KEY = "auth_token";
const AUTH_ADMIN_KEY = "is_admin";

const authScreen = document.getElementById("auth-screen");
const adminScreen = document.getElementById("admin-screen");
const userAuthCard = document.getElementById("user-auth-card");
const adminLoginCard = document.getElementById("admin-login-card");
const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const adminLoginForm = document.getElementById("admin-login-form");
const authMessage = document.getElementById("auth-message");
const adminAuthMessage = document.getElementById("admin-auth-message");
const pendingUsersList = document.getElementById("pending-users-list");

let authToken = localStorage.getItem(AUTH_TOKEN_KEY) || "";
let isAdmin = localStorage.getItem(AUTH_ADMIN_KEY) === "1";
let wsAuthed = false;
let wsConnectResolve = null;

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
const videoReady = document.getElementById("video-ready");

let ws = null;
let role = null;
let currentJobId = null;
let pendingAnnotateJob = null;
let notificationPermissionRequested = false;
let sessionEvents = [];
let overlayTimer = null;
let videoFps = DEFAULT_FPS;
let frameRafId = null;
let countdownRafId = null;
let countdownDeadline = null;

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

const allScreens = [
  authScreen,
  adminScreen,
  roleScreen,
  annotatorScreen,
  reviewerScreen,
];

function showScreen(screen) {
  allScreens.forEach((el) => {
    if (el) el.classList.toggle("active", el === screen);
  });
  document.body.classList.toggle("no-scroll", screen === annotatorScreen);
  if (screen !== annotatorScreen) {
    stopApiCountdown(true);
  }
}

function saveAuth(token, admin) {
  authToken = token;
  isAdmin = admin;
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_ADMIN_KEY, admin ? "1" : "0");
}

function clearAuth() {
  authToken = "";
  isAdmin = false;
  wsAuthed = false;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_ADMIN_KEY);
  if (ws) {
    ws.close();
    ws = null;
  }
}

async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(url, { ...options, headers });
}

function formatSignupTime(ts) {
  return new Date(ts * 1000).toLocaleString();
}

function renderPendingUsers(users) {
  if (!pendingUsersList) return;
  if (!users.length) {
    pendingUsersList.innerHTML = "<li><em>No pending signups</em></li>";
    return;
  }
  pendingUsersList.innerHTML = users
    .map(
      (u) => `
    <li class="pending-user-item">
      <div>
        <strong>${u.username}</strong>
        <span class="pending-time">${formatSignupTime(u.created_at)}</span>
      </div>
      <div class="pending-actions">
        <button type="button" class="small-btn approve-btn" data-id="${u.id}">Approve</button>
        <button type="button" class="small-btn reject-btn" data-id="${u.id}">Reject</button>
      </div>
    </li>`
    )
    .join("");
  pendingUsersList.querySelectorAll(".approve-btn").forEach((btn) => {
    btn.addEventListener("click", () => approveUser(parseInt(btn.dataset.id, 10)));
  });
  pendingUsersList.querySelectorAll(".reject-btn").forEach((btn) => {
    btn.addEventListener("click", () => rejectUser(parseInt(btn.dataset.id, 10)));
  });
}

function alertAdminSignup(user) {
  const title = "New signup request";
  const body = `${user.username} requested access.`;
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, { body, tag: "signup-pending" });
    } catch {
      window.alert(`${title}\n\n${body}`);
    }
  } else {
    window.alert(`${title}\n\n${body}`);
  }
}

async function approveUser(userId) {
  send({ type: "admin_approve", user_id: userId });
}

async function rejectUser(userId) {
  send({ type: "admin_reject", user_id: userId });
}

async function loadPendingUsers() {
  const res = await apiFetch("/api/admin/pending");
  if (res.ok) {
    renderPendingUsers(await res.json());
  }
}

async function enterAdmin() {
  await connectWebSocket();
  requestNotificationPermission();
  showScreen(adminScreen);
  await loadPendingUsers();
  send({ type: "admin_pending" });
}

function logout() {
  apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  clearAuth();
  role = null;
  showScreen(authScreen);
}

function stopApiCountdown(hide = false) {
  if (countdownRafId !== null) {
    cancelAnimationFrame(countdownRafId);
    countdownRafId = null;
  }
  countdownDeadline = null;
  if (!apiCountdown) return;
  apiCountdown.classList.remove("active", "urgent", "done");
  if (hide) {
    apiCountdown.classList.add("hidden");
    if (countdownValue) countdownValue.textContent = "—";
  }
}

function startApiCountdown(durationSec = API_RESPONSE_SEC) {
  if (!apiCountdown || !countdownValue) return;
  stopApiCountdown();
  apiCountdown.classList.remove("hidden", "done");
  apiCountdown.classList.add("active");
  countdownDeadline = performance.now() + durationSec * 1000;

  const tick = () => {
    const leftMs = countdownDeadline - performance.now();
    const leftSec = Math.max(0, leftMs / 1000);
    const display = Math.ceil(leftSec);
    countdownValue.textContent = String(display);
    apiCountdown.classList.toggle("urgent", display <= 5 && display > 0);

    if (leftSec <= 0) {
      countdownValue.textContent = "0";
      apiCountdown.classList.remove("urgent", "active");
      apiCountdown.classList.add("done");
      countdownRafId = null;
      return;
    }
    countdownRafId = requestAnimationFrame(tick);
  };
  countdownRafId = requestAnimationFrame(tick);
}

function showRoleModal() {
  rolePickerModal.classList.remove("hidden");
}

function hideRoleModal() {
  rolePickerModal.classList.add("hidden");
}

function requestNotificationPermission() {
  if (notificationPermissionRequested || !("Notification" in window)) return;
  notificationPermissionRequested = true;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

function notifyNewAnnotationJob(data) {
  const title = "New annotation job";
  const body = "A video is ready to annotate. Switching to annotator…";
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
  } else {
    window.alert(`${title}\n\n${body}`);
  }
}

function showVideoReady() {
  if (videoReady) videoReady.classList.remove("hidden");
}

function hideVideoReady() {
  if (videoReady) videoReady.classList.add("hidden");
}

function goToAnnotatorForJob(data) {
  hideRoleModal();
  buildLabelButtons();
  showScreen(annotatorScreen);

  if (role !== "annotator") {
    pendingAnnotateJob = data;
    role = "annotator";
    send({ type: "set_role", role: "annotator" });
    return;
  }
  startAnnotatorJob(data);
}

function applyRoleAckToJob(data, ack) {
  return {
    ...data,
    annotator_index: ack.annotator_index,
    annotator_total: ack.annotator_total,
    start_offset_sec: ack.start_offset_sec,
  };
}

function connectWebSocket() {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN && wsAuthed) {
      resolve();
      return;
    }
    if (!authToken) {
      reject(new Error("Not logged in"));
      return;
    }
    wsAuthed = false;
    wsConnectResolve = resolve;
    ws = new WebSocket(wsUrl());
    ws.onopen = () => {
      send({ type: "auth", token: authToken });
    };
    ws.onerror = () => {
      wsConnectResolve = null;
      reject(new Error("WebSocket connection failed"));
    };
    ws.onmessage = (ev) => handleMessage(JSON.parse(ev.data));
    ws.onclose = () => {
      wsAuthed = false;
      if (roleStatus) roleStatus.textContent = "Disconnected. Refresh the page.";
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
  startApiCountdown(data.duration_sec ?? API_RESPONSE_SEC);

  const index = data.annotator_index ?? 1;
  const total = data.annotator_total ?? 1;
  const offset = data.start_offset_sec ?? 0;
  jobInfo.textContent = `Job active · start ${offset.toFixed(2)}s · ${index}/${total}`;

  showVideoReady();
  video.pause();
  video.src = data.video_url;
  video.load();

  const playFromOffset = async () => {
    hideVideoReady();
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

  const onReady = () => {
    video.removeEventListener("canplay", onReady);
    playFromOffset();
  };

  if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
    await playFromOffset();
  } else {
    video.addEventListener("canplay", onReady, { once: true });
  }
}

function handleAnnotateStart(data) {
  notifyNewAnnotationJob(data);
  goToAnnotatorForJob(data);
}

function handleMessage(data) {
  switch (data.type) {
    case "auth_ok":
      wsAuthed = true;
      if (wsConnectResolve) {
        wsConnectResolve();
        wsConnectResolve = null;
      }
      if (data.user?.is_admin && data.pending_users) {
        renderPendingUsers(data.pending_users);
      }
      break;
    case "auth_error":
    case "auth_required":
      wsAuthed = false;
      if (wsConnectResolve) {
        wsConnectResolve = null;
      }
      break;
    case "signup_pending":
      if (isAdmin) {
        alertAdminSignup(data.user);
        send({ type: "admin_pending" });
      }
      break;
    case "pending_list":
      if (isAdmin) renderPendingUsers(data.users || []);
      break;
    case "user_approved":
    case "user_rejected":
      if (isAdmin) send({ type: "admin_pending" });
      break;
    case "role_ack":
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
      if (role === "annotator") {
        sessionInfo.textContent = `Connected annotators: ${data.count}`;
      }
      break;
    case "annotate_start":
      handleAnnotateStart(data);
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

requestNotificationPermission();

document.getElementById("tab-login")?.addEventListener("click", () => {
  document.getElementById("tab-login").classList.add("active");
  document.getElementById("tab-signup").classList.remove("active");
  loginForm.classList.remove("hidden");
  signupForm.classList.add("hidden");
});

document.getElementById("tab-signup")?.addEventListener("click", () => {
  document.getElementById("tab-signup").classList.add("active");
  document.getElementById("tab-login").classList.remove("active");
  signupForm.classList.remove("hidden");
  loginForm.classList.add("hidden");
});

document.getElementById("btn-show-admin-login")?.addEventListener("click", () => {
  userAuthCard.classList.add("hidden");
  adminLoginCard.classList.remove("hidden");
});

document.getElementById("btn-back-user-auth")?.addEventListener("click", () => {
  adminLoginCard.classList.add("hidden");
  userAuthCard.classList.remove("hidden");
});

loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  authMessage.textContent = "";
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  try {
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Login failed");
    saveAuth(data.token, false);
    showScreen(roleScreen);
  } catch (err) {
    authMessage.textContent = err.message;
  }
});

signupForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  authMessage.textContent = "";
  const username = document.getElementById("signup-username").value.trim();
  const password = document.getElementById("signup-password").value;
  try {
    const res = await apiFetch("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Signup failed");
    authMessage.textContent = data.message || "Signup submitted. Wait for admin approval.";
    signupForm.reset();
  } catch (err) {
    authMessage.textContent = err.message;
  }
});

adminLoginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  adminAuthMessage.textContent = "";
  const username = document.getElementById("admin-username").value.trim();
  const password = document.getElementById("admin-password").value;
  try {
    const res = await apiFetch("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Admin login failed");
    saveAuth(data.token, true);
    await enterAdmin();
  } catch (err) {
    adminAuthMessage.textContent = err.message;
  }
});

document.getElementById("btn-logout")?.addEventListener("click", logout);
document.getElementById("btn-admin-logout")?.addEventListener("click", logout);

(async function initAuth() {
  if (!authToken) {
    showScreen(authScreen);
    return;
  }
  try {
    if (isAdmin) {
      const res = await apiFetch("/api/auth/admin/me");
      if (!res.ok) throw new Error("session expired");
      await enterAdmin();
    } else {
      const res = await apiFetch("/api/auth/me");
      if (!res.ok) throw new Error("session expired");
      showScreen(roleScreen);
    }
  } catch {
    clearAuth();
    showScreen(authScreen);
  }
})();

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
