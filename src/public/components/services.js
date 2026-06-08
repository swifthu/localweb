import { state } from "../state.js";
import { escapeHtml, matchFilter } from "./utils.js";

const list = () => document.getElementById("services-list");
const emptyState = () => document.getElementById("empty-state");

function groupBy(services, key) {
  const groups = new Map();
  for (const s of services) {
    const k = key(s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  return groups;
}

function renderServiceCard(svc) {
  const li = document.createElement("li");
  li.className = "service";
  li.dataset.pid = String(svc.pid);
  const host = svc.address === "0.0.0.0" || svc.address === "::" ? "localhost" : svc.address;
  const url = `http://${host}:${svc.port}`;
  const presetBadge = svc.servicePreset
    ? `<span class="preset" style="background:${escapeHtml(svc.servicePreset.color)}22; color:${escapeHtml(svc.servicePreset.color)};">${escapeHtml(svc.servicePreset.name)}</span>`
    : "";
  const startedAgo = svc.startedAt ? formatAgo(svc.startedAt) : "";
  li.innerHTML = `
    <div>
      <div class="label">${escapeHtml(svc.label)} ${presetBadge} <span class="confidence-${svc.confidence}">· ${svc.confidence}</span></div>
      <div class="meta">pid ${svc.pid} · ${escapeHtml(svc.command)} · ${escapeHtml(svc.address)}:${svc.port}${startedAgo ? ` · started ${escapeHtml(startedAgo)}` : ""}</div>
      ${svc.exePath ? `<div class="meta" style="font-size: 11px;">${escapeHtml(svc.exePath)}</div>` : ""}
    </div>
    <div class="actions">
      <a href="${escapeHtml(url)}" target="_blank" rel="noopener">Open</a>
      <button data-action="copy" data-url="${escapeHtml(url)}">Copy URL</button>
      <button data-action="kill" data-pid="${svc.pid}">Kill</button>
    </div>
  `;
  return li;
}

function formatAgo(epoch) {
  const diff = Date.now() - epoch;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function renderGroup(name, services) {
  const li = document.createElement("li");
  li.className = "service-group";
  li.style.cssText = "background: var(--bg-elev-2); border: 1px solid var(--border); border-radius: 8px; padding: 0;";
  li.dataset.groupKey = name;
  const headerId = `group-${name.replace(/[^a-z0-9]/gi, "-")}`;
  li.innerHTML = `
    <details>
      <summary style="padding: 12px 18px; cursor: pointer; display: flex; align-items: center; gap: 12px; user-select: none;">
        <strong style="flex: 1; font-family: ui-monospace, monospace;">${escapeHtml(name)}</strong>
        <span style="color: var(--fg-muted); font-size: 12px;">${services.length} port${services.length === 1 ? "" : "s"}</span>
        <span style="color: var(--fg-muted);">▾</span>
      </summary>
      <ul id="${headerId}" style="list-style: none; padding: 0 12px 12px; margin: 0; display: flex; flex-direction: column; gap: 6px;"></ul>
    </details>
  `;
  const inner = li.querySelector(`#${headerId}`);
  for (const svc of services) inner.appendChild(renderServiceCard(svc));
  return li;
}

function getExpandedGroupKeys() {
  const root = list();
  if (!root) return new Set();
  const result = new Set();
  for (const li of root.querySelectorAll("li.service-group")) {
    const details = li.querySelector("details");
    if (details && details.open) {
      result.add(li.dataset.groupKey);
    }
  }
  return result;
}

export function renderServices(s = state) {
  const el = list();
  const expandedBefore = getExpandedGroupKeys();

  el.innerHTML = "";
  const services = [...s.services.values()].filter((svc) => matchFilter(svc, s.filter));

  if (services.length === 0) {
    emptyState().classList.remove("hidden");
    return;
  }
  emptyState().classList.add("hidden");

  const groups = groupBy(services, (svc) => svc.groupKey);
  const sortedKeys = [...groups.keys()].sort();
  for (const k of sortedKeys) {
    el.appendChild(renderGroup(k, groups.get(k).sort((a, b) => a.port - b.port)));
  }

  // Restore expanded <details> state across WS-tick re-renders
  for (const li of el.querySelectorAll("li.service-group")) {
    if (expandedBefore.has(li.dataset.groupKey)) {
      const details = li.querySelector("details");
      if (details) details.open = true;
    }
  }
}

export function initServices() {
  const root = list();
  if (!root) return;
  root.addEventListener("click", handleClick);
}

function handleClick(ev) {
  const t = ev.target;
  if (!(t instanceof HTMLElement)) return;
  const action = t.dataset.action;
  if (!action) return;
  if (action === "kill" || action === "copy") {
    window.dispatchEvent(
      new CustomEvent("services-action", {
        detail: {
          action,
          pid: Number(t.dataset.pid),
          url: t.dataset.url,
          button: t,
        },
      })
    );
  }
}
