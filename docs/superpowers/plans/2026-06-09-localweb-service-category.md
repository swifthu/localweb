# localweb 服务分类标签 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给服务卡片左边加 4px 分类色条,4 类:`System` 红 / `Localweb` 灰 / `App` 蓝 / `Self` 绿,优先级 `Localweb > Sys > App > Self`。

**Architecture:** 后端 `classifyService(pid, exePath, parentPids, localwebPid)` 纯函数算分类,`Scanner.buildService` 在 enrichment pipeline 末尾调它,字段通过现有 WS 推送下发到前端;前端 `services.js` 渲染时按 `category` 设 `border-left: 4px solid var(--cat-{cat}-color)`,4 个颜色走 CSS 变量。

**Tech Stack:** Node 26 + TypeScript 5 + Express 5 + `ws` + Vitest + native HTML/JS (no build for frontend)。

**Spec:** `docs/superpowers/specs/2026-06-09-localweb-service-category-design.md`

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/server/category.ts` | **create** | `ServiceCategory` 类型 + `classifyService()` 纯函数 |
| `src/server/types.ts` | **modify** | `Service` 加 2 optional 字段:`parentPids?` `category?` |
| `src/server/procinfo.ts` | **modify** | `getParentChainAsync` 返回 `{names, pids}` 平行数组 |
| `src/server/scanner.ts` | **modify** | `buildService` 收 `localwebPid` 参数,填 `parentPids` + `category` |
| `src/server/index.ts` | **modify** | 启动时存 `localwebPid = process.pid`,传给 `Scanner` 构造 |
| `src/public/components/services.js` | **modify** | 渲染色条;加 fallback 颜色 |
| `src/public/components/theme.js` 或全局 CSS | **modify** | 加 4 个 `--cat-*-color` 变量 |
| `test/category.test.ts` | **create** | 11 个单元测试覆盖 `classifyService` |
| `test/procinfo.test.ts` | **extend** | 验证 `getParentChainAsync` 新返回形状 |
| `test/integration.test.ts` | **extend** | 2 个新断言:spawn python → `category === "self"`;localweb 自己 → `category === "localweb"` |

每个文件单一职责。原 v0.1 / v0.2 / v0.3 行为全部保留(96 个现有测试 + 1 个新 HTTP 端点 + 1 个新 WS 分支不变,本次只加字段和分类)。

---

# Task 1: 后端 — `classifyService` 纯函数 (TDD)

**Files:**
- Create: `src/server/category.ts`
- Create: `test/category.test.ts`

### Step 1: 写 11 个失败测试

新建 `test/category.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifyService } from "../src/server/category.js";

const LOCALWEB_PID = 72852;

describe("classifyService", () => {
  it("returns 'localweb' when pid === localwebPid", () => {
    expect(
      classifyService(LOCALWEB_PID, "/opt/homebrew/bin/node", [1, 2], LOCALWEB_PID)
    ).toBe("localweb");
  });

  it("returns 'localweb' when parentPids contains localwebPid", () => {
    expect(
      classifyService(100, "/opt/homebrew/bin/node", [LOCALWEB_PID, 1, 2], LOCALWEB_PID)
    ).toBe("localweb");
  });

  it("returns 'system' for /System/", () => {
    expect(
      classifyService(1, "/System/Library/X", [], LOCALWEB_PID)
    ).toBe("system");
  });

  it("returns 'system' for /usr/libexec/", () => {
    expect(
      classifyService(1, "/usr/libexec/rapportd", [], LOCALWEB_PID)
    ).toBe("system");
  });

  it("returns 'system' for /usr/sbin/", () => {
    expect(
      classifyService(1, "/usr/sbin/sshd", [], LOCALWEB_PID)
    ).toBe("system");
  });

  it("returns 'app' for /Applications/*.app/...", () => {
    expect(
      classifyService(
        1,
        "/Applications/Ollama.app/Contents/Resources/ollama",
        [],
        LOCALWEB_PID
      )
    ).toBe("app");
  });

  it("returns 'self' for /opt/homebrew/...", () => {
    expect(
      classifyService(
        1,
        "/opt/homebrew/Cellar/node/26.0.0/bin/node",
        [],
        LOCALWEB_PID
      )
    ).toBe("self");
  });

  it("returns 'self' for /Users/<user>/...", () => {
    expect(
      classifyService(
        1,
        "/Users/jimmyhu/.vscode-server/cli/servers/.../node",
        [],
        LOCALWEB_PID
      )
    ).toBe("self");
  });

  it("returns 'self' when exePath is undefined", () => {
    expect(classifyService(1, undefined, [], LOCALWEB_PID)).toBe("self");
  });

  it("localweb wins over system path", () => {
    expect(
      classifyService(LOCALWEB_PID, "/System/X", [LOCALWEB_PID], LOCALWEB_PID)
    ).toBe("localweb");
  });

  it("localweb wins over /Applications/", () => {
    expect(
      classifyService(
        LOCALWEB_PID,
        "/Applications/Foo.app/Contents/MacOS/foo",
        [LOCALWEB_PID],
        LOCALWEB_PID
      )
    ).toBe("localweb");
  });
});
```

### Step 2: 跑测试,确认 11 个全失败

```bash
npm test -- test/category.test.ts
```

Expected: 全部失败(`classifyService` 不存在,模块找不到)。

### Step 3: 实现 `classifyService`

新建 `src/server/category.ts`:

```typescript
export type ServiceCategory = "system" | "localweb" | "self" | "app";

