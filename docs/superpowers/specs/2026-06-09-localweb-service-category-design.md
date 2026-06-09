# localweb 进程分类标签 — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorming complete)
**Author:** jimmyhu

---

## 1. Purpose

服务列表里现在所有进程一视同仁,用户难以一眼分辨"哪些是 macOS 系统服务"、"哪些是我自己的 dev 项目"、"哪些是 localweb 自己拉起的"、"哪些是 3rd 方 App"。

本期给每个 service 卡片加一个**分类标签**,用**卡片左边 4px 竖色条**呈现 4 类,优先级 Localweb > Sys > App > Self。

## 2. Goals

- 每张 service 卡片左边显示 4px 分类色条
- 4 个分类:`System`(红) / `Localweb`(灰) / `App`(蓝) / `Self`(绿)
- 分类逻辑后端算好,前端只读 `category` 字段渲染
- WS 推送(snapshot/added/updated)自动带 `category`,前端无需重新拉取
- 现有 96 个测试全部通过 + 新增分类单元测试 11 个

## 3. Non-Goals (本期不做)

- 分类规则让用户可配置(本期写死,后续再说)
- 分类信息进 dashboard "Top apps" 卡片(本期只影响 services 列表卡片)
- 多分类并显(单选,按优先级取最高)
- 自定义颜色 / 用户主题(沿用现 theme 切换)

## 4. 范围

| 方向 | 现状 | 本期变更 |
|---|---|---|
| 后端 Service 类型 | 19 字段(v0.3) | +2 optional:`parentPids?` `category?` |
| 后端 scanner | enrich + procinfo + parentChain | `buildService` 多算 1 个 `parentPids` + 1 个 `category` |
| 后端 index.ts | `localwebPid` 未显式存 | 启动后存 `process.pid`,传给 `Scanner` 构造 |
| 后端新文件 | 无 | `src/server/category.ts` 纯函数 |
| 前端 services.js | 渲染卡片无左边条 | 加 `border-left: 4px solid var(--cat-{cat}-color)` |
| 前端 styles | 4 个 CSS 变量缺失 | 在 `:root` 加 4 个 `--cat-*-color` |

## 5. 模块变更

### 5.1 后端

```
src/server/
├── category.ts           # 新:ServiceCategory 类型 + classifyService 纯函数
├── types.ts              # 改:Service 加 2 字段
├── procinfo.ts           # 改:getParentChain → getParentChainAsync 返回 {names, pids} 平行数组
├── scanner.ts            # 改:buildService 收 localwebPid 参数,返回时填 parentPids + category
└── index.ts              # 改:启动时记 localwebPid,传给 Scanner / buildService
```

### 5.2 前端

```
src/public/
├── components/
│   └── services.js       # 改:渲染卡片时设 border-left by category
└── styles.css (或 theme.js)  # 改:加 4 个 CSS 变量
```

### 5.3 测试

```
test/
├── category.test.ts      # 新:11 个单元测试覆盖 classifyService
└── integration.test.ts   # 扩:2 个新断言(category in /api/services, localweb self-tag)
```

## 6. 数据流

### 6.1 `getParentChainAsync` 改造 (procinfo.ts)

**现状**(v0.3):返 `{names: string[], ...}`,UI 展示时拼成 "launchd → Terminal → zsh"

**改后**:同时返 `pids: number[]`,与 `names` 平行
```typescript
export async function getParentChainAsync(
  pid: number,
  depth: number
): Promise<{ names: string[]; pids: number[] }> { ... }
```

UI 父链行继续用 `names.join(" → ")`,`pids` 仅给后端分类用,不进 WS 推送(但其实也可以进,前端用不到)

### 6.2 `classifyService` (新,纯函数)

```typescript
// src/server/category.ts
export type ServiceCategory = "system" | "localweb" | "self" | "app";

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
  if (exePath && /^(\/System|\/usr\/libexec|\/usr\/sbin|\/Library\/Apple)\//.test(exePath)) {
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

### 6.3 `buildService` 改造 (scanner.ts)

```typescript
export async function buildService(
  rawPort: RawPort,
  localwebPid: number  // 新参数
): Promise<Service> {
  const [det, info, parentChain] = await Promise.all([
    enrich(rawPort, rawPort.cwd),
    readProcInfo(rawPort.pid),
    getParentChainAsync(rawPort.pid, 5),  // 现返 {names, pids}
  ]);
  const base = {
    ...rawPort,
    label: det.label,
    // ... 其他现有字段 ...
    parentPids: parentChain.pids,  // 新增
    category: classifyService(
      rawPort.pid,
      info.exePath,
      parentChain.pids,
      localwebPid
    ),  // 新增
  };
  return { ...base, groupKey: computeGroupKey(base) };
}
```

### 6.4 `index.ts` 缓存 `localwebPid`

```typescript
const localwebPid = process.pid;
// ...
const scanner = new Scanner((next) => { ... }, localwebPid);
```

`Scanner` 构造加 `localwebPid` 参数,`tick` 内部把 `localwebPid` 传给 `buildService`。

### 6.5 前端渲染

```javascript
// src/public/components/services.js
const CAT_COLORS = {
  system: "var(--cat-sys-color, #dc2626)",
  localweb: "var(--cat-localweb-color, #9ca3af)",
  app: "var(--cat-app-color, #3b82f6)",
  self: "var(--cat-self-color, #16a34a)",
};
// 在 createCard / appendChild 前:
el.style.borderLeft = `4px solid ${CAT_COLORS[svc.category ?? "self"]}`;
el.style.paddingLeft = "12px";  // 留 8px 让色条不挤内容
```

## 7. 类型扩展

```typescript
// types.ts:Service 新增 2 字段(全部 optional)
interface Service {
  // ... 现有 19 字段 (v0.1 + v0.2 + v0.3) ...

