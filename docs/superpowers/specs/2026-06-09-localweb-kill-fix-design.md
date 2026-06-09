# localweb Kill 修复 + 自动刷新 — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorming complete)
**Author:** jimmyhu

---

## 1. Purpose

修复 kill 功能不能正常运行的 bug,并在 kill 后自动重新拉取服务列表。

**当前 bug**:
- 前端 ([src/public/app.js:77-85](src/public/app.js#L77-L85)) 点击 Kill → confirm → 发 WS `{type:"kill", pid}`
- 后端 ([src/server/index.ts:67-72](src/server/index.ts#L67-L72)) `WsHub` 的 onClientMessage **只处理 `kill-force`,不处理 `kill`**
- HTTP `POST /api/kill` 路由存在但前端从未调用
- 结果:用户点击 Kill 后**静默失败,进程还在**

**修复目标**:
- WS kill 消息真正生效(SIGTERM,3s 后 escalate,再 SIGKILL)
- 复用现有 kill 逻辑(不重复代码)
- kill 确认后立即重新拉取服务列表(用户预期)
- 集成测试覆盖 WS 路径,确保不再回归

## 2. Goals

- 点击 Kill 按钮后,目标进程在 ≤3s 内(SIGTERM)或 ≤6s 内(SIGTERM+SIGKILL)被实际杀死
- 现有 76 个测试全部通过
- 新增 1-2 个集成测试覆盖 WS kill 路径
- HTTP `POST /api/kill` 端点行为不变(继续工作,供外部工具使用)
- 默认路径(SIGTERM 一次成功):目标进程在 ≤3s 内被实际杀死
- Escalate 路径(SIGTERM 失败 + 用户点确认):额外 ≤3s 内被 SIGKILL 杀死

## 3. Non-Goals (本期不做)

- 删掉 HTTP `/api/kill` 端点(可能外部脚本在用,YAGNI)
- 改 kill 弹窗 UI(沿用现有 confirm dialog)
- 改 escalate 弹窗逻辑(沿用现有 3s escalate)
- 加"成功提示"toast(沿用 banner)
- 加键盘快捷键(超出范围)

## 4. 范围

| 方向 | 现状 | 本期变更 |
|---|---|---|
| 后端 `killRouter` | HTTP POST `/api/kill` 可用,前端未调 | 抽 `executeKill()` 共享函数,router 改为调它 |
| 后端 `WsHub` onClientMessage | 只处理 `kill-force` | 新增 `kill` 分支,调 `executeKill()` |
| 前端 `handleKillClick` | 发 WS `{type:"kill"}`,无后续 | 发完消息后 `await loadSnapshot()` |
| 集成测试 | M3 只覆盖 HTTP kill | 加 WS kill 测试 + 真实进程验证 |

## 5. 模块变更

### 5.1 后端

```
src/server/
├── kill.ts              # 新文件:executeKill(hub, getServices, pid) 共享函数
├── routes/
│   └── kill.ts          # 改:HTTP handler 改为调用 executeKill,把结果映成 HTTP 响应
└── index.ts             # 改:WsHub onClientMessage 新增 if (msg.type === "kill") 分支
```

### 5.2 前端

```
src/public/
└── app.js               # 改:handleKillClick 发完 WS 后追加 await loadSnapshot()
```

### 5.3 测试

```
test/
└── integration.test.ts  # 扩:新增 describe("M3 v0.4 WS kill", ...) 覆盖 WS 路径
```

## 6. 数据流

### 6.1 后端:共享 `executeKill` 函数

```typescript
// src/server/kill.ts (新文件)
import { term, isAlive } from "./proc.js";
import type { WsHub } from "./ws.js";
import type { Service } from "./types.js";

export type KillResult = { ok: true } | { ok: false; error: string };

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

// Note: WS 端点调用时忽略返回值,只关心是否成功启用了 term()。
//   - HTTP 端点需要返回值映射状态码
//   - WS 端点:失败(pid 非法/不存在)走静默路径,前端会通过 scanner 2s tick
//     自动 reconcile;不阻塞其他 client
```

### 6.2 修复后的 kill 流程

```
[click kill] → confirm → ① ws.send({type:"kill", pid})
                       → ② await loadSnapshot()           ← 新增
                                                  ↓
后端 WsHub onClientMessage:
  if (msg.type === "kill") executeKill(hub, getServices, msg.pid)
                                                  ↓
executeKill(): 校验 → term() → 启 3s escalate timer
                                                  ↓
3s 后如还存活 → hub.broadcast({type:"kill-escalate", pid, port})
                                                  ↓
前端 handleKillEscalate → confirm → ws.send({type:"kill-force", pid})
                                                  ↓
后端 if (msg.type === "kill-force") procKill(msg.pid)   ← 已有逻辑
```

### 6.3 HTTP `/api/kill` 行为不变

```typescript
// src/server/routes/kill.ts 改后
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
```

### 6.4 前端 `handleKillClick` 改后

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
  await loadSnapshot();   // ← 新增:立刻重新拉取
}
```

## 7. 类型

无新类型。`ClientMsg` ([src/server/types.ts:68-69](src/server/types.ts#L68-L69)) 已包含 `{type:"kill", pid:number}`,无需扩展。

## 8. UI 行为

无新 UI。沿用现有:
- confirm dialog 确认 kill
- confirm dialog 确认 escalate
- banner 显示错误

## 9. 错误处理

| 场景 | 处理 |
|---|---|
| pid 非法 (≤0 / NaN) | HTTP 端点返 400,WS 端点忽略(前端不会发非法 pid) |
| pid 不存在 | HTTP 端点返 404,WS 端点忽略(前端会发但不影响其他 client) |
| term 后 3s 仍存活 | 走 escalate,前端弹窗,等用户决定 |
| 用户拒绝 escalate | 静默,不杀 |
| 用户接受 escalate | 发 kill-force,后端 SIGKILL |
| WS 连接断开 | banner 提示重连,前端按钮不可点(沿用现状) |

## 10. 测试策略

### 10.1 集成测试 (扩 [test/integration.test.ts](test/integration.test.ts))

新增 `describe("M3 v0.4 WS kill", ...)`:

1. **WS 杀真实子进程**:
   - spawn `python3 -m http.server PORT`
   - 等 800ms,查 `/api/services` 找到 pid
   - 连 WS,发 `{type:"kill", pid}`,等 `child.on("exit")` 触发
   - 断言 `code === null && signal === "SIGTERM"`
   - 关闭 WS

2. **WS 杀已死的 pid**(模拟前端误发):
   - 发 `{type:"kill", pid: 2_000_000_000}`
   - 不期望任何反馈,也不应让后端崩
   - 等 500ms,服务仍正常响应(`/api/health`)

### 10.2 手工 E2E

启动 dev server,在浏览器:
1. 找一个服务,点击 Kill → 确认
2. **预期**:该服务卡片**立刻**(在 200ms 内)消失或变化(因 loadSnapshot 重新拉取)
3. **预期**:进程在 ≤3s 内真正死掉(`ps -p <pid>` 消失)

## 11. 验收标准

- [ ] `npm test` 全部通过(76 个 + 新增 1-2 个)
- [ ] `npm run build` 干净
- [ ] WS `{type:"kill", pid}` 真正杀死目标进程(默认 SIGTERM ≤3s)
- [ ] HTTP `POST /api/kill` 行为不变(原 M3 测试仍通过)
- [ ] 前端点击 Kill 后,网络面板能看到 `GET /api/services` 请求
- [ ] 不再回归:之前能用 HTTP 杀进程,现在还能用

## 12. 风险与权衡

| 风险 | 缓解 |
|---|---|
| `loadSnapshot()` 和 scanner 2s tick 的"removed" 推送冲突(短时间两次更新同一 pid) | applyRemoved / applySnapshot 都是幂等的,无害 |
| WS 端点调 `executeKill` 后,return 里的 KillResult 没人用,纯浪费 | 接受,代码可读性 > 零开销 |
| 抽 `executeKill` 让 HTTP 端点代码略冗长(多一次函数调用) | 接受,DRY > 微优化 |
| 抽出的 executeKill 在两个地方被 import,跨文件依赖 | 接受,这是合理的模块边界 |

## 13. 实施切片

- **M1: 后端共享函数 + WS 路由接通** —— 新 `src/server/kill.ts`,改 `routes/kill.ts`,改 `index.ts` onClientMessage
- **M2: 前端自动刷新** —— `handleKillClick` 追加 `await loadSnapshot()`
- **M3: 测试** —— 扩 `integration.test.ts` 加 WS kill 用例
- **M4: 手工 E2E 验证** —— dev server + 浏览器

每个 M 完成后跑 `npm test` + `npm run build`。