/**
 * 4 分类,优先级 Localweb > System > App > Self:
 * - Localweb: pid === localwebPid 或 parentPids 含 localwebPid(进程树子孙)
 * - System:   exePath 匹配 /System | /usr/libexec | /usr/sbin | /Library/Apple
 * - App:      exePath 在 /Applications/*.app bundle 内
 * - Self:     兜底
 *
 * 纯函数,所有 undefined 输入不抛异常。
 */
export function classifyService(
  pid: number,
  exePath: string | undefined,
  parentPids: number[] | undefined,
  localwebPid: number
): ServiceCategory {
  // 1. Localweb
  if (pid === localwebPid) return "localweb";
  if (parentPids && parentPids.includes(localwebPid)) return "localweb";

  // 2. System
  if (
    exePath &&
    /^(\/System|\/usr\/libexec|\/usr\/sbin|\/Library\/Apple)\//.test(exePath)
  ) {
    return "system";
  }

  // 3. App
  if (exePath && /^\/Applications\/[^/]+\.app\//.test(exePath)) {
    return "app";
  }

  // 4. Self
  return "self";
}
```

### Step 4: 跑测试,确认 11 个全过

```bash
npm test -- test/category.test.ts
```

Expected: 11 passed (11)。

### Step 5: 提交

```bash
git add src/server/category.ts test/category.test.ts
git commit -m "feat(category): add classifyService pure function with 11 unit tests"
```

---

# Task 2: 后端 — `getParentChainAsync` 返 {names, pids}

**Files:**
- Modify: `src/server/procinfo.ts`
- Extend: `test/procinfo.test.ts`

### Step 1: 找到现有 `getParentChainAsync` 的返值形状

打开 `src/server/procinfo.ts`,找到 `getParentChainAsync`。v0.3 现状是返 `{names: string[], ...}`,需要改成同时返 `pids: number[]`。

(实现细节:在递归 readCommand 父进程时,同时把 ppid 收集成平行数组。读不到的不放进 names 也不放进 pids,保持 1:1 对应。)

### Step 2: 改 `getParentChainAsync` 返回形状

修改 `src/server/procinfo.ts` 中 `getParentChainAsync` 函数,**只改返值形状**,实现细节(递归、深度限制、cycle detection)不动。

假设 v0.3 当前返 `{names: string[]}`,改成:

```typescript
export async function getParentChainAsync(
  pid: number,
  depth: number
): Promise<{ names: string[]; pids: number[] }> {
  // ... 递归逻辑保持不变 ...
  // 收集 names 和 pids 时保持 1:1 对应
  return { names, pids };
}
```

具体递归改法:每层同时读 `(name, ppid)`,append `{name, ppid}` 到结果数组,最后 `names = result.map(r => r.name)`,`pids = result.map(r => r.ppid)`。

(注意:`getParentChain`(同步版)如果也存在,本期**不动**,只在用 `getParentChainAsync` 那里返新形状。)

### Step 3: 检查 `test/procinfo.test.ts` 现存断言

跑一下确认现有测试不被新形状打破:

```bash
npm test -- test/procinfo.test.ts
```

Expected: 10 个测试全过(测试只检查 `.names` 或 `.toString()`,不查整体对象形状)。

如果有测试检查 `result === [...]` 那种,改成 `result.names === [...]` 即可。

### Step 4: 提交

```bash
git add src/server/procinfo.ts test/procinfo.test.ts
git commit -m "feat(procinfo): getParentChainAsync returns {names, pids} parallel arrays"
```

---

# Task 3: 后端 — `Service` 扩字段 + `buildService` 集成 + `index.ts` 传 `localwebPid`

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/scanner.ts`
- Modify: `src/server/index.ts`

### Step 1: `Service` 加 2 字段

打开 `src/server/types.ts`,在 `Service` interface 末尾(现有 v0.3 字段 `httpTitle` 之后)加:

```typescript
  // v0.4 additions
  parentPids?: number[];
  category?: ServiceCategory;  // "system" | "localweb" | "self" | "app"
```

