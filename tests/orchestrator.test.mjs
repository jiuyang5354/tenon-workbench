import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { classifyRiskFiles } from '../lib/workspace.mjs';
import { parseReviewVerdict, parseProviderRef } from '../lib/orchestrator.mjs';
import { sanitizeAgentText } from '../lib/runners.mjs';
import {
  maskSecret,
  parseArgsTemplate,
  parseOpenAiSseChunk,
  parseAnthropicSseChunk,
  parseGeminiSseChunk,
} from '../lib/providers.mjs';
import { createWorkbenchServer } from '../server.mjs';

test('classifyRiskFiles auto-escalates auth/payment/deploy paths to xhigh', () => {
  const safe = classifyRiskFiles(['public/styles.css', 'src/utils/format.js']);
  assert.equal(safe.highRiskFiles.length, 0);
  assert.equal(safe.recommendedEffort, 'high');

  const risky = classifyRiskFiles([
    'src/components/Button.tsx',
    'src/services/payment-ledger.ts',
    'server/auth/jwt-guard.mjs',
  ]);
  assert.equal(risky.highRiskFiles.length, 2);
  assert.equal(risky.recommendedEffort, 'xhigh');
});

test('parseReviewVerdict uses LAST verdict JSON block and ignores earlier prose JSON', () => {
  const raw = `
接口示例：
\`\`\`json
{"example": true}
\`\`\`

审查完成，发现一处越权风险。
\`\`\`json
{
  "passed": false,
  "summary": "拦截 1 项越权缺陷",
  "blocking": ["[server.mjs:42] 未校验管理员角色即可访问删除接口"],
  "suggestions": ["[server.mjs:88] 建议提取常量"]
}
\`\`\`
`;
  const v = parseReviewVerdict(raw);
  assert.equal(v.passed, false);
  assert.equal(v.blocking.length, 1);
  assert.equal(v.suggestions.length, 1);
  assert.match(v.summary, /越权/);
});

test('parseReviewVerdict fallback does not false-block on prose mentioning "无 [BLOCKING]"', () => {
  const cleanProse = 'VERDICT: PASS\n本次改动无 [BLOCKING] 缺陷，可正常合入。';
  assert.equal(parseReviewVerdict(cleanProse).passed, true);

  const blockRaw = 'VERDICT: BLOCK\n- [BLOCKING] 订单金额浮点精度丢失\n- [SUGGESTION] 变量命名可更清晰';
  const v = parseReviewVerdict(blockRaw);
  assert.equal(v.passed, false);
  assert.equal(v.blocking.length, 1);
  assert.equal(v.suggestions.length, 1);
});

test('sanitizeAgentText removes trailing context usage bars cleanly', () => {
  const text = '核心方案已完成。\n\n---\n📊 **上下文用量**：`约 20k / 1,000,000 Tokens`\n`[█░░░░░░]`';
  assert.equal(sanitizeAgentText(text), '核心方案已完成。');
});

test('HTTP server enforces CSRF, validation status codes (400/403/415), and path traversal guards', async () => {
  const tmpData = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-test-'));
  const { server, store } = await createWorkbenchServer({ dataDir: tmpData });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    // Static SPA
    const htmlRes = await fetch(`${base}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.match(html, /CONDUIT/);

    // Malformed percent-encoding returns 400 (not unhandled URIError)
    const badUri = await fetch(`${base}/%E0%A4%A`);
    assert.equal(badUri.status, 400);

    // Health & Assets APIs
    const healthRes = await fetch(`${base}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(typeof health.agy.installed, 'boolean');

    const assetsRes = await fetch(`${base}/api/assets`);
    assert.equal(assetsRes.status, 200);
    const assets = await assetsRes.json();
    assert.ok(assets.templates['GEMINI.md'].length > 50);

    // CSRF guard rejects cross-site Origin
    const csrfRes = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example.com',
      },
      body: JSON.stringify({ prompt: 'test' }),
    });
    assert.equal(csrfRes.status, 403);

    // Content-Type guard rejects text/plain POST
    const ctRes = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ prompt: 'test' }),
    });
    assert.equal(ctRes.status, 415);

    // Reject disallowed template filename -> 400
    const badTpl = await fetch(`${base}/api/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: '../server.mjs', content: 'hack' }),
    });
    assert.equal(badTpl.status, 400);

    // Empty prompt -> 400 (not 500!)
    const badRun = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '   ' }),
    });
    assert.equal(badRun.status, 400);

    // Seed a run in store and verify PATCH (pin/rename) & DELETE endpoints
    store.create({
      id: 'run_test_1',
      mode: 'plan-only',
      title: 'Initial Title',
      pinned: false,
      workspaceDir: tmpData,
      status: 'completed',
      activeStage: 'done',
      config: { geminiModel: 'gemini-4-neon-high', codexModel: '' },
      metrics: { geminiTokens: 100, codexTokens: 0 },
      events: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const patchRes = await fetch(`${base}/api/runs/run_test_1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed Session', pinned: true }),
    });
    assert.equal(patchRes.status, 200);
    const patched = await patchRes.json();
    assert.equal(patched.run.title, 'Renamed Session');
    assert.equal(patched.run.pinned, true);

    const delRes = await fetch(`${base}/api/runs/run_test_1`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);
    const afterDel = await fetch(`${base}/api/runs/run_test_1`);
    assert.equal(afterDel.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpData, { recursive: true, force: true });
  }
});

