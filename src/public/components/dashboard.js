import { state } from "../state.js";
import { escapeHtml, matchFilter } from "./utils.js";

const grid = () => document.getElementById("dashboard-grid");

function countByProtocol(services) {
  let tcp = 0, udp = 0;
  for (const s of services) {
    if (s.protocol === "tcp") tcp++;
    else if (s.protocol === "udp") udp++;
  }
  return { tcp, udp };
}

function countByGroup(services) {
  const groups = new Map();
  for (const s of services) {
    groups.set(s.groupKey, (groups.get(s.groupKey) ?? 0) + 1);
  }
  return groups;
}

function topGroups(services, n = 5) {
  return [...countByGroup(services).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function occupiedPorts(services) {
  return [...new Set(services.map((s) => s.port))].sort((a, b) => a - b);
}

export function renderDashboard(s = state) {
  const services = [...s.services.values()];
  const filtered = services.filter((svc) => matchFilter(svc, s.filter));
  const { tcp, udp } = countByProtocol(services);
  const groups = countByGroup(services);
  const top = topGroups(services);
  const ports = occupiedPorts(services);

  const el = grid();
  el.innerHTML = "";

  // Top stats
  appendCard(el, "Total services", filtered.length, "accent");
  appendCard(el, "TCP", tcp, "");
  appendCard(el, "UDP", udp, "");
  appendCard(el, "Unique apps", groups.size, "");

  // Top apps
  if (top.length > 0) {
    const topCard = document.createElement("div");
    topCard.className = "dash-card";
    topCard.style.gridColumn = "1 / -1";
    topCard.innerHTML = `
      <div class="label">Top apps</div>
      <div class="top-apps" style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px;">
        ${top
          .map(
            ([name, count]) =>
              `<span class="app-pill" style="background: var(--bg-elev-2); padding: 4px 10px; border-radius: 12px; font-size: 12px; font-family: ui-monospace, monospace;">
                ${escapeHtml(name)} <span style="color: var(--accent); font-weight: 600;">${count}</span>
              </span>`
          )
          .join("")}
      </div>
    `;
    el.appendChild(topCard);
  }

  // Occupied ports (clickable chips; click → fill search box)
  if (ports.length > 0) {
    const portsCard = document.createElement("div");
    portsCard.className = "dash-card";
    portsCard.style.gridColumn = "1 / -1";
    portsCard.innerHTML = `
      <div class="label">OCCUPIED PORTS</div>
      <div class="port-chips" style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px;">
        ${ports
          .map(
            (p) =>
              `<button class="btn port-chip" data-port="${p}" type="button">${p}</button>`
          )
          .join("")}
      </div>
    `;
    el.appendChild(portsCard);
  }

  // Empty state
  if (filtered.length === 0 && services.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dash-card";
    empty.style.gridColumn = "1 / -1";
    empty.style.textAlign = "center";
    empty.style.color = "var(--fg-muted)";
    empty.style.padding = "32px";
    empty.textContent = "No services running. Start one to see it here.";
    el.appendChild(empty);
  }
}

export function initDashboard() {
  // Event delegation: single click listener on the grid container
  // (re-renders don't accumulate handlers, matching services.js init pattern).
  const el = grid();
  el.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.classList.contains("port-chip") && t.dataset.port) {
      window.dispatchEvent(
        new CustomEvent("port-search", { detail: { port: t.dataset.port } })
      );
    }
  });
}

function appendCard(parent, label, value, modifier) {
  const card = document.createElement("div");
  card.className = `dash-card ${modifier}`.trim();
  card.innerHTML = `<div class="label">${escapeHtml(label)}</div><div class="value">${value}</div>`;
  parent.appendChild(card);
}