然后在文件顶部 import 区域加 `import type { ServiceCategory } from "./category.js";`

(注意 `import type` 是 type-only import,会被 tsc 擦掉,无运行时影响。)

### Step 2: 改 `Scanner` 构造签名

打开 `src/server/scanner.ts`,找到 `Scanner` class 构造和 `tick()`。

构造签名改成:

```typescript
export class Scanner {
  private prev: Service[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private onUpdate: (services: Service[]) => void,
    private localwebPid: number,    // 新增
    private intervalMs = 2000
  ) {}

  // ...
}
```

`tick` 内部 `buildService` 调用改成传 `localwebPid`:

```typescript
  private async tick(): Promise<void> {
    const raw = await runLsof();
    const services: Service[] = await Promise.all(
      raw.map((r) => buildService(r, this.localwebPid))  // ← 多传一个参数
    );
    // ... 其余不动
  }
```

`buildService` 签名改成:

```typescript
export async function buildService(
  rawPort: RawPort,
  localwebPid: number
): Promise<Service> {
  const [det, info, parentChain] = await Promise.all([
    enrich(rawPort, rawPort.cwd),
    readProcInfo(rawPort.pid),
    getParentChainAsync(rawPort.pid, 5),  // 现在返 {names, pids}
  ]);
  const base = {
    ...rawPort,
    label: det.label,
    confidence: det.confidence,
    httpHeaders: det.httpHeaders,
    projectName: det.projectName,
    httpTitle: det.httpTitle,
    lastSeen: Date.now(),
    exePath: info.exePath,
    startedAt: info.startedAt,
    ppid: info.ppid,
    parentChain: parentChain.names,  // ← 改成 .names
    parentPids: parentChain.pids,     // ← 新增
    category: classifyService(         // ← 新增
      rawPort.pid,
      info.exePath,
      parentChain.pids,
      localwebPid
    ),
    servicePreset: lookup(rawPort.port) ?? undefined,
  };
  return { ...base, groupKey: computeGroupKey(base) };
}
```

顶部 import 加 `import { classifyService } from "./category.js";`

### Step 3: 改 `src/server/index.ts` 存 `localwebPid` 传给 Scanner

打开 `src/server/index.ts`,在 `main()` 函数中、`Scanner` 构造之前加一行:

```typescript
  const localwebPid = process.pid;
```

然后找 `const scanner = new Scanner(...)` 改成:

```typescript
  const scanner = new Scanner((next) => {
    // ... callback body 不动
  }, localwebPid);
```

(`new Scanner(onUpdate, localwebPid)` — 第二参数就是新加的。)

### Step 4: 构建确认编译干净

```bash
npm run build
```

Expected: 退出 0,无 TS 错误。

### Step 5: 跑测试,确认现有 96 + Task 1 加的 11 = 107 全过

```bash
npm test
```

Expected: 107 passed (现有 96 + 新增 11)。**注意**:这次只是加了 `category` 字段到 Service,没有 integration test 验证 `category === "self"`,所以不需要改 integration test。

### Step 6: 提交

```bash
git add src/server/types.ts src/server/scanner.ts src/server/index.ts
git commit -m "feat(category): integrate classifyService into buildService pipeline"
```

---

# Task 4: 前端 — 渲染色条 + 4 个 CSS 变量

**Files:**
- Modify: `src/public/components/services.js`
- Modify: `src/public/components/theme.js` (或全局 CSS,看实际项目)

### Step 1: 找到渲染服务卡片的入口

打开 `src/public/components/services.js`,找到创建卡片元素的函数(应该是 `renderServices` 或类似),找到 `appendChild` / `innerHTML` 之前,看到 `document.createElement("div")` 创建卡片容器的那一行。

### Step 2: 在卡片容器上设 border-left

在那行 `createElement` 之后,加:

```javascript
const card = document.createElement("div");
card.className = "service-card";  // 假设已有,无则用现有 class 名
const CAT_COLORS = {
  system: "var(--cat-sys-color, #dc2626)",
  localweb: "var(--cat-localweb-color, #9ca3af)",
  app: "var(--cat-app-color, #3b82f6)",
  self: "var(--cat-self-color, #16a34a)",
};
card.style.borderLeft = `4px solid ${CAT_COLORS[svc.category ?? "self"]}`;
card.style.paddingLeft = "12px";  // 留 8px 让色条不挤内容
// ... 后续 innerHTML / appendChild 不变
```

(注意:`CAT_COLORS` 如果在文件顶部已定义,直接复用;否则在本函数顶部加 const。)

### Step 3: 加 4 个 CSS 变量

打开 [src/public/components/theme.js](src/public/components/theme.js) — 这是项目已有 theme 切换模块。

