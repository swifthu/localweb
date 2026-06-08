const STORAGE_KEY = "localweb-theme";

export function detectInitialTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

export function toggleTheme() {
  const current = document.documentElement.dataset.theme || "dark";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem(STORAGE_KEY, next);
  return next;
}

export function initThemeToggle(button) {
  applyTheme(detectInitialTheme());
  button.addEventListener("click", () => {
    const next = toggleTheme();
    button.setAttribute("aria-label", `Switch to ${next === "dark" ? "light" : "dark"} theme`);
    button.textContent = next === "dark" ? "☾" : "☀";
  });
}
