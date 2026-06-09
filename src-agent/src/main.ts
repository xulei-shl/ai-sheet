// 在所有其他模块之前加载 .env，使 HTTP_PROXY/HTTPS_PROXY 环境变量可用
// dist/main.js 向上两级到达项目根目录
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: join(__dirname, '..', '..', '.env'), quiet: true });

import { createInterface } from 'node:readline';
import type { SidecarCommand, SidecarEvent, BatchStats, BatchParams } from './protocol.js';
import type { BridgeClient } from './bridge.js';
import type { AgentSession, ModelRegistry, AuthStorage } from '@earendil-works/pi-coding-agent';
import { BatchRunner } from './batch/runner.js';
import type { RowCompleteUpdate } from './batch/progress.js';
import { getUseProxy, setUseProxy } from './proxy-state.js';
import { buildModel } from './provider-map.js';

const args = parseArgs();
const bridgePort = args.bridgePort;
let bridge: BridgeClient | null = null;
let session: AgentSession | null = null;
let modelRegistry: ModelRegistry | null = null;
let authStorage: AuthStorage | null = null;
let batchRunner: BatchRunner | null = null;
const activeBatches = new Map<string, BatchRunner>();

function parseArgs(): { bridgePort: number } {
  const portIndex = process.argv.indexOf('--bridge-port');
  const bridgePort = portIndex !== -1 ? parseInt(process.argv[portIndex + 1], 10) : 0;
  return { bridgePort };
}

const log = (msg: string) => process.stderr.write(`[sidecar] ${msg}\n`);

function emit(event: SidecarEvent) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

async function initialize() {
  // 配置双 dispatcher：代理（EnvHttpProxyAgent）和直连（Agent）
  const { createRequire } = await import('node:module');
  const undici = createRequire(import.meta.url)('undici');

  const timeoutConfig = {
    allowH2: false,
    bodyTimeout: 600_000,     // 10 分钟（LLM 可能生成很长的回复）
    headersTimeout: 300_000,  // 5 分钟（等待首个响应头，部分模型冷启动很慢）
  };

  // 代理 dispatcher：读取 HTTP_PROXY/HTTPS_PROXY/NO_PROXY 环境变量
  const proxyDispatcher = new undici.EnvHttpProxyAgent(timeoutConfig);

  // 直连 dispatcher：忽略代理环境变量，直接连接
  const directDispatcher = new undici.Agent(timeoutConfig);

  undici.setGlobalDispatcher(proxyDispatcher);

  // 保存原始 fetch，对本地请求使用原始实现
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input: any, init: any) => {
    // 从各种输入类型中提取 URL 字符串和请求属性
    let urlStr: string;
    let fetchInit: Record<string, any> = {};

    if (typeof input === 'string') {
      urlStr = input;
      if (init) fetchInit = { ...init };
    } else if (input instanceof URL) {
      urlStr = input.toString();
      if (init) fetchInit = { ...init };
    } else if (input?.url) {
      // Request 对象 — 提取属性而非直接传递，避免 undici 内部
      // new Request(nativeRequest, init) 因 class 不匹配导致 URL 解析失败
      urlStr = input.url;
      fetchInit = {
        method: input.method,
        headers: input.headers,
        body: input.body,
        signal: input.signal,
        ...init,
      };
      // body 为 ReadableStream 时，Fetch API 要求设置 duplex: 'half'
      // Mistral SDK 在创建 Request 时设置了此选项，但 Request 对象不暴露该属性
      if (fetchInit.body instanceof ReadableStream && !fetchInit.duplex) {
        fetchInit.duplex = 'half';
      }
    } else {
      urlStr = String(input);
      if (init) fetchInit = { ...init };
    }

    // 本地 bridge 请求使用原始 fetch，避免受 SSE 超时设置影响
    if (urlStr.startsWith('http://127.0.0.1') || urlStr.startsWith('http://localhost')) {
      return originalFetch(input, init);
    }

    // 根据当前模型的代理设置选择 dispatcher
    const dispatcher = getUseProxy() ? proxyDispatcher : directDispatcher;
    return undici.fetch(urlStr, { ...fetchInit, dispatcher });
  };
  log('fetch overridden with dual dispatcher (proxy + direct)');

  if (bridgePort > 0) {
    const { BridgeClient } = await import('./bridge.js');
    bridge = new BridgeClient(bridgePort);
    log('bridge client created');
  }

  try {
    const { createSheetAgent } = await import('./agent.js');
    if (bridge) {
      const ctx = await createSheetAgent(bridge);
      session = ctx.session;
      modelRegistry = ctx.modelRegistry;
      authStorage = ctx.authStorage;
      log('agent session created');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`agent init failed: ${message}`);
    emit({ type: 'agent_error', message: `Agent 初始化失败: ${message}` });
  }

  if (bridge) {
    batchRunner = new BatchRunner(bridge);
  }

  emit({ type: 'sidecar_ready' });

  heartbeatInterval = setInterval(() => {
    emit({ type: 'heartbeat', timestamp: new Date().toISOString() });
  }, 5_000).unref();

  emit({ type: 'heartbeat', timestamp: new Date().toISOString() });
}

