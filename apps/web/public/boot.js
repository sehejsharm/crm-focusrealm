// Runs before the app's code has downloaded. Kept tiny and dependency-free.

// 1. Apply the saved theme before first paint. Light (blue & white) is the default.
try {
  if (localStorage.getItem("fr-theme") === "dark") document.documentElement.classList.add("dark");
} catch (e) {}

// 2. Start the "who is signed in?" request now, so the answer is usually
//    waiting by the time the app starts. The app picks it up from here once
//    (see lib/auth.tsx) and falls back to asking itself if anything is off.
try {
  window.__frEarlyMe = fetch("/api/auth/me", { credentials: "include" })
    .then(function (r) {
      if (r.status === 401) return { user: null };
      return r.ok ? r.json() : undefined;
    })
    .catch(function () {
      return undefined;
    });
} catch (e) {}
