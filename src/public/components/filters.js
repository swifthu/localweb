import { applyFilter } from "../state.js";

let filterTcp, filterUdp, searchInput;

export function initFilters() {
  filterTcp = document.getElementById("filter-tcp");
  filterUdp = document.getElementById("filter-udp");
  searchInput = document.getElementById("search-input");

  filterTcp.addEventListener("change", saveFilter);
  filterUdp.addEventListener("change", saveFilter);
  searchInput.addEventListener("input", saveFilter);
}

export async function loadFilter() {
  try {
    const res = await fetch("/api/config");
    const cfg = await res.json();
    filterTcp.checked = !!cfg.protocolFilter.tcp;
    filterUdp.checked = !!cfg.protocolFilter.udp;
  } catch (err) {
    console.error("Failed to load config", err);
  }
}

function saveFilter() {
  const filter = {
    tcp: filterTcp.checked,
    udp: filterUdp.checked,
    search: searchInput.value.trim().toLowerCase(),
  };
  applyFilter(filter);
  // Persist protocol filter to server
  fetch("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      protocolFilter: { tcp: filter.tcp, udp: filter.udp },
    }),
  }).catch((err) => console.error("Failed to save filter", err));
}
