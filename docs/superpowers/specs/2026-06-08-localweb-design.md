# localweb — 本地端口与开发服务管理面板

**Date:** 2026-06-08
**Status:** Approved (brainstorming pass complete)
**Author:** jimmyhu

---

## 1. Purpose

为开发者提供一个本地 Web 面板,扫描本机 LISTEN 状态的端口与对应进程,自动识别 Web 服务身份,支持点击跳转、`kill`、复制 URL、预启动服务等日常操作,替代 `lsof -iTCP` + 手动跳转浏览器的重复劳动。

## 2. Goals (本期)

- 启动后 1 秒内,浏览器面板可见当前本机所有 LISTEN 端口的服务卡片
- 端口新增/退出/字段变更,UI 在 2 秒内反映
- 点服务行 → 浏览器新 tab 打开 `http://localhost:<port>`
- 点 `Kill` → 二次确认 → SIGTERM → 3 秒后可选升级 SIGKILL
- 可配置协议筛选(默认 TCP 全开,UI 勾选)
- 支持用户级 `~/.config/localweb/config.yaml` 预启动服务列表
- 单文件 CLI,`npm i -g` 安装,`localweb` 启动

## 3. Non-Goals (本期不做)

- 不做远程机器端口管理(SSH/Agent)
- 不做日志聚合 / 进程组编排 / 类似 `concurrently` 的依赖启动
- 不做团队共享配置(项目级 `.localwebrc` 暂不支持)
- 不做 macOS 菜单栏原生 UI / Docker 镜像分发
- 不做用户认证 / 多用户隔离
- 不做 React/Vite SPA(本期原生 HTML/JS)
- 不做性能压测 / CI 自动化

## 4. 技术栈(已确认)

| 层 | 选型 | 理由 |
|---|---|---|
| 运行时 | Node 26 + TypeScript | 与开发环境同生态,跨平台 |
| HTTP | Express | 轻、熟、稳 |
| WebSocket | `ws` | 一行起 WS,实时推送 |
| 配置 | `js-yaml` + `~/.config/localweb/config.yaml` | 用户级,无侵入 |
| 端口扫描 | `lsof -nP -iTCP -sTCP:LISTEN` | macOS/Linux 系统自带 |
| 前端 | 原生 HTML + CSS + JS(ES Modules,无构建) | UI 复杂度适中,改即生效 |
| 测试 | Vitest | 快、TS 友好 |

## 5. 项目结构

```
localweb/
├── package.json              # bin: { "localweb": "dist/server/index.js" }
├── tsconfig.json
├── src/
│   ├── server/
│   │   ├── index.ts          # 启动入口
│   │   ├── scanner.ts        # 调 lsof + 解析 + diff
│   │   ├── detector.ts       # 命令行 + HTTP 头识别
│   │   ├── config.ts         # YAML 读写 + 默认值
│   │   ├── preshared.ts      # 预启动服务 spawn 管理
│   │   ├── proc.ts           # kill / term 封装
│   │   ├── port.ts           # findPort(7878) 自动寻空闲
│   │   ├── ws.ts             # WebSocket 广播
│   │   ├── types.ts
│   │   └── routes/
│   │       ├── services.ts
│   │       ├── kill.ts
│   │       ├── copy.ts
│   │       └── preshared.ts
│   └── public/
│       ├── index.html
│       ├── app.js
│       └── style.css
├── test/
│   ├── fixtures/
│   │   └── lsof-output.txt
│   ├── scanner.test.ts
│   ├── detector.test.ts
│   ├── config.test.ts
│   ├── port.test.ts
│   └── integration.test.ts
└── docs/superpowers/specs/
    └── 2026-06-08-localweb-design.md
```

## 6. 架构

**单进程,前后端不分离,无构建步骤**

- 单一 CLI 入口 `localweb` → Node 启动 → 加载配置 → 探测空闲端口 → 起 Express + WebSocket → 后台 Scanner 每 2s 调 `lsof` → diff 后经 WS 推送到浏览器。
- 静态文件 `public/` 由 Express 直接服务。
- 浏览器无构建,改 `app.js` / `style.css` 刷新即生效。

**模块职责边界**