test('Provider protocol SSE parsers & CLI template helpers extract text, reasoning and secrets cleanly', () => {
  assert.equal(maskSecret('sk-1234567890abcdef'), 'sk-1••••cdef');
  assert.deepEqual(parseProviderRef('provider:prov_1:deepseek-reasoner'), {
    providerId: 'prov_1',
    model: 'deepseek-reasoner',
  });
  assert.equal(parseProviderRef('gemini-4-neon-high'), null);

  const tpl = parseArgsTemplate('--model "{model}" -p {prompt}', { model: 'sonnet', prompt: 'hello world' });
  assert.equal(tpl.usedPromptPlaceholder, true);
  assert.deepEqual(tpl.args, ['--model', 'sonnet', '-p', 'hello world']);

  const oaiReasoning = parseOpenAiSseChunk(JSON.stringify({
    choices: [{ delta: { reasoning_content: 'Step 1: check auth' } }],
  }));
  assert.equal(oaiReasoning.reasoning, 'Step 1: check auth');
  assert.equal(oaiReasoning.text, '');
  assert.equal(parseOpenAiSseChunk('[DONE]').done, true);

  const anthThink = parseAnthropicSseChunk(JSON.stringify({
    type: 'content_block_delta',
    delta: { type: 'thinking_delta', thinking: 'Checking invariants...' },
  }));
  assert.equal(anthThink.reasoning, 'Checking invariants...');

  const anthText = parseAnthropicSseChunk(JSON.stringify({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: 'Done!' },
  }));
  assert.equal(anthText.text, 'Done!');

  const gemPart = parseGeminiSseChunk(JSON.stringify({
    candidates: [{
      content: {
        parts: [
          { thought: true, text: 'Internal thought' },
          { text: 'Final answer' },
        ],
      },
    }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
  }));
  assert.equal(gemPart.reasoning, 'Internal thought');
  assert.equal(gemPart.text, 'Final answer');
  assert.equal(gemPart.usage.total_tokens, 30);
});

test('Provider Hub API enforces masking, secret preservation, CSRF, and live OpenAI-compatible SSE execution', async () => {
  const tmpData = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-prov-test-'));
  // Spin up a local mock OpenAI-compatible streaming API server
  const mockApi = http.createServer((req, res) => {
    if (req.url === '/v1/models' && req.method === 'GET') {
      assert.equal(req.headers.authorization, 'Bearer sk-secret-99998888');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock-r1' }, { id: 'mock-coder' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      assert.equal(req.headers.authorization, 'Bearer sk-secret-99998888');
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'Analyzing architecture...' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Mock streaming ' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'response OK' } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => mockApi.listen(0, '127.0.0.1', resolve));
  const mockPort = mockApi.address().port;

  const { server } = await createWorkbenchServer({ dataDir: tmpData });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // CSRF rejects cross-origin POST to /api/providers
    const csrfRes = await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
      body: JSON.stringify({ name: 'Bad', kind: 'api', protocol: 'openai-compatible', baseUrl: 'https://api.example.com/v1' }),
    });
    assert.equal(csrfRes.status, 403);

    // Reject non-http(s) URL
    const badUrlRes = await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'BadURL', kind: 'api', protocol: 'openai-compatible', baseUrl: 'file:///etc/passwd' }),
    });
    assert.equal(badUrlRes.status, 400);

    // Create OpenAI-compatible provider pointing at mock local server
    const createRes = await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Mock DeepSeek',
        kind: 'api',
        protocol: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${mockPort}/v1`,
        apiKey: 'sk-secret-99998888',
        defaultModel: 'mock-r1',
      }),
    });
    assert.equal(createRes.status, 200);
    const created = await createRes.json();
    assert.equal(created.provider.hasApiKey, true);
    assert.equal(created.provider.apiKeyMasked, 'sk-s••••8888');
    assert.equal('apiKey' in created.provider, false);

    // Update name with empty apiKey -> secret must be preserved!
    const editRes = await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: created.provider.id,
        name: 'Mock DeepSeek R1',
        apiKey: '',
      }),
    });
    assert.equal(editRes.status, 200);
    const edited = await editRes.json();
    assert.equal(edited.provider.name, 'Mock DeepSeek R1');
    assert.equal(edited.provider.apiKeyMasked, 'sk-s••••8888');

    // Test connectivity & model auto-discovery against mock server
    const testRes = await fetch(`${base}/api/providers/${created.provider.id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(testRes.status, 200);
    const tested = await testRes.json();
    assert.equal(tested.result.ok, true);
    assert.deepEqual(tested.result.discoveredModels, ['mock-r1', 'mock-coder']);

    // Execute live streaming call via POST /api/providers/run
    const runRes = await fetch(`${base}/api/providers/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: created.provider.id,
        model: 'mock-r1',
        prompt: 'Check status',
      }),
    });
    assert.equal(runRes.status, 200);
    const runOut = await runRes.json();
    assert.equal(runOut.ok, true);
    assert.equal(runOut.text, 'Mock streaming response OK');
    assert.equal(runOut.reasoning, 'Analyzing architecture...');

    // Clean delete
    const delRes = await fetch(`${base}/api/providers/${created.provider.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => mockApi.close(resolve));
    await fs.rm(tmpData, { recursive: true, force: true });
  }
});
