const banner = document.getElementById("banner");
const list = document.getElementById("services-list");
const emptyState = document.getElementById("empty-state");
const refreshBtn = document.getElementById("refresh-btn");

let services = new Map();
let ws = null;
let reconnectTimer = null;

function showBanner(msg) {
  banner.textContent = msg;
  banner.classList.remove("hidden");
}
function hideBanner() {
  banner.classList.add("hidden");
  banner.textContent = "";
}

function urlFor(svc) {
  const host = svc.address === "0.0.0.0" || svc.address === "::" ? "localhost" : svc.address;
  return `http://${host}:${svc.port}`;
}

function render() {
  list.innerHTML = "";
  const arr = [...services.values()].sort((a, b) => a.port - b.port);
  if (arr.length === 0) {
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");
  for (const svc of arr) {
    const li = document.createElement("li");
    li.className = "service";
    const url = urlFor(svc);
    li.innerHTML = `
      <div>
        <div class="label">${escapeHtml(svc.label)} <span class="confidence-${svc.confidence}">· ${svc.confidence}</span></div>
        <div class="meta">pid ${svc.pid} · ${escapeHtml(svc.command)} · ${escapeHtml(svc.address)}:${svc.port}</div>
      </div>
      <div class="actions">
        <a href="${url}" target="_blank" rel="noopener">Open</a>
      </div>
    `;
    list.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function applySnapshot(arr) {
  services = new Map(arr.map((s) => [s.pid, s]));
  render();
}
function applyAdded(arr) {
  for (const s of arr) services.set(s.pid, s);
  render();
}
function applyRemoved(pids) {
  for (const pid of pids) services.delete(pid);
  render();
}
function applyUpdated(arr) {
  for (const s of arr) services.set(s.pid, s);
  render();
}

async function loadSnapshot() {
  try {
    const res = await fetch("/api/services");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arr = await res.json();
    applySnapshot(arr);
  } catch (err) {
    showBanner(`Failed to load: ${err.message}`);
  }
}

function connectWs() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.addEventListener("open", () => {
    hideBanner();
  });
  ws.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    switch (msg.type) {
      case "snapshot": applySnapshot(msg.services); break;
      case "added": applyAdded(msg.services); break;
      case "removed": applyRemoved(msg.pids); break;
      case "updated": applyUpdated(msg.services); break;
    }
  });
  ws.addEventListener("close", () => {
    showBanner("WebSocket disconnected, retrying...");
    reconnectTimer = setTimeout(connectWs, 3000);
  });
  ws.addEventListener("error", () => {
    ws.close();
  });
}

refreshBtn.addEventListener("click", loadSnapshot);
loadSnapshot().then(connectWs);