| 模块 | 职责 | 不做什么 |
|---|---|---|
| `scanner.ts` | 端口 → `{ port, pid, command, cwd, user }` | 不识别服务类型,不调业务 |
| `detector.ts` | 命令行 + HTTP 头 → `{ label, confidence }` | 不读 lsof,纯函数,无 IO(可选 HTTP 探测) |
| `proc.ts` | `term(pid)` / `kill(pid)` | 不做确认、不做升级 |
| `preshared.ts` | 启动/停止预定义服务 | 不做日志聚合 |
| `config.ts` | YAML 读写 + 默认值 | 不做校验业务规则 |
| `routes/` | 薄层:HTTP → 调领域模块 | 不放业务逻辑 |
| `ws.ts` | 广播 added/removed/updated/snapshot 事件 | 不管业务含义 |

## 7. 数据流

### 7.1 启动序列

```
localweb CLI
  └─→ server/index.ts
        ├─ config.ts      读 ~/.config/localweb/config.yaml(不存在用默认)
        ├─ port.ts        findPort(7878) 自动寻空闲
        ├─ http.listen()  起 Express
        ├─ ws.Server      挂到 upgrade
        ├─ preshared.ts   按 config 预启动服务(--no-preshared 跳过此步)
        └─ scanner.start()  2s 轮询 lsof
```

配置文件首次不存在时不写入——所有修改走 UI,显式保存才落盘。

### 7.2 扫描主循环

```
scanner.ts 每 2s:
  ├─ exec("lsof -nP -iTCP -sTCP:LISTEN")
  ├─ 解析 → rawPorts[] = { port, pid, command, cwd, user }
  ├─ detector.ts(rawPorts) → services[] = { ..., label, httpHeaders, lastSeen }
  ├─ diff vs 上次快照:
  │     • 新增 → ws.send({ type: "added", services: [...] })
  │     • 消失 → ws.send({ type: "removed", pids: [...] })
  │     • 变更 → ws.send({ type: "updated", services: [...] })
  └─ 缓存新快照
```

**协议筛选作用在 detector 之后、推送之前**——避免切换筛选时漏掉新启动的进程。前端筛选只控 UI 显示,不影响后端推送。

### 7.3 服务识别(`detector.ts`)

每个 service 按以下优先级打 `label`:

1. **进程命令行正则**:`vite` / `next dev` / `python -m http.server` / `rails s` / `go run` 等
2. **HTTP 响应头探测**:`GET http://127.0.0.1:<port>/` 读 `Server` / `X-Powered-By`,1s 超时
3. **兜底**:`process.title` 或 `node` / `python3` / `go`

返回 `{ label, confidence: "high" | "medium" | "low" }`,每条规则独立函数,失败降级不抛。

### 7.4 Kill 流程(二次确认 + 升级)

```
前端: 点 [Kill] → <dialog> "确认终止 127.0.0.1:3000 (node, pid=12345)?"
                      [取消] [确认终止]
前端: 确认 → ws.send({ type: "kill", pid: 12345 })
后端: proc.terminate(pid)
        ├─ kill(pid, "SIGTERM")
        ├─ 等 3s → 若仍存活 → ws.send({ type: "kill-escalate", pid, port })
        └─ 前端弹 "未退出,是否升级为 SIGKILL?" → 确认 → ws.send({ type: "kill-force", pid })
后端: proc.kill(pid, "SIGKILL")
```

**绝不自动升级 SIGKILL**——给用户反悔机会。

### 7.5 预启动服务

`~/.config/localweb/config.yaml` 格式:

```yaml
preshared:
  - name: "前端 dev"
    cmd: "npm run dev"
    cwd: "~/code/myapp"
    env:
      NODE_ENV: "development"
  - name: "后端 API"
    cmd: "go run ./cmd/api"
    cwd: "~/code/myapp-api"
```

`preshared.ts`:
- 启动时按列表 spawn 所有服务,记录 `Map<name, ChildProcess>`
- REST:
  - `GET  /api/preshared` → 列表 + 状态
  - `POST /api/preshared/:name/start`
  - `POST /api/preshared/:name/stop` (SIGTERM)
  - `POST /api/preshared/:name/restart`
- 状态:`{ name, cmd, status: "running"|"stopped"|"failed", pid?, startedAt?, exitCode? }`
- 失败(exit != 0)保留状态,UI 红色标识

