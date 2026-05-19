async function ensureAuthenticated() {
  try {
    const res = await fetch("/api/auth/status", { credentials: "same-origin" });
    if (!res.ok) {
      window.location.replace("/login");
      return false;
    }
    const data = await res.json();
    if (!data.authenticated) {
      window.location.replace("/login");
      return false;
    }
    return true;
  } catch {
    window.location.replace("/login");
    return false;
  }
}

document.getElementById("btn-logout")?.addEventListener("click", async () => {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    /* ignore */
  }
  window.location.replace("/login");
});

ensureAuthenticated();