async function handleUserMessage(command: Extract<SidecarCommand, { type: 'user_message' }>) {
  if (!session) {
    log('handleUserMessage: session is null');
    emit({ type: 'agent_error', id: command.id, message: 'Agent 未初始化' });
    return;
  }

  log(`handleUserMessage: prompt starting, content length=${command.content.length}`);

  try {
    let accumulatedText = '';
    let lastError: string | null = null;
    let eventsReceived = 0;

    const unsubscribe = session.subscribe((event) => {
      eventsReceived++;
      log(`event #${eventsReceived}: type=${event.type}`);

      if (event.type === 'message_update') {
        const msgEvent = (event as any).assistantMessageEvent;
        log(`  message_update: msgEvent.type=${msgEvent?.type}, hasDelta=${!!msgEvent?.delta}`);
        if (msgEvent?.type === 'text_delta' && msgEvent.delta) {
          accumulatedText += msgEvent.delta;
          emit({ type: 'agent_delta', id: command.id, delta: msgEvent.delta });
        }
      }

      if (event.type === 'message_end') {
        const msg = (event as any).message;
        log(`  message_end: role=${msg?.role}, stopReason=${msg?.stopReason}, errorMessage=${msg?.errorMessage}`);
        if (msg?.role === 'assistant') {
          if (msg?.stopReason === 'error' && msg?.errorMessage) {
            lastError = msg.errorMessage;
          } else {
            lastError = null;
          }
        }
      }

      if (event.type === 'tool_execution_start') {
        const ev = event as any;
        log(`  tool_start: tool=${ev.toolName}`);
        emit({
          type: 'agent_tool_start',
          id: command.id,
          tool: ev.toolName ?? '',
          args: ev.args ?? {},
        });
      }

      if (event.type === 'tool_execution_end') {
        const ev = event as any;
        const resultStr = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result ?? '');
        log(`  tool_end: tool=${ev.toolName}`);
        emit({
          type: 'agent_tool_end',
          id: command.id,
          tool: ev.toolName ?? '',
          result: resultStr,
        });
      }
    });

    log('prompt() starting...');
    await session.prompt(command.content);
    log(`prompt() resolved, events=${eventsReceived}, textLen=${accumulatedText.length}, lastError=${lastError}`);
    unsubscribe();

    if (lastError) {
      emit({ type: 'agent_error', id: command.id, message: lastError });
    } else if (!accumulatedText) {
      emit({ type: 'agent_error', id: command.id, message: '模型未返回任何输出，请检查模型ID和API配置是否正确' });
    } else {
      emit({ type: 'agent_done', id: command.id });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: 'agent_error', id: command.id, message });
  }
}

async function handleSteer(command: Extract<SidecarCommand, { type: 'steer' }>) {
  if (!session) {
    emit({ type: 'agent_delta', id: command.id, delta: '上下文已更新（Agent 未初始化）' });
    emit({ type: 'agent_done', id: command.id });
    return;
  }

  try {
    const context = command.context;
    const fileList = (context.loadedFiles ?? [])
      .map((f) => {
        const sheets = f.sheets
          .map((sh) => {
            const cols = sh.columns.map((c) => `${c.letter}(${c.name})`).join(', ');
            return `${sh.sheetName}[${cols}]`;
          })
          .join('; ');
        return `${f.name} (${f.path}) -> ${sheets}`;
      })
      .join(' || ');
    let sampleText = '';
    if (context.sampleDataPreview) {
      sampleText = `\n样例数据:\n${context.sampleDataPreview}`;
    }
    const contextText = `[系统上下文更新] 当前文件：${fileList}${sampleText}`;

    await session.steer(contextText);
    emit({ type: 'agent_delta', id: command.id, delta: '上下文已更新。' });
    emit({ type: 'agent_done', id: command.id });
  } catch (error) {
    emit({ type: 'agent_delta', id: command.id, delta: '上下文已更新。' });
    emit({ type: 'agent_done', id: command.id });
  }
}