`localweb` 退出时,遍历 `Map`,给所有子进程发 SIGTERM,500ms 后 SIGKILL,确保不留僵尸。

## 8. REST + WS API

### 8.1 REST

| Method | Path | Body | 响应 |
|---|---|---|---|
| GET | `/api/services` | — | `Service[]` 全量快照 |
| POST | `/api/kill` | `{ pid: number }` | `{ ok: true }` 或 `404` |
| GET | `/api/preshared` | — | `Preshared[]` |
| POST | `/api/preshared/:name/start` | — | `Preshared` |
| POST | `/api/preshared/:name/stop` | — | `Preshared` |
| POST | `/api/preshared/:name/restart` | — | `Preshared` |
| GET | `/api/config` | — | `Config`(含筛选规则) |
| PUT | `/api/config` | `Config` | `{ ok: true }` |
| GET | `/api/health` | — | `{ ok: true, port: number }` |

### 8.2 WebSocket(`/ws`)

服务端 → 客户端:

```ts
type ServerMsg =
  | { type: "snapshot"; services: Service[] }        // 首次连接 / 重连
  | { type: "added"; services: Service[] }
  | { type: "removed"; pids: number[] }
  | { type: "updated"; services: Service[] }
  | { type: "kill-escalate"; pid: number; port: number }  // 提示用户升级 SIGKILL
  | { type: "preshared-update"; service: Preshared };     // 预启动服务状态变化
```

客户端 → 服务端:

```ts
type ClientMsg =
  | { type: "kill"; pid: number }
  | { type: "kill-force"; pid: number };
```

### 8.3 类型定义

```ts
interface Service {
  pid: number;
  port: number;
  protocol: "tcp" | "udp";
  address: string;             // "127.0.0.1" / "0.0.0.0" / "*"
  command: string;             // 进程命令行
  cwd?: string;                // 进程工作目录
  user: string;                // 运行用户
  label: string;               // "Vite dev server"
  confidence: "high" | "medium" | "low";
  httpHeaders?: Record<string, string>;  // Server / X-Powered-By 等
  lastSeen: number;            // epoch ms
}

interface Preshared {
  name: string;
  cmd: string;
  cwd?: string;
  env?: Record<string, string>;
  status: "running" | "stopped" | "failed";
  pid?: number;
  startedAt?: number;
  exitCode?: number;
}

interface PresharedSpec {
  name: string;
  cmd: string;
  cwd?: string;
  env?: Record<string, string>;
}

interface Config {
  protocolFilter: { tcp: boolean; udp: boolean };
  detectorRules?: { enabled: string[]; disabled: string[] };
  preshared: PresharedSpec[];  // 静态配置(无 status 字段)
  port: { start: number; end: number };  // 工具自身端口范围,默认 7878-7899
}
```

## 9. 错误处理

| 场景 | 处理 |
|---|---|
| `lsof` 执行失败(权限/不存在) | Scanner 记日志,前端顶部横幅 "扫描失败,请检查 lsof 路径" |
| Kill 后 PID 仍存活 | 3s 后弹"未退出,是否升级 SIGKILL?"二次确认 |
| 预启动命令不存在 | 状态置 `failed`,exitCode 展示 |
| 配置文件 YAML 语法错 | 启动时报错并显示错误页,不静默回退默认 |
| WebSocket 断开 | 前端每 3s 自动重连,重连后请求 `snapshot` |
| 工具自身端口被占 | 自动 +1 重试,7899 仍占则报错退出 |
| HTTP 探测超时 | 1s 后放弃,`label` 留兜底值,`confidence: "low"` |

## 10. 测试策略

### 10.1 单元测试(Vitest,`test/`)

| 模块 | 覆盖点 |
|---|---|
| `detector.ts` | 各种命令行 → 正确 label 映射;HTTP 头 → 正确 label;识别失败时返回 `confidence: low` 不崩 |
| `config.ts` | 默认值;YAML 解析;字段缺失不崩;写入原子化(临时文件 + rename) |
| `scanner.ts` | 用 fixture `test/fixtures/lsof-output.txt` 解析;解析失败返回空数组 |
| `port.ts` | 占用时 +1;上限抛错 |
| `routes/` 校验 | 无效 PID 拒绝;返回结构正确 |

