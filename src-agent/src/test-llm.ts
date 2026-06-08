/**
 * test-llm.ts — 测试当前数据库中配置的所有 LLM 是否可通过 pi agent 正常调用
 *
 * 用法: npx tsx src/test-llm.ts
 *
 * 流程:
 * 1. 从数据库读取所有 models 配置
 * 2. 对每个模型，使用与项目完全相同的方式 (buildModel + stream) 发起调用
 * 3. 输出每个模型的调用结果
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { stream } from '@earendil-works/pi-ai';
import { resolveProviderApi, buildModel } from './provider-map.js';

// ─── 1. 从数据库读取模型配置 ───────────────────────────────

interface DbModel {
  name: string;
  api_key: string;
  base_url: string;
  model_id: string;
  provider_type: string;
  use_proxy: number;
}

interface ActiveModel {
  name: string;
  providerType: string;
  modelId: string;
  apiKey: string;
  baseUrl: string;
  useProxy: boolean;
}

function findDbPath(): string {
  const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  const dbPath = join(appData, 'com.ai-sheet.desktop', 'ai-sheet.db');
  return dbPath;
}

function loadModels(): DbModel[] {
  const dbPath = findDbPath();
  const db = new Database(dbPath, { readonly: true });

  const rows = db.prepare('SELECT name, api_key, base_url, model_id, provider_type, use_proxy FROM models').all() as DbModel[];
  db.close();

  return rows;
}

function loadActiveModel(): ActiveModel | null {
  const dbPath = findDbPath();
  const db = new Database(dbPath, { readonly: true });

  const row = db.prepare("SELECT value FROM settings WHERE key = 'active_model'").get() as { value: string } | undefined;
  db.close();

  if (!row) return null;

  try {
    return JSON.parse(row.value) as ActiveModel;
  } catch {
    return null;
  }
}

// ─── 2. 测试单个模型调用 ──────────────────────────────────

interface TestResult {
  name: string;
  providerType: string;
  modelId: string;
  baseUrl: string;
  success: boolean;
  text: string;
  error: string;
  durationMs: number;
}

async function testModelConfig(info: {
  providerType: string;
  modelId: string;
  name?: string;
  apiKey?: string;
  baseUrl?: string;
  useProxy?: boolean;
}): Promise<TestResult> {
  const start = Date.now();
  const result: TestResult = {
    name: info.name ?? `${info.providerType}/${info.modelId}`,
    providerType: info.providerType,
    modelId: info.modelId,
    baseUrl: info.baseUrl ?? '',
    success: false,
    text: '',
    error: '',
    durationMs: 0,
  };

  if (!info.apiKey) {
    result.error = 'API Key 为空';
    result.durationMs = Date.now() - start;
    return result;
  }

  try {
    // 与项目完全相同的调用方式: buildModel + stream
    const resolved = resolveProviderApi(info.providerType);
    console.log(`    resolved: provider=${resolved.provider}, api=${resolved.api}`);

    const piModel = buildModel(info);
    console.log(`    model obj: id=${piModel.id}, provider=${piModel.provider}, api=${piModel.api}, baseUrl="${piModel.baseUrl}"`);

    const eventStream = stream(
      piModel,
      {
        systemPrompt: '你是一个测试助手。只回复"OK"两个字母，不要回复其他内容。',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: '你好' }],
            timestamp: Date.now(),
          },
        ],
      },
      { temperature: 0, signal: AbortSignal.timeout(30_000), apiKey: info.apiKey },
    );

    let text = '';
    let llmError = '';

    for await (const ev of eventStream as AsyncIterable<any>) {
      if (ev.type === 'text_delta' && ev.delta) {
        text += ev.delta;
      }
      if (ev.type === 'error') {
        llmError = ev.error?.errorMessage ?? '未知错误';
        break;
      }
    }

    result.durationMs = Date.now() - start;

    if (llmError) {
      result.error = llmError;
    } else if (text) {
      result.success = true;
      result.text = text.trim();
    } else {
      result.error = '模型未返回任何文本';
    }
  } catch (err: any) {
    result.durationMs = Date.now() - start;
    result.error = err.message ?? String(err);
  }

  return result;
}

// ─── 3. 主流程 ────────────────────────────────────────────

async function main() {
  console.log('=== PI Agent LLM 调用测试 ===\n');

  const results: TestResult[] = [];

  // 3a. 测试 active_model（sidecar 实际使用的配置）
  const activeModel = loadActiveModel();
  if (activeModel) {
    console.log('--- 当前激活模型 (active_model) ---');
    console.log(`  ${activeModel.name} (${activeModel.providerType}/${activeModel.modelId})`);
    console.log(`  baseUrl="${activeModel.baseUrl}" apiKey=***${activeModel.apiKey?.slice(-4) ?? '(空)'} useProxy=${activeModel.useProxy}`);
    console.log('');

    console.log(`测试: ${activeModel.name} ...`);
    const result = await testModelConfig(activeModel);
    results.push(result);

    const icon = result.success ? '✓' : '✗';
    console.log(`  ${icon} ${result.success ? '成功' : '失败'} (${result.durationMs}ms)`);
    if (result.text) console.log(`  回复: ${result.text}`);
    if (result.error) console.log(`  错误: ${result.error}`);
    console.log('');
  } else {
    console.log('⚠ 没有激活的模型\n');
  }

  // 3b. 测试 models 表中所有模型（使用 active_model 的 API Key 补充）
  const allModels = loadModels();
  if (allModels.length) {
    console.log(`--- 全部 ${allModels.length} 个模型配置 ---\n`);

    for (const m of allModels) {
      const apiKey = m.api_key || activeModel?.apiKey || '';
      const displayKey = apiKey ? `***${apiKey.slice(-4)}` : '(空)';
      console.log(`测试: ${m.name} (${m.provider_type}/${m.model_id}) baseUrl="${m.base_url}" apiKey=${displayKey}`);

      const result = await testModelConfig({
        providerType: m.provider_type,
        modelId: m.model_id,
        name: m.name,
        apiKey,
        baseUrl: m.base_url,
        useProxy: m.use_proxy !== 0,
      });
      results.push(result);

      const icon = result.success ? '✓' : '✗';
      console.log(`  ${icon} ${result.success ? '成功' : '失败'} (${result.durationMs}ms)`);
      if (result.text) console.log(`  回复: ${result.text}`);
      if (result.error) console.log(`  错误: ${result.error}`);
      console.log('');
    }
  }

  // 总结
  console.log('=== 总结 ===\n');
  const passed = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  for (const r of passed) console.log(`✓ ${r.name} (${r.durationMs}ms)`);
  for (const r of failed) console.log(`✗ ${r.name}: ${r.error}`);

  console.log(`\n通过: ${passed.length}/${results.length}`);

  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error('测试脚本异常:', err);
  process.exit(1);
});
