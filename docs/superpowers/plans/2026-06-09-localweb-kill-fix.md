# localweb Kill 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 kill 功能(后端 WS `{type:"kill"}` 消息被忽略),kill 确认后自动重新拉取服务列表。

**Architecture:** 抽出共享 `executeKill(hub, getServices, pid)` 函数,被 HTTP `POST /api/kill` 路由和 WS `onClientMessage` 双端复用。前端 `handleKillClick` 在发完 WS kill 消息后追加 `await loadSnapshot()`。

**Tech Stack:** Node 26 + TypeScript 5 + Express 5 + `ws` + Vitest + native HTML/JS (no build)。

**Spec:** `docs/superpowers/specs/2026-06-09-localweb-kill-fix-design.md`

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/server/kill.ts` | **create** | 共享 `executeKill(hub, getServices, pid)` 函数:校验 + term() + 3s escalate 定时器 |
| `src/server/routes/kill.ts` | **modify** | HTTP handler 改为调 `executeKill`,把结果映成 HTTP 响应(400 / 404 / 200) |
| `src/server/index.ts` | **modify** | `WsHub` 的 onClientMessage 新增 `if (msg.type === "kill")` 分支调 `executeKill` |
| `src/public/app.js` | **modify** | `handleKillClick` 在发完 WS 消息后追加 `await loadSnapshot()` |
| `test/integration.test.ts` | **extend** | 新增 `describe("M3 v0.4 WS kill")`:WS 杀真实子进程 + WS 杀已死 pid |

每个文件单一职责。原 M1-M3 行为全部保留(76 个测试 + 1 个新的 HTTP 端点 + 1 个新的 WS 分支)。

---

## Task 1: 后端 — 共享 `executeKill` 函数 + WS handler 接通 (TDD)

**Files:**
- Create: `src/server/kill.ts`
- Modify: `src/server/routes/kill.ts`
- Modify: `src/server/index.ts:67-72` (WsHub onClientMessage callback)
- Modify: `test/integration.test.ts` (新增 describe 块)

### Step 1: 在 `test/integration.test.ts` 末尾追加 WS kill 测试 (会失败)

打开 `test/integration.test.ts`,在文件**最末尾**追加新的 `describe` 块(不要动其他 describe):

```typescript
describe("M3 v0.4 WS kill", () => {
  it("kills a real child process via WS {type:'kill'} message", async () => {
    const port = 19500 + Math.floor(Math.random() * 100);
    const child = spawn("python3", ["-m", "http.server", String(port)], {
      stdio: "ignore",
    });
    await wait(800);

    try {
      // Find pid from API
      const res = await fetch(`http://127.0.0.1:${serverPort}/api/services`);
      const arr = (await res.json()) as Array<{ port: number; pid: number }>;
      const target = arr.find((s) => s.port === port);
      expect(target).toBeDefined();

      // Open WS, send kill, wait for child to exit
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`);
      await new Promise<void>((r) => ws.once("open", r));

      const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (r) => child.on("exit", (code, signal) => r({ code, signal }))
      );
      ws.send(JSON.stringify({ type: "kill", pid: target!.pid }));

      const result = await Promise.race([
        exit,
        wait(5000).then(() => ({ code: -1, signal: null as NodeJS.Signals | null })),
      ]);
      // python http.server has no SIGTERM handler → exits via signal SIGTERM
      expect(result.code).toBeNull();
      expect(result.signal).toBe("SIGTERM");

      ws.close();
    } finally {
      child.kill("SIGKILL");
      await wait(200);
    }
  }, 15000);

  it("WS kill with dead pid does not crash the server", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`);
    await new Promise<void>((r) => ws.once("open", r));
    ws.send(JSON.stringify({ type: "kill", pid: 2_000_000_000 }));
    await wait(500);
    // Server still healthy
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/health`);
    expect(res.ok).toBe(true);
    ws.close();
  }, 10000);
});
```

### Step 2: 构建并跑测试,确认 WS kill 用例**失败** (预期:red)

```bash
npm run build && npm test -- test/integration.test.ts -t "M3 v0.4 WS kill"
```

Expected: 2 个 `M3 v0.4 WS kill` 用例**全部失败**。第一个是因为 WS 消息无人接、进程不死(`result.code` 不是 null);第二个可能会过(因为现在 WS "kill" 消息根本没人处理,所以也不崩),这是允许的,只要第一个**失败**就证明 bug 仍在。

### Step 3: 创建 `src/server/kill.ts` 共享函数

新建 `src/server/kill.ts`:

```typescript
import { term, isAlive } from "./proc.js";
import type { WsHub } from "./ws.js";
import type { Service } from "./types.js";

export type KillResult = { ok: true } | { ok: false; error: string };

/**
 * 共享 kill 逻辑:校验 pid → SIGTERM → 3s 后如还存活广播 escalate 提示。
 *
 * 被 HTTP POST /api/kill (routes/kill.ts) 和 WS onClientMessage (index.ts) 共同调用,
 * 避免在两个端点重复 term/escalate 逻辑。
 *
 * 返回 KillResult 仅供 HTTP 端点映射状态码;WS 端点忽略返回值(失败走静默路径,
 * scanner 2s tick 会自动 reconcile)。
 */
export function executeKill(
  hub: WsHub,
  getServices: () => Service[],
  pid: number
): KillResult {
  if (!Number.isFinite(pid) || pid <= 0) {
    return { ok: false, error: "invalid pid" };
  }
  if (!isAlive(pid)) {
    return { ok: false, error: "pid not found" };
  }
  term(pid);
  // After 3s, if still alive, broadcast escalate prompt
  setTimeout(() => {
    if (isAlive(pid)) {
      const svc = getServices().find((s) => s.pid === pid);
      const port = svc?.port ?? 0;
      hub.broadcast({ type: "kill-escalate", pid, port });
    }
  }, 3000);
  return { ok: true };
}
```

### Step 4: 重构 `src/server/routes/kill.ts` 使用共享函数

把 `src/server/routes/kill.ts` 整个文件替换为:

```typescript
import { Router } from "express";
import { executeKill } from "../kill.js";
import type { WsHub } from "../ws.js";
import type { Service } from "../types.js";

export function killRouter(hub: WsHub, getServices: () => Service[]): Router {
  const r = Router();
  r.post("/api/kill", (req, res) => {
    const pid = Number(req.body?.pid);
    const result = executeKill(hub, getServices, pid);
    if (result.ok) {
      res.json({ ok: true });
      return;
    }
    const status = result.error === "invalid pid" ? 400 : 404;
    res.status(status).json({ error: result.error });
  });
  return r;
}
```

### Step 5: 在 `src/server/index.ts` 的 WsHub onClientMessage 加 "kill" 分支

打开 `src/server/index.ts`,找到 67-72 行的 WsHub 构造:

```typescript
const hub = new WsHub(
  () => ({ type: "snapshot", services: currentServices }),
  (msg) => {
    if (msg.type === "kill-force") procKill(msg.pid);
  }
);
```

把第二个参数(callback)替换为:

```typescript
  (msg) => {
    if (msg.type === "kill") {
      executeKill(hub, () => currentServices, msg.pid);
    } else if (msg.type === "kill-force") {
      procKill(msg.pid);
    }
  }
```

然后在文件顶部的 import 区域(第 17 行附近,已有 `import { kill as procKill } from "./proc.js";`)下方加一行:

```typescript
import { executeKill } from "./kill.js";
```

### Step 6: 跑测试,确认全部通过 (预期:green)

```bash
npm run build && npm test
```

Expected:
- 原来 76 个测试全过
- 新增 2 个 `M3 v0.4 WS kill` 测试全过(WS 杀进程真死 + 杀已死 pid 不崩)
- 总计 78/78

### Step 7: 提交

```bash
git add src/server/kill.ts src/server/routes/kill.ts src/server/index.ts test/integration.test.ts
git commit -m "fix(kill): wire WS {type:'kill'} through shared executeKill, unbreaking kill button"
```

---

## Task 2: 前端 — kill 后自动重拉服务列表

**Files:**
- Modify: `src/public/app.js:77-85` (handleKillClick)

### Step 1: 在 `handleKillClick` 发完 WS 消息后追加 `await loadSnapshot()`

打开 `src/public/app.js`,找到 77-85 行的 `handleKillClick`:

```javascript
async function handleKillClick(pid) {
  const svc = state.services.get(pid);
  if (!svc) return;
  const ok = await confirm(
    "Confirm kill",
    `Terminate ${svc.label} on port ${svc.port} (pid ${svc.pid})?`
  );
  if (ok) ws?.send(JSON.stringify({ type: "kill", pid }));
}
```

替换为:

```javascript
async function handleKillClick(pid) {
  const svc = state.services.get(pid);
  if (!svc) return;
  const ok = await confirm(
    "Confirm kill",
    `Terminate ${svc.label} on port ${svc.port} (pid ${svc.pid})?`
  );
  if (!ok) return;
  ws?.send(JSON.stringify({ type: "kill", pid }));
  await loadSnapshot();
}
```

### Step 2: 构建 (前端是直接拷贝,确保 dist 也更新)

```bash
npm run build
```

Expected: 退出 0。

### Step 3: 提交

```bash
git add src/public/app.js
git commit -m "feat(ui): refresh service list after confirming kill"
```

---

## Task 3: 全量验证 + 手动 E2E

### Step 1: 跑全量测试

```bash
npm test
```

Expected: 78/78 通过。

### Step 2: 跑构建

```bash
npm run build
```

Expected: 退出 0,无 TS 错误。

### Step 3: 启动 dev server

```bash
npm start
```

Expected: 终端打印 `[localweb] listening on http://<host>:<port>`。

### Step 4: 浏览器手动 E2E

1. 打开 `http://127.0.0.1:<port>/` ,确认页面正常
2. 启动一个测试进程(在另一个 terminal): `python3 -m http.server 19999`
3. 等待 ≤3s,服务卡片出现(port 19999)
4. 点击该卡片的 Kill 按钮
5. 弹 confirm 框 → 点 OK
6. 预期:
   - 卡片**立即**消失或变化(网络面板能看到 `GET /api/services` 请求)
   - 终端 `ps -p <pid>` 显示进程已死
7. (可选)试一个**杀不掉**的进程(自己写个小脚本 `trap '' TERM; sleep 60 &`)走 escalate 路径,确认弹 escalate 对话框 + 强杀流程

### Step 5: 关闭 dev server

在 Task 3 启动 dev server 的 terminal 按 Ctrl+C。

### Step 6: 无需提交 (Task 3 自身不产生代码变更)

如果第 1 步或第 2 步失败,回看 Task 1/2 的提交检查问题。

---

## 验收清单 (本 plan 完成后)

- [ ] `npm test` 78/78 通过
- [ ] `npm run build` 干净
- [ ] 浏览器点击 Kill → 进程 ≤3s 内真死
- [ ] 网络面板能看到 `GET /api/services` (loadSnapshot 触发)
- [ ] HTTP `POST /api/kill` 端点行为不变(原 M3 测试通过)
- [ ] WS 杀已死 pid 不崩服务器