找到 `applyTheme()` 函数(应在 toggle 时被调),在 light / dark 各自的 `:root` 变量集里加 4 个:

```javascript
// 在 light 主题对象里:
{
  // ... 现有变量 ...
  "--cat-sys-color": "#dc2626",
  "--cat-localweb-color": "#9ca3af",
  "--cat-app-color": "#3b82f6",
  "--cat-self-color": "#16a34a",
}

// 在 dark 主题对象里(颜色可以微调以适应深色背景,如稍微亮一点):
{
  // ... 现有变量 ...
  "--cat-sys-color": "#f87171",      // 浅红
  "--cat-localweb-color": "#d1d5db", // 浅灰
  "--cat-app-color": "#60a5fa",      // 浅蓝
  "--cat-self-color": "#4ade80",     // 浅绿
}
```

(如果 `theme.js` 不是用对象设 CSS 变量,而是直接操作 document.documentElement.style,同样思路在该位置加 4 个属性。)

### Step 4: 构建 (复制 public 到 dist)

```bash
npm run build
```

Expected: 退出 0。

### Step 5: 提交

```bash
git add src/public/components/services.js src/public/components/theme.js
git commit -m "feat(ui): render category color bar on service cards"
```

---

# Task 5: 集成测试 + 全量验证 + 手动 E2E

**Files:**
- Modify: `test/integration.test.ts` (扩 2 个测试)

### Step 1: 在 `test/integration.test.ts` 末尾加 2 个新 it (在 `M3 v0.4 WS kill` describe 之外,作为新 describe 块)

打开 `test/integration.test.ts`,在文件**最末尾**追加:

```typescript
describe("M4 v0.4 service category", () => {
  it("spawned python process has category 'self'", async () => {
    const port = 20600 + Math.floor(Math.random() * 100);
    const child = spawn("python3", ["-m", "http.server", String(port)], {
      stdio: "ignore",
    });
    try {
      await wait(5000);
      const res = await fetch(`http://127.0.0.1:${serverPort}/api/services`);
      const arr = (await res.json()) as Array<{ port: number; category?: string }>;
      const svc = arr.find((s) => s.port === port);
      expect(svc).toBeDefined();
      // python3 from homebrew is at /opt/homebrew/.../python3.14 → matches 'self' regex
      expect(svc!.category).toBe("self");
    } finally {
      child.kill("SIGKILL");
      await wait(200);
    }
  }, 15000);

  it("localweb process itself has category 'localweb'", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/services`);
    const arr = (await res.json()) as Array<{ port: number; category?: string }>;
    const me = arr.find((s) => s.port === serverPort);
    expect(me).toBeDefined();
    expect(me!.category).toBe("localweb");
  }, 10000);
});
```

### Step 2: 跑测试,确认 2 个新测试 + 原 107 全过

```bash
npm test
```

Expected: 109 passed (96 + 11 Task 1 + 2 Task 5 = 109)。

### Step 3: 跑构建

```bash
npm run build
```

Expected: 退出 0。

### Step 4: 重启 dev server(如果之前还在跑)

```bash
# 找到之前 dev server 进程并停掉
pkill -INT -f "dist/server/index.js" 2>/dev/null
sleep 1
# 重新启动
npm start
```

Expected: `[localweb] listening on http://<host>:<port>`,端口是 7878(默认)。

### Step 5: 浏览器手动 E2E

1. 打开 `http://127.0.0.1:7878/`
2. **预期 4 类色条都应可见**:
   - 至少 1 个红色 Sys(rapportd / ControlCe / sshd)
   - 至少 1 个灰色 Localweb(localweb 自己的 7878 端口)
   - 至少 1 个蓝色 App(随便一个 /Applications/ 下的服务,如 Ollama)
   - 至少 1 个绿色 Self(你测的 19999 Python / 任意 homebrew 下的服务)
3. 验证色条是 4px 宽、贯穿卡片高度
4. 验证 dark/light 主题切换时色条颜色也跟着变
5. 杀一个 Self(绿)服务 → 卡片立即消失(沿用 Task 2 v0.4 行为)

### Step 6: 关闭 dev server

`pkill -INT -f "dist/server/index.js"` 或 Ctrl+C。

### Step 7: 无 commit (Task 5 主要是测试和验证)

如果 Step 2 或 Step 3 失败,回看 Task 1-4 的提交检查。

---

## 验收清单 (本 plan 完成后)

- [ ] `npm test` 109/109 通过
- [ ] `npm run build` 干净
- [ ] 浏览器 4 类色条都可见
- [ ] `/api/services` 响应里 `category` 字段存在
- [ ] WS 推送(snapshot/added/updated)自动带 `category`
- [ ] dark/light 主题切换时色条颜色跟随
- [ ] 不再回归:96 个原测试 + M3 v0.4 WS kill 都过
