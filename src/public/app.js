import { initThemeToggle, detectInitialTheme } from "./components/theme.js";
import { initDialog, confirm } from "./components/dialog.js";
import { initFilters, loadFilter } from "./components/filters.js";
import { initPreshared, loadPreshared, applyPresharedUpdate } from "./components/preshared.js";
import {
  state,
  applySnapshot,
  applyAdded,
  applyRemoved,
  applyUpdated,
  applyPresharedSnapshot,
  applyFilter,
  subscribe,
} from "./state.js";
import { renderDashboard } from "./components/dashboard.js";
import { renderServices } from "./components/services.js";

const banner = document.getElementById("banner");
let ws = null;
let reconnectTimer = null;

function showBanner(msg) {
  banner.textContent = msg;
  banner.classList.remove("hidden");
}
function hideBanner() {
  banner.classList.add("hidden");
}

async function loadSnapshot() {
  try {
    const res = await fetch("/api/services");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    applySnapshot(await res.json());
    const presharedRes = await fetch("/api/preshared");
    applyPresharedSnapshot(await presharedRes.json());
  } catch (err) {
    showBanner(`Failed to load: ${err.message}`);
  }
}

function connectWs() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.addEventListener("open", hideBanner);
  ws.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    switch (msg.type) {
      case "snapshot": applySnapshot(msg.services); break;
      case "added": applyAdded(msg.services); break;
      case "removed": applyRemoved(msg.pids); break;
      case "updated": applyUpdated(msg.services); break;
      case "preshared-update": applyPresharedUpdate(msg.service); break;
      case "kill-escalate": handleKillEscalate(msg); break;
    }
  });
  ws.addEventListener("close", () => {
    showBanner("WebSocket disconnected, retrying...");
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWs, 3000);
  });
  ws.addEventListener("error", () => ws.close());
}

async function handleKillEscalate(msg) {
  const svc = state.services.get(msg.pid);
  const port = svc?.port ?? msg.port;
  const ok = await confirm(
    "Process did not exit",
    `PID ${msg.pid} (port ${port}) is still running. Force kill with SIGKILL?`
  );
  if (ok) ws?.send(JSON.stringify({ type: "kill-force", pid: msg.pid }));
}

async function handleKillClick(pid) {
  const svc = state.services.get(pid);
  if (!svc) return;
  const ok = await confirm(
    "Confirm kill",
    `Terminate ${svc.label} on port ${svc.port} (pid ${svc.pid})?`
  );
  if (ok) ws?.send(JSON.stringify({ type: "kill", pid }));
}

async function handleCopyClick(url, button) {
  try {
    await navigator.clipboard.writeText(url);
    button.textContent = "Copied!";
    setTimeout(() => (button.textContent = "Copy URL"), 1000);
  } catch (err) {
    showBanner(`Copy failed: ${err.message}`);
  }
}

// Wire up click delegation on the services list (set up by services.js)
window.addEventListener("services-action", async (ev) => {
  const { action, pid, url } = ev.detail;
  if (action === "kill") await handleKillClick(pid);
  else if (action === "copy") await handleCopyClick(url, ev.detail.button);
});

// Initial render wiring
subscribe((s) => {
  renderDashboard(s);
  renderServices(s);
});

// Bootstrap
initThemeToggle(document.getElementById("theme-toggle"));
initDialog();
initFilters();
initPreshared();
loadFilter();
loadSnapshot().then(connectWs);

// Periodic status check
setInterval(async () => {
  try {
    const res = await fetch("/api/status");
    const s = await res.json();
    if (s.lastScanError) showBanner(`Scan error: ${s.lastScanError}`);
  } catch {}
}, 5000);