async function handleSetModel(command: Extract<SidecarCommand, { type: 'set_model' }>) {
  if (!session || !modelRegistry || !authStorage) {
    emit({ type: 'model_switch_result', id: command.id, success: false, error: 'Agent 未初始化' });
    return;
  }

  const info = command.model;

  try {
    setUseProxy(info.useProxy ?? true);

    const model = buildModel(info);

    if (info.apiKey) {
      modelRegistry.registerProvider(model.provider, {
        api: model.api,
        apiKey: info.apiKey,
        baseUrl: info.baseUrl,
        models: [model],
      } as any);
    }

    await session.setModel(model);

    emit({ type: 'model_switch_result', id: command.id, success: true, modelName: info.name });
    log(`model switched to ${info.name} (${model.provider}/${model.id})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: 'model_switch_result', id: command.id, success: false, error: message });
    log(`model switch failed: ${message}`);
  }
}

async function handleBatchStart(params: Extract<SidecarCommand, { type: 'batch_start' }>['params']) {
  if (!bridge || !batchRunner) {
    emit({ type: 'batch_error', batchId: 'unknown', message: 'Bridge 未初始化' });
    return;
  }

  const batchId = `batch-${Date.now()}`;
  const runner = new BatchRunner(bridge);

  runner.onProgress((progress) => {
    emit({
      type: 'batch_progress',
      batchId: progress.batchId,
      current: progress.current,
      total: progress.total,
      speed: progress.speed,
    });

    if (progress.status === 'completed') {
      emit({
        type: 'batch_done',
        batchId: progress.batchId,
        stats: {
          totalRows: progress.total,
          processedRows: progress.current,
          totalTimeMs: 0,
          avgSpeed: progress.speed,
          successCount: progress.current,
          errorCount: 0,
        } as BatchStats,
      });
      activeBatches.delete(progress.batchId);
    }

    if (progress.status === 'error' && progress.message) {
      emit({ type: 'batch_error', batchId: progress.batchId, message: progress.message });
      activeBatches.delete(progress.batchId);
    }
  });

  runner.onRowComplete((update: RowCompleteUpdate) => {
    emit({
      type: 'batch_row_complete',
      batchId,
      row: update.row,
      result: update.result,
    });
  });

  activeBatches.set(batchId, runner);

  // 从 bridge 获取默认模型配置，补充 apiKey 等信息
  const enrichedParams: BatchParams = { ...params };
  try {
    const defaultModel = await bridge.getDefaultModel();
    if (defaultModel.apiKey) enrichedParams.apiKey = defaultModel.apiKey;
    if (defaultModel.baseUrl) enrichedParams.baseUrl = defaultModel.baseUrl;
    if (!enrichedParams.providerType) enrichedParams.providerType = defaultModel.providerType;
    if (!enrichedParams.modelId) enrichedParams.modelId = defaultModel.modelId;
    if (enrichedParams.useProxy === undefined && defaultModel.useProxy !== undefined) {
      enrichedParams.useProxy = defaultModel.useProxy;
    }
  } catch {
    // 无默认模型，使用 params 原始值
  }

  runner.run(enrichedParams).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: 'batch_error', batchId, message });
    activeBatches.delete(batchId);
  });
}

async function handleReset() {
  if (!session) {
    emit({ type: 'agent_error', message: 'Agent 未初始化' });
    return;
  }
  session.agent.reset();
  session.sessionManager.newSession();
  log('conversation context reset');
}

async function handleCommand(command: SidecarCommand) {
  switch (command.type) {
    case 'ping':
      emit({ type: 'heartbeat', timestamp: new Date().toISOString() });
      break;
    case 'user_message':
      await handleUserMessage(command);
      break;
    case 'steer':
      await handleSteer(command);
      break;
    case 'set_model':
      await handleSetModel(command);
      break;
    case 'batch_start':
      await handleBatchStart(command.params);
      break;
    case 'batch_pause': {
      const r = activeBatches.get(command.batchId);
      if (r) r.pause();
      emit({ type: 'batch_paused', batchId: command.batchId });
      break;
    }
    case 'batch_resume': {
      const r = activeBatches.get(command.batchId);
      if (r) r.resume();
      break;
    }
    case 'batch_stop': {
      const r = activeBatches.get(command.batchId);
      if (r) r.abort();
      activeBatches.delete(command.batchId);
      break;
    }
    case 'batch_status': {
      const r = activeBatches.get(command.batchId);
      break;
    }
    case 'reset':
      await handleReset();
      break;
    case 'stop':
      // 目前 AgentSession 不支持从外部中断，此处为空操作
      break;
  }
}

process.on('uncaughtException', (error) => {
  emit({ type: 'agent_error', message: `未捕获异常: ${error.message}` });
});

process.on('unhandledRejection', (reason) => {
  emit({
    type: 'agent_error',
    message: reason instanceof Error ? reason.message : String(reason),
  });
});

const reader = createInterface({ input: process.stdin });

reader.on('line', (line) => {
  if (!line.trim()) return;
  void (async () => {
    try {
      const command = JSON.parse(line) as SidecarCommand;
      await handleCommand(command);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({ type: 'agent_error', message });
    }
  })();
});

process.stdout.write('');

void initialize();