### 10.2 集成测试(起真实子进程)

- 起临时实例监听随机端口,`spawn("python3", ["-m", "http.server", "<random>"])`
- 验证:
  - `GET /api/services` 包含该进程
  - WS 连接 → kill → 3s 内收到 `removed`
  - `POST /api/kill` 不存在 PID → 404
  - 预启动配置加载 → spawn → UI 状态 `running` → kill 后 `stopped`

**不 mock**——核心是 OS 交互,mock 测不出真问题。

### 10.3 手工 E2E(发版前跑)

- [ ] 启动 `localweb`,浏览器打开面板
- [ ] 启动 1 个 dev server(Vite/Next),1s 内出现在面板
- [ ] 点击服务行,新 tab 打开
- [ ] 点 [Kill] → 确认 → 3s 内消失
- [ ] 复制 URL → 终端 `curl` 通
- [ ] 配置 1 个预启动服务 → 重启 → 服务自动起
- [ ] 杀掉预启动服务 → UI 状态 `stopped`
- [ ] 关闭 `localweb` → 所有子进程被 SIGTERM 清理(无僵尸)

### 10.4 不做的测试

- 前端单测(原生 JS + 简单 DOM,手工 E2E 已覆盖)
- 性能测试(单用户、几十端口,无瓶颈)
- CI 配置(本地工具,本地跑通即可)

## 11. CLI 行为

```
$ localweb
[localweb] 监听 http://127.0.0.1:7878
[localweb] 已发现 12 个端口,2 个预启动服务已拉起
[localweb] 按 Ctrl+C 退出

$ localweb --port 9000          # 指定起始端口(默认 7878)
$ localweb --no-preshared        # 不自动启动预启动服务
$ localweb --config ~/.config/localweb/other.yaml  # 自定义配置路径
$ localweb --help                # 打印帮助
```

退出: `Ctrl+C` → 给所有子进程 SIGTERM(500ms)→ SIGKILL → 关闭 WS → 关闭 HTTP → exit 0。

## 12. 验收标准(发版门槛)

- [ ] 所有单元测试 + 集成测试通过(`npm test`)
- [ ] TypeScript 严格模式编译无错
- [ ] 手工 E2E 清单 8 项全通过
- [ ] 在 macOS + Linux 各自跑通(本机 macOS,CI 不强求 Linux)
- [ ] README 含安装、使用、配置、故障排查

## 13. 风险与权衡

| 风险 | 缓解 |
|---|---|
| `lsof` 权限不足 | 降级到 `netstat -an` 解析;若仍失败,横幅提示 |
| Windows 兼容(无 `lsof`) | 本期不支持,README 标注 macOS/Linux only |
| WS 推送频次过高 | 2s 轮询 + diff,负载很小;后续可加节流 |
| 误杀关键进程 | SIGTERM 优先 + 二次确认升级 + 二次确认对话框 |
| 配置文件被改坏 | 启动时报错显示行号,不静默回退 |

## 14. 实施优先级(MVP 切片)

1. **M1: 扫描 + 列表展示 + 点击跳转** —— scanner + detector 基础 + 静态 HTML
2. **M2: WS 实时推送** —— 替换轮询为 diff 推送
3. **M3: Kill + 二次确认 + 升级** —— proc.ts + routes/kill + 前端 dialog
4. **M4: 协议筛选** —— config + 前端筛选器
5. **M5: 预启动服务** —— preshared.ts + routes/preshared
6. **M6: 复制 URL + 完善错误处理 + 文档** —— 收尾

每完成一个 M,跑一次手工 E2E,验证上一项不被破坏。

## 15. 开放问题(已锁)

- 端口策略: 默认 7878-7899,自动寻空闲,被占完报错退出 ✅
- UDP 扫描: 默认关闭,UI 可勾选 ✅
- 预启动 cwd 解析: 支持 `~` 展开,绝对路径优先,相对路径相对 `cwd` (即 `process.cwd()`) ✅
- Detector 规则集维护: 内置一套常见规则,后续用户可在配置里启/停具体规则(本期 UI 不做,仅在 config 暴露字段) ✅
