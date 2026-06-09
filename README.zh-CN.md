# localweb

本地端口与开发服务管理面板(macOS / Linux)。

扫描本机 LISTEN 端口,识别开发服务,提供一个浏览器 UI 来:
- 一键在新标签页打开服务
- 杀进程(SIGTERM,可选 SIGKILL 升级)
- 复制服务 URL
- 管理预共享的 dev 服务(启动 / 停止 / 重启)

## 安装

```bash
npm install -g .
```

## 运行

```bash
localweb
```

然后打开 `http://127.0.0.1:7878`(或程序实际选的端口,看控制台输出)。

## 命令行参数

```bash
localweb [--port N] [--no-preshared] [--config PATH]
```

- `--port N` — 首选起始端口(默认 7878;被占用时自动递增)
- `--no-preshared` — 启动时不自动拉起预共享服务
- `--config PATH` — YAML 配置文件路径(默认 `~/.config/localweb/config.yaml`)

## 配置

`~/.config/localweb/config.yaml` 示例:

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

## UI 功能

- **Dashboard:** 页面顶部显示实时统计:服务总数、TCP/UDP 数量、独立 app 数,以及 "Top apps" 标签条。
- **分组:** 同一可执行文件占用的多个端口(例如 `python3 -m http.server` 占了 3 个端口)会自动归到同一张可折叠卡片下,点开看明细。
- **搜索:** 在搜索框输入,按 label、命令、可执行文件路径或端口号过滤。
- **深色/浅色主题:** 右上角点 ☾/☀ 切换。选择会持久化到 localStorage,首次访问会跟随系统偏好。

## 新增 `Service` 字段(v0.2)

| 字段 | 说明 | 示例 |
|---|---|---|
| `exePath` | 可执行文件绝对路径(Linux: `/proc/<pid>/exe`;macOS: `lsof -d txt`) | `/Applications/Spotify.app/Contents/MacOS/Spotify` |
| `startedAt` | 进程启动时的 epoch 毫秒 | `1717862400000` |
| `ppid` | 父进程 ID | `1` |
| `servicePreset` | 匹配内置端口预设(如 5432 → PostgreSQL) | `{ name: "PostgreSQL", icon: "elephant", color: "#336791" }` |
| `groupKey` | 分组标识(默认: exePath 的 basename) | `Spotify` |

这些字段是**增量**的 —— 只读 v0.1 原来 11 个字段的客户端继续可用。

## 内置端口预设(v0.2)

内置约 30 个常见端口的识别:数据库(PostgreSQL、MySQL、Redis、MongoDB 等)、dev server(Vite、Angular、Python http.server)、反向代理、邮件、容器/编排。完整列表见 `src/server/presets.ts`。

## 环境要求

- Node 20+
- macOS 或 Linux(依赖 `lsof` 和 `ps`)
- `python3` 仅在跑集成测试时需要

## 开发

```bash
npm install
npm run build
npm test
npm start
```

前端 `src/public/app.js` 改完直接刷新浏览器,无需编译。

## 故障排查

- **"no free port"** — 7878-7899 全被占。传 `--port 9000` 换一段(可能也要更新 `config.yaml`)。
- **扫描失败** — 确认 `lsof` 在 PATH 里: `which lsof`。
- **杀系统进程权限错** — 用对该进程有权限的用户跑 `localweb`。SIGKILL 仍需进程属主或 root。
- **Windows** — 不支持(没有 `lsof`)。
