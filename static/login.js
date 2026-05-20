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

  const user_id = loginUserId?.value.trim() ?? "";
  const password = loginPassword?.value ?? "";
  if (!user_id || !password) return;

  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.textContent = "Signing in…";
  }

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ user_id, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || "Login failed");
    }
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