  // v0.4 additions
  parentPids?: number[];     // 父链 pid 数组,给分类用
  category?: ServiceCategory; // "system" | "localweb" | "self" | "app"
}
```

## 8. UI 设计

### 8.1 服务卡片(新)

```
┌─────────────────────────────────────────────────────────────────────┐
│▌ Node · localweb                              [Open] [Copy] [Kill]   │ ← 主行
│▌ pid 72852 · npm run dev · 127.0.0.1:7878 · started 2h ago           │ ← 副行
│▌ /opt/homebrew/.../node                                              │ ← exePath
│▌ ↑ launchd → Terminal → zsh → npm → node                            │ ← 父链
│▌ Title: "Vite + React - myapp"                                      │ ← httpTitle
└─────────────────────────────────────────────────────────────────────┘
 ↑ 4px 左边色条,色按 category 选:Sys 红 / Localweb 灰 / App 蓝 / Self 绿
```

### 8.2 视觉规则

- 色条:卡片左边 4px,贯穿全卡片高度
- 卡片 padding-left 留 8px 间距避免内容贴色条
- 没有 `category` 字段(老客户端)→ fallback 颜色 = Self 绿
- 4 个 CSS 变量放 `:root`,与现有 theme 变量同模式(后续 dark/light 主题可覆盖)

## 9. 错误处理

| 场景 | 处理 |
|---|---|
| `exePath` undefined(读不到) | 跳过 Sys / App 规则,落 Self |
| `parentPids` undefined | 跳过 Localweb 规则 |
| `localwebPid` 0(理论上不可能) | 跳过 Localweb 规则 |
| pid 既是 localweb 子孙又在 /Applications/ | 返 Localweb(优先级) |
| pid 是 localweb 自身 | 返 Localweb(第一步命中) |
| 同一 pid 多次扫描 | 每次重算,exePath 不变即分类不变 |
| 旧客户端读新 Service | optional 字段被忽略,兼容 |

## 10. 测试策略

### 10.1 单元测试 `test/category.test.ts` (新)

| 用例 | 输入 | 期望 |
|---|---|---|
| 1 | pid === localwebPid | "localweb" |
| 2 | parentPids 含 localwebPid | "localweb" |
| 3 | exePath = "/System/Library/X" | "system" |
| 4 | exePath = "/usr/libexec/rapportd" | "system" |
| 5 | exePath = "/usr/sbin/sshd" | "system" |
| 6 | exePath = "/Applications/Ollama.app/.../ollama" | "app" |
| 7 | exePath = "/opt/homebrew/Cellar/node/.../node" | "self" |
| 8 | exePath = "/Users/jimmyhu/.vscode-server/..." | "self" |
| 9 | exePath = undefined | "self" |
| 10 | localweb + /System/ | "localweb" (优先级) |
| 11 | localweb + /Applications/ | "localweb" (优先级) |

### 10.2 集成测试 `test/integration.test.ts` (扩)

- spawn `python3 -m http.server`,等 scanner 抓到,断言 `category === "self"`
- 查 localweb 自己那个 pid(从 `/api/services` 找 `port: serverPort`),断言 `category === "localweb"`

### 10.3 手工 E2E

dev server 跑起来 + 浏览器:
- 4 类色条都应可见
- `kill` 你之前测的 `19999` Python 进程 → 卡片应消失
- 启一个 `/Applications/...` 下的 3rd 方 App 服务(如果有)→ 蓝色条
- 测一个不存在的 pid 杀 → 不崩(沿用现 M3 v0.4 行为)

## 11. 验收标准

- [ ] `npm test` 全部通过(96 + 11 = 107)
- [ ] `npm run build` 干净
- [ ] 浏览器 4 类色条按预期显示(测 1 个 Sys + 1 个 Self + 1 个 App + localweb 自己)
- [ ] `/api/services` 响应里 `category` 字段存在
- [ ] WS 推送(snapshot/added/updated)自动带 `category`
- [ ] 不再回归:M1/M2/M3/v0.2/v0.3 测试全过

## 12. 风险与权衡

| 风险 | 缓解 |
|---|---|
| `parentChain` 现有 5 层深度限制,可能错过 localweb(理论上不可能,localweb 是根进程之下的浅层) | depth 5 应够,localweb 的子孙树通常 ≤ 5 层;不够的话加 depth |
| `exePath` regex 误判(如 `/usr/libexec` 用户的 homebrew 包) | 已知 macOS 系统路径,误判面极小 |
| 4px 色条 + padding-left 调整可能影响现有卡片的视觉对齐 | 全局变量,只动 1 处;肉眼 E2E 验证 |
| 启动 localweb 自身时 `process.pid` 还没准备好 | Node.js 同步赋值,`process.pid` 在 require 后即就绪 |

## 13. 实施切片

- **M1: 后端 — `category.ts` 新文件 + `classifyService` 单元测试** (TDD: 先写 11 个失败测试,再实现)
- **M2: 后端 — `types.ts` / `procinfo.ts` / `scanner.ts` / `index.ts` 改造,接 `localwebPid`**
- **M3: 前端 — `services.js` 渲染色条 + `styles.css` 加 4 个 CSS 变量**
- **M4: 集成测试 + 全量验证 + 手工 E2E**

每个 M 完成后跑 `npm test` + `npm run build`。
