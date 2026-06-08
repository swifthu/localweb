import { escapeHtml } from "./utils.js";

let presharedList, presharedEmpty;
let preshared = new Map();

export function initPreshared() {
  presharedList = document.getElementById("preshared-list");
  presharedEmpty = document.getElementById("preshared-empty");
  presharedList.addEventListener("click", async (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const action = t.dataset.action;
    const name = t.dataset.name;
    if (!action || !name) return;
    const verb = action.replace("preshared-", "");
    const path = `/api/preshared/${encodeURIComponent(name)}/${verb}`;
    try {
      const res = await fetch(path, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error("preshared action failed", err);
    }
  });
}

export async function loadPreshared() {
  try {
    const res = await fetch("/api/preshared");
    const arr = await res.json();
    preshared = new Map(arr.map((s) => [s.name, s]));
    render();
  } catch (err) {
    console.error("Failed to load preshared", err);
  }
}

export function applyUpdate(service) {
  preshared.set(service.name, service);
  render();
}

function render() {
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
        <div class="meta">${escapeHtml(s.cmd)}${s.pid ? ` · pid ${s.pid}` : ""}${s.lastError ? ` · ${escapeHtml(s.lastError)}` : ""}</div>
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
