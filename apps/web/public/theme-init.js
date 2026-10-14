// Apply the saved theme before first paint. Light (blue & white) is the default.
try {
  if (localStorage.getItem("fr-theme") === "dark") document.documentElement.classList.add("dark");
} catch (e) {}
