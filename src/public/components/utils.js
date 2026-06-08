export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

export function matchFilter(svc, filter) {
  if (svc.protocol === "tcp" && !filter.tcp) return false;
  if (svc.protocol === "udp" && !filter.udp) return false;
  if (filter.search) {
    const haystack = `${svc.label} ${svc.command} ${svc.exePath ?? ""} ${svc.port}`.toLowerCase();
    if (!haystack.includes(filter.search)) return false;
  }
  return true;
}
