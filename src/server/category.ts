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
