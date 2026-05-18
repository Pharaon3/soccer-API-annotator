async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

document.getElementById("login-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("auth-message");
  msg.textContent = "";

  // if (typeof window.APP_PASSWORD_HASH !== "string") {
  //   msg.textContent = "Configuration not loaded. Refresh the page.";
  //   return;
  // }

  const password = document.getElementById("login-password").value;
  const enteredHash = await hashPassword(password);

  if (enteredHash != "e74fc597d523748f08211da3ea48120f66a3a9e71581dfcbf5ae523366ae8072") {
    msg.textContent = "Invalid password";
    return;
  }

  try {
    const res = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ password_hash: enteredHash }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || "Login failed");
    }
    window.location.href = "/app";
  } catch (err) {
    msg.textContent = err.message || "Login failed";
  }
});
