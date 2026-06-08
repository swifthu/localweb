// Central state + simple pub-sub
const listeners = new Set();

export const state = {
  services: new Map(), // pid → Service
  preshared: new Map(), // name → Preshared
  filter: { tcp: true, udp: false, search: "" },
  theme: "dark",
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) fn(state);
}

export function applySnapshot(arr) {
  state.services = new Map(arr.map((s) => [s.pid, s]));
  notify();
}
export function applyAdded(arr) {
  for (const s of arr) state.services.set(s.pid, s);
  notify();
}
export function applyRemoved(pids) {
  for (const pid of pids) state.services.delete(pid);
  notify();
}
export function applyUpdated(arr) {
  for (const s of arr) state.services.set(s.pid, s);
  notify();
}
export function applyPresharedSnapshot(arr) {
  state.preshared = new Map(arr.map((s) => [s.name, s]));
  notify();
}
export function applyPresharedUpdate(svc) {
  state.preshared.set(svc.name, svc);
  notify();
}
export function applyFilter(filter) {
  state.filter = filter;
  notify();
}
