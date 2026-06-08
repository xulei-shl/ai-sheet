import { createInterface } from 'node:readline';
import type { SidecarCommand, SidecarEvent, BatchStats } from './protocol.js';
import type { BridgeClient } from './bridge.js';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { BatchRunner } from './batch/runner.js';
import type { RowCompleteUpdate } from './batch/progress.js';
import type { TextContent } from '@earendil-works/pi-ai';
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

function emit(event: SidecarEvent) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

async function initialize() {
  if (bridgePort > 0) {
    const { BridgeClient } = await import('./bridge.js');
    bridge = new BridgeClient(bridgePort);
  }

  try {
    const { createSheetAgent } = await import('./agent.js');
    if (bridge) {
      session = await createSheetAgent(bridge);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
    emit({ type: 'agent_error', id: command.id, message: 'Agent 未初始化' });
    return;
  }

  try {
    let accumulatedText = '';

    const unsubscribe = session.subscribe((event) => {
      if (event.type === 'message_update') {
        const msgEvent = (event as any).assistantMessageEvent;
        if (msgEvent?.type === 'text_delta' && msgEvent.delta) {
          accumulatedText += msgEvent.delta;
          emit({ type: 'agent_delta', id: command.id, delta: msgEvent.delta });
        }
      }

      if (event.type === 'tool_execution_start') {
        const ev = event as any;
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
        emit({
          type: 'agent_tool_end',
          id: command.id,
          tool: ev.toolName ?? '',
          result: resultStr,
        });
      }

      if (event.type === 'agent_end') {
        emit({ type: 'agent_done', id: command.id });
      }
    });

    await session.prompt(command.content);
    unsubscribe();

    if (!accumulatedText) {
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

  runner.run({
    filePath: params.filePath,
    sheet: params.sheet,
    inputColumns: params.inputColumns,
    outputColumn: params.outputColumn,
    prompt: params.prompt,
    modelId: params.modelId,
    providerType: params.providerType,
    temperature: params.temperature,
  }).catch((error) => {
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
