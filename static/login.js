async function redirectIfAlreadyLoggedIn() {
  try {
    const res = await fetch("/api/auth/status", { credentials: "same-origin" });
    if (!res.ok) return;
    const data = await res.json();
    if (data.authenticated) {
      window.location.replace("/");
    }
  } catch {
    /* stay on login */
  }
}

const loginForm = document.getElementById("login-form");
const loginBtn = loginForm?.querySelector('button[type="submit"]');
const loginUserId = document.getElementById("login-user-id");
const loginPassword = document.getElementById("login-password");

loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("auth-message");
  msg.textContent = "";
  msg.classList.remove("auth-error");

  const user_id = loginUserId?.value.trim().toLowerCase() ?? "";
  const password = loginPassword?.value.toLowerCase() ?? "";
  if (!user_id || !password) return;

  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.textContent = "Signing in…";
  }

  console.log("[login] POST /api/auth/login", { user_id, password_len: password.length });

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ user_id, password }),
    });
    const data = await res.json().catch(() => ({}));
    console.log("[login] response", res.status, data);
    if (!res.ok) {
      throw new Error(data.detail || "Login failed");
    }
    console.log("[login] success, redirecting to /");
    window.location.replace("/");
  } catch (err) {
    msg.textContent = err.message || "Login failed";
    msg.classList.add("auth-error");
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.textContent = "Log in";
    }
  }
});

redirectIfAlreadyLoggedIn();
loginUserId?.focus();
