const banner = document.getElementById("banner");
const list = document.getElementById("services-list");
const emptyState = document.getElementById("empty-state");
const refreshBtn = document.getElementById("refresh-btn");
const dialog = document.getElementById("confirm-dialog");
const dialogTitle = document.getElementById("confirm-title");
const dialogBody = document.getElementById("confirm-body");

let services = new Map();
let ws = null;
let reconnectTimer = null;
let pendingConfirm = null;

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
    li.dataset.pid = String(svc.pid);
    const url = urlFor(svc);
    li.innerHTML = `
      <div>
        <div class="label">${escapeHtml(svc.label)} <span class="confidence-${svc.confidence}">· ${svc.confidence}</span></div>
        <div class="meta">pid ${svc.pid} · ${escapeHtml(svc.command)} · ${escapeHtml(svc.address)}:${svc.port}</div>
      </div>
      <div class="actions">
        <a href="${url}" target="_blank" rel="noopener">Open</a>
        <button data-action="copy" data-url="${url}">Copy URL</button>
        <button data-action="kill" data-pid="${svc.pid}">Kill</button>
      </div>
    `;
    list.appendChild(li);
  }
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

function confirmDialog(title, body) {
  return new Promise((resolve) => {
    if (pendingConfirm) {
      // Dialog is busy; resolve immediately as cancel to avoid orphaning the prior resolver
      resolve(false);
      return;
    }
    dialogTitle.textContent = title;
    dialogBody.textContent = body;
    pendingConfirm = resolve;
    dialog.showModal();
  });
}

dialog.addEventListener("close", () => {
  if (pendingConfirm) {
    const ok = dialog.returnValue === "ok";
    pendingConfirm(ok);
    pendingConfirm = null;
  }
});

list.addEventListener("click", async (ev) => {
  const target = ev.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.action === "copy") {
    const url = target.dataset.url;
    try {
      await navigator.clipboard.writeText(url);
      target.textContent = "Copied!";
      setTimeout(() => (target.textContent = "Copy URL"), 1000);
    } catch (err) {
      showBanner(`Copy failed: ${err.message}`);
    }
  } else if (target.dataset.action === "kill") {
    const pid = Number(target.dataset.pid);
    const svc = services.get(pid);
    if (!svc) return;
    const ok = await confirmDialog(
      "Confirm kill",
      `Terminate ${svc.label} on port ${svc.port} (pid ${svc.pid})?`
    );
    if (ok) ws?.send(JSON.stringify({ type: "kill", pid }));
  }
});

function handleServerMsg(msg) {
  switch (msg.type) {
    case "snapshot": applySnapshot(msg.services); break;
    case "added": applyAdded(msg.services); break;
    case "removed": applyRemoved(msg.pids); break;
    case "updated": applyUpdated(msg.services); break;
    case "kill-escalate": {
      const svc = services.get(msg.pid);
      const port = svc?.port ?? msg.port;
      confirmDialog(
        "Process did not exit",
        `PID ${msg.pid} (port ${port}) is still running. Force kill with SIGKILL?`
      ).then((ok) => {
        if (ok) ws?.send(JSON.stringify({ type: "kill-force", pid: msg.pid }));
      });
      break;
    }
    case "preshared-update":
      preshared.set(msg.service.name, msg.service);
      renderPreshared();
      break;
  }
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
  ws.addEventListener("open", hideBanner);
  ws.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleServerMsg(msg);
  });
  ws.addEventListener("close", () => {
    showBanner("WebSocket disconnected, retrying...");
    reconnectTimer = setTimeout(connectWs, 3000);
  });
  ws.addEventListener("error", () => ws.close());
}

refreshBtn.addEventListener("click", loadSnapshot);
loadSnapshot().then(connectWs);

const filterTcp = document.getElementById("filter-tcp");
const filterUdp = document.getElementById("filter-udp");

async function loadFilter() {
  try {
    const res = await fetch("/api/config");
    const cfg = await res.json();
    filterTcp.checked = !!cfg.protocolFilter.tcp;
    filterUdp.checked = !!cfg.protocolFilter.udp;
  } catch (err) {
    showBanner(`Failed to load config: ${err.message}`);
  }
}

async function saveFilter() {
  try {
    await fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocolFilter: { tcp: filterTcp.checked, udp: filterUdp.checked },
      }),
    });
  } catch (err) {
    showBanner(`Failed to save filter: ${err.message}`);
  }
}

filterTcp.addEventListener("change", saveFilter);
filterUdp.addEventListener("change", saveFilter);
loadFilter();

const presharedList = document.getElementById("preshared-list");
const presharedEmpty = document.getElementById("preshared-empty");
let preshared = new Map();

function renderPreshared() {
  presharedList.innerHTML = "";
  const arr = [...preshared.values()];
  if (arr.length === 0) {
    presharedEmpty.classList.remove("hidden");
    return;
  }
  presharedEmpty.classList.add("hidden");
  for (const s of arr) {
    const li = document.createElement("li");
    li.className = "preshared";
    li.innerHTML = `
      <div>
        <div><strong>${escapeHtml(s.name)}</strong> <span class="status-${s.status}">· ${s.status}</span></div>
        <div class="meta">${escapeHtml(s.cmd)}${s.pid ? ` · pid ${s.pid}` : ""}</div>
      </div>
      <div class="actions">
        <button data-action="preshared-start" data-name="${escapeHtml(s.name)}" ${s.status === "running" ? "disabled" : ""}>Start</button>
        <button data-action="preshared-stop" data-name="${escapeHtml(s.name)}" ${s.status !== "running" ? "disabled" : ""}>Stop</button>
        <button data-action="preshared-restart" data-name="${escapeHtml(s.name)}">Restart</button>
      </div>
    `;
    presharedList.appendChild(li);
  }
}

async function loadPreshared() {
  try {
    const res = await fetch("/api/preshared");
    const arr = await res.json();
    preshared = new Map(arr.map((s) => [s.name, s]));
    renderPreshared();
  } catch (err) {
    showBanner(`Failed to load preshared: ${err.message}`);
  }
}

presharedList.addEventListener("click", async (ev) => {
  const target = ev.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;
  const name = target.dataset.name;
  if (!action || !name) return;
  const path = `/api/preshared/${encodeURIComponent(name)}/${action.replace("preshared-", "")}`;
  try {
    const res = await fetch(path, { method: "POST" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    showBanner(`Action failed: ${err.message}`);
  }
});

loadPreshared();
