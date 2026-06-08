# localweb

Local port and dev-service management panel for macOS/Linux.

Scans LISTEN ports on your machine, identifies dev services, and gives you a browser UI to:
- Click-to-open any service in a new tab
- Kill processes (SIGTERM, with optional SIGKILL escalation)
- Copy service URLs
- Manage pre-shared dev services (start/stop/restart)

## Install

```bash
npm install -g .
```

## Run

```bash
localweb
```

Then open `http://127.0.0.1:7878` (or whatever port it picks — see console output).

## CLI

```bash
localweb [--port N] [--no-preshared] [--config PATH]
```

- `--port N` — preferred starting port (default 7878; auto-increments if busy)
- `--no-preshared` — don't auto-spawn pre-shared services on startup
- `--config PATH` — path to YAML config (default `~/.config/localweb/config.yaml`)

## Config

Example `~/.config/localweb/config.yaml`:

```yaml
protocolFilter:
  tcp: true
  udp: false
preshared:
  - name: frontend
    cmd: npm run dev
    cwd: ~/code/myapp
    env:
      NODE_ENV: development
  - name: backend
    cmd: go run ./cmd/api
    cwd: ~/code/myapp-api
port:
  start: 7878
  end: 7899
```

## UI Features

- **Dashboard:** Top of the page shows live stats: total services, TCP/UDP count, unique apps, and a "Top apps" pill bar.
- **Grouping:** Multiple ports from the same executable (e.g. `python3 -m http.server` on 3 ports) are automatically grouped under a single collapsible card. Click to expand.
- **Search:** Type in the search box to filter by label, command, exe path, or port number.
- **Dark/Light theme:** Click the ☾/☀ button in the top-right. Choice is persisted to localStorage and respects your system preference on first visit.

## New `Service` fields (v0.2)

| Field | Description | Example |
|---|---|---|
| `exePath` | Absolute path to the executable (Linux: `/proc/<pid>/exe`; macOS: `lsof -d txt`) | `/Applications/Spotify.app/Contents/MacOS/Spotify` |
| `startedAt` | Epoch ms when the process started | `1717862400000` |
| `ppid` | Parent process ID | `1` |
| `servicePreset` | Match against built-in port presets (e.g. 5432 → PostgreSQL) | `{ name: "PostgreSQL", icon: "elephant", color: "#336791" }` |
| `groupKey` | Group identifier (default: basename of exePath) | `Spotify` |

These fields are additive — v0.1 clients that only read the 11 original fields keep working.

## Built-in port presets (v0.2)

About 30 common ports are recognized: databases (PostgreSQL, MySQL, Redis, MongoDB, etc.), dev servers (Vite, Angular, Python http.server), proxies, mail, container/orchestration. See `src/server/presets.ts` for the full list.

## Requirements

- Node 20+
- macOS or Linux (uses `lsof` and `ps`)
- `python3` only needed for the integration tests

## Development

```bash
npm install
npm run build
npm test
npm start
```

Edit `src/public/app.js` and refresh the browser — no build step for the frontend.

## Troubleshooting

- **"no free port"** — all ports 7878-7899 are taken. Pass `--port 9000` to use a different range (you may also need to update `config.yaml`).
- **Scan failures** — make sure `lsof` is on your PATH: `which lsof`.
- **Permission errors killing system processes** — run `localweb` as a user with permission over the target process. SIGKILL still requires ownership or root.
- **Windows** — not supported (no `lsof`).
