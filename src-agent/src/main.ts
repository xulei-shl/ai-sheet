import { createInterface } from 'node:readline';
import type { SidecarCommand, SidecarEvent, BatchStats, BatchParams } from './protocol.js';
import type { BridgeClient } from './bridge.js';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { BatchRunner } from './batch/runner.js';
import type { RowCompleteUpdate } from './batch/progress.js';
import { runDirectLlmStream, abortDirectLlm } from './direct-llm.js';

const args = parseArgs();
const bridgePort = args.bridgePort;
let bridge: BridgeClient | null = null;
let session: AgentSession | null = null;
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
  // 配置 undici HTTP dispatcher（支持 HTTP_PROXY 环境变量 + 60 秒超时）
  // 注意：必须同时覆盖 globalThis.fetch，因为 OpenAI SDK 使用 globalThis.fetch，
  // 而 Node.js 原生 fetch 不使用 undici 的全局 dispatcher，
  // 导致 bodyTimeout 不生效，SSE 流式传输期间无空闲超时保护。
  const { createRequire } = await import('node:module');
  const undici = createRequire(import.meta.url)('undici');
  const customDispatcher = new undici.EnvHttpProxyAgent({
    allowH2: false,
    bodyTimeout: 300_000,     // 5 分钟（LLM 可能生成很长的回复）
    headersTimeout: 120_000,  // 2 分钟（等待首个响应头）
  });
  undici.setGlobalDispatcher(customDispatcher);

  // 保存原始 fetch，对本地请求使用原始实现
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url: any, init: any) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : String(url);
    // 本地 bridge 请求使用原始 fetch，避免受 SSE 超时设置影响
    if (urlStr.startsWith('http://127.0.0.1') || urlStr.startsWith('http://localhost')) {
      return originalFetch(url, init);
    }
    return undici.fetch(url, { ...init, dispatcher: customDispatcher });
  };
  log('fetch overridden with custom undici dispatcher (bodyTimeout=300s, headersTimeout=120s)');

  if (bridgePort > 0) {
    const { BridgeClient } = await import('./bridge.js');
    bridge = new BridgeClient(bridgePort);
    log('bridge client created');
  }

  try {
    const { createSheetAgent } = await import('./agent.js');
    if (bridge) {
      session = await createSheetAgent(bridge);
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
  } catch {
    // 无默认模型，使用 params 原始值
  }

  runner.run(enrichedParams).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: 'batch_error', batchId, message });
    activeBatches.delete(batchId);
  });
}

async function handleDirectLlmMessage(command: Extract<SidecarCommand, { type: 'direct_llm_message' }>) {
  if (!bridge) {
    emit({ type: 'agent_error', id: command.id, message: 'Bridge 未初始化' });
    return;
  }
  await runDirectLlmStream(bridge, command, emit);
}

async function handleCommand(command: SidecarCommand) {
  switch (command.type) {
    case 'ping':
      emit({ type: 'heartbeat', timestamp: new Date().toISOString() });
      break;
    case 'user_message':
      await handleUserMessage(command);
      break;
    case 'direct_llm_message':
      await handleDirectLlmMessage(command);
      break;
    case 'steer':
      await handleSteer(command);
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
    case 'stop':
      abortDirectLlm();
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
