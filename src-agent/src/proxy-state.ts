/**
 * proxy-state.ts — 每模型代理开关的运行时状态
 *
 * 维护一个进程级变量，由各 LLM 调用入口在发起请求前同步。
 * main.ts 的 fetch override 读取此状态决定使用哪个 dispatcher。
 */

let currentUseProxy = true;

/** 当前是否启用代理（true = 走 EnvHttpProxyAgent，false = 直连） */
export function getUseProxy(): boolean {
  return currentUseProxy;
}

/** 在发起 LLM 请求前，由调用方根据模型的 useProxy 设置同步 */
export function setUseProxy(value: boolean): void {
  currentUseProxy = value;
}
