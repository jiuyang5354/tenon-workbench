import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { classifyRiskFiles } from '../lib/workspace.mjs';
import { parseReviewVerdict } from '../lib/orchestrator.mjs';
import { sanitizeAgentText } from '../lib/runners.mjs';
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
