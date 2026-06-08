const banner = document.getElementById("banner");
const list = document.getElementById("services-list");
const emptyState = document.getElementById("empty-state");
const refreshBtn = document.getElementById("refresh-btn");

let services = new Map(); // pid → Service

function showBanner(msg) {
  banner.textContent = msg;
  banner.classList.remove("hidden");
}
function hideBanner() {
  banner.classList.add("hidden");
  banner.textContent = "";
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
    const url = `http://${svc.address === "0.0.0.0" ? "localhost" : svc.address}:${svc.port}`;
    li.innerHTML = `
      <div>
        <div class="label">${escapeHtml(svc.label)} <span class="confidence-${svc.confidence}">· ${svc.confidence}</span></div>
        <div class="meta">${svc.pid} · ${escapeHtml(svc.command)} · ${escapeHtml(svc.address)}:${svc.port}</div>
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

async function load() {
  try {
    hideBanner();
    const res = await fetch("/api/services");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arr = await res.json();
    services = new Map(arr.map((s) => [s.pid, s]));
    render();
  } catch (err) {
    showBanner(`Failed to load: ${err.message}`);
  }
}

refreshBtn.addEventListener("click", load);
load();
