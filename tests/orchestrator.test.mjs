import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { classifyRiskFiles, discoverWorkspaces, createWorkspaceProject } from '../lib/workspace.mjs';

const execFileAsync = promisify(execFile);
import { parseReviewVerdict, parseProviderRef } from '../lib/orchestrator.mjs';
import { sanitizeAgentText } from '../lib/runners.mjs';
import {
  maskSecret,
  parseArgsTemplate,
  parseOpenAiSseChunk,
  parseAnthropicSseChunk,
  parseGeminiSseChunk,
} from '../lib/providers.mjs';
import {
  compareSemver,
  isAllowedDownloadUrl,
  selectPlatformAsset,
} from '../lib/updater.mjs';
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
    // Static SPA & TENON brand assets
    const htmlRes = await fetch(`${base}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.match(html, /TENON/);

    const favRes = await fetch(`${base}/favicon.ico`);
    assert.equal(favRes.status, 200);
    const manifestRes = await fetch(`${base}/site.webmanifest`);
    assert.equal(manifestRes.status, 200);
    assert.match(manifestRes.headers.get('content-type') || '', /manifest\+json/);

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

test('Updater compares SemVer, enforces GitHub SSRF allowlist, and checks mock GitHub Releases API', async () => {
  assert.equal(compareSemver('1.2.0', '1.0.0'), 1);
  assert.equal(compareSemver('v1.0.0', '1.0.0'), 0);
  assert.equal(compareSemver('1.0.0', '1.0.0-beta.1'), 1);
  assert.equal(compareSemver('0.9.9', '1.0.0'), -1);

  assert.equal(
    isAllowedDownloadUrl('https://github.com/jiuyang5354/tenon-workbench/releases/download/v1.1.0/TENON-Setup-1.1.0.exe'),
    true
  );
  assert.equal(isAllowedDownloadUrl('https://evil.example.com/malware.exe'), false);
  assert.equal(isAllowedDownloadUrl('http://github.com/jiuyang5354/tenon-workbench/releases/download/v1.1.0/a.exe'), false);

  const picked = selectPlatformAsset(
    [{ name: 'TENON-1.1.0.dmg' }, { name: 'TENON-Setup-1.1.0.exe', size: 12345 }],
    'win32'
  );
  assert.equal(picked?.name, 'TENON-Setup-1.1.0.exe');

  const tmpData = await fs.mkdtemp(path.join(os.tmpdir(), 'conduit-upd-test-'));
  const mockGh = http.createServer((req, res) => {
    if (req.url === '/repos/jiuyang5354/tenon-workbench/releases/latest') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        tag_name: 'v1.2.0',
        name: 'TENON v1.2.0',
        body: '## Highlights\n- New multi-agent routing',
        published_at: '2026-11-24T12:00:00Z',
        html_url: 'https://github.com/jiuyang5354/tenon-workbench/releases/tag/v1.2.0',
        assets: [
          {
            name: 'TENON-Setup-1.2.0.exe',
            size: 88_000_000,
            browser_download_url: 'https://github.com/jiuyang5354/tenon-workbench/releases/download/v1.2.0/TENON-Setup-1.2.0.exe',
          },
        ],
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => mockGh.listen(0, '127.0.0.1', resolve));
  const ghPort = mockGh.address().port;

  const { server } = await createWorkbenchServer({
    dataDir: tmpData,
    appVersion: '1.0.0',
    updateApiBase: `http://127.0.0.1:${ghPort}`,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const infoRes = await fetch(`${base}/api/update/info`);
    assert.equal(infoRes.status, 200);
    const info = await infoRes.json();
    assert.equal(info.currentVersion, '1.0.0');

    const checkRes = await fetch(`${base}/api/update/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(checkRes.status, 200);
    const checked = await checkRes.json();
    assert.equal(checked.ok, true);
    assert.equal(checked.hasUpdate, true);
    assert.equal(checked.latestVersion, '1.2.0');
    assert.equal(checked.assetName, 'TENON-Setup-1.2.0.exe');

    // Reject SSRF download URL -> 400
    const badDl = await fetch(`${base}/api/update/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadUrl: 'https://evil.example.com/fake.exe' }),
    });
    assert.equal(badDl.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => mockGh.close(resolve));
    await fs.rm(tmpData, { recursive: true, force: true });
  }
});

test('discoverWorkspaces detects Codex, Claude, TENON & Git repos and exposes workspace APIs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tenon-ws-disc-'));
  const fakeHome = path.join(root, 'home');
  const fakeTmp = path.join(root, 'ignored-tmp');
  const codexHome = path.join(fakeHome, '.codex');
  const claudeDir = path.join(fakeHome, '.claude');
  const claudeJson = path.join(fakeHome, '.claude.json');
  const projectsRoot = path.join(root, 'projects');
  const repoA = path.join(projectsRoot, 'alpha-api');
  const repoB = path.join(projectsRoot, 'beta-web');
  const claudeOnlyDir = path.join(projectsRoot, 'claude-notes');
  const tmpNoiseDir = path.join(fakeTmp, 'scratch-repo');
  const tmpData = path.join(root, 'server-data');

  try {
    await Promise.all([
      fs.mkdir(path.join(codexHome, 'sessions', '2026'), { recursive: true }),
      fs.mkdir(claudeDir, { recursive: true }),
      fs.mkdir(repoA, { recursive: true }),
      fs.mkdir(repoB, { recursive: true }),
      fs.mkdir(claudeOnlyDir, { recursive: true }),
      fs.mkdir(tmpNoiseDir, { recursive: true }),
      fs.mkdir(tmpData, { recursive: true }),
    ]);

    // Initialize repoA with a real commit + 1 dirty high-risk file
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: repoA, windowsHide: true });
    await execFileAsync('git', ['config', 'user.email', 'test@tenon.local'], { cwd: repoA, windowsHide: true });
    await execFileAsync('git', ['config', 'user.name', 'Tenon Test'], { cwd: repoA, windowsHide: true });
    await fs.writeFile(path.join(repoA, 'README.md'), '# alpha\n', 'utf8');
    await execFileAsync('git', ['add', 'README.md'], { cwd: repoA, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repoA, windowsHide: true });
    await fs.writeFile(path.join(repoA, 'auth-guard.mjs'), 'export const ok = true;\n', 'utf8');

    // Initialize repoB with a real commit (clean)
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: repoB, windowsHide: true });
    await execFileAsync('git', ['config', 'user.email', 'test@tenon.local'], { cwd: repoB, windowsHide: true });
    await execFileAsync('git', ['config', 'user.name', 'Tenon Test'], { cwd: repoB, windowsHide: true });
    await fs.writeFile(path.join(repoB, 'index.html'), '<h1>beta</h1>\n', 'utf8');
    await execFileAsync('git', ['add', 'index.html'], { cwd: repoB, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repoB, windowsHide: true });

    // Write Codex global state + rollout session pointing to repoA & noise tmp dir
    await fs.writeFile(
      path.join(codexHome, '.codex-global-state.json'),
      JSON.stringify({ 'active-workspace-roots': [repoA, tmpNoiseDir] }),
      'utf8'
    );
    await fs.writeFile(
      path.join(codexHome, 'sessions', '2026', 'rollout-001.jsonl'),
      `${JSON.stringify({ type: 'session_meta', payload: { cwd: repoA, timestamp: new Date().toISOString() } })}\n`,
      'utf8'
    );

    // Write Claude history + .claude.json pointing to repoA + claudeOnlyDir + missing dir
    await fs.writeFile(
      path.join(claudeDir, 'history.jsonl'),
      [
        JSON.stringify({ project: claudeOnlyDir, timestamp: Date.now() }),
        JSON.stringify({ project: repoA, timestamp: Date.now() - 5000 }),
        JSON.stringify({ project: path.join(projectsRoot, 'deleted-folder'), timestamp: Date.now() }),
      ].join('\n') + '\n',
      'utf8'
    );
    await fs.writeFile(
      claudeJson,
      JSON.stringify({ projects: { [claudeOnlyDir]: {}, [fakeHome]: {} } }),
      'utf8'
    );

    const discovery = await discoverWorkspaces({
      homeDir: fakeHome,
      tmpDir: fakeTmp,
      noisePatterns: [],
      codexHome,
      claudeDir,
      claudeJsonPath: claudeJson,
      geminiDir: path.join(fakeHome, '.gemini'),
      scanRoots: [projectsRoot],
    });

    assert.equal(discovery.ok, true);
    assert.equal(discovery.recommended.toLowerCase(), repoA.toLowerCase());

    const foundA = discovery.workspaces.find((w) => w.path.toLowerCase() === repoA.toLowerCase());
    assert.ok(foundA, 'repoA should be discovered');
    assert.equal(foundA.isGitRepo, true);
    assert.equal(foundA.hasCommits, true);
    assert.equal(foundA.branch, 'main');
    assert.equal(foundA.changedCount, 1);
    assert.equal(foundA.highRiskCount, 1);
    assert.equal(foundA.activeAgent, true);
    assert.ok(foundA.sources.includes('codex'));
    assert.ok(foundA.sources.includes('claude'));

    const foundB = discovery.workspaces.find((w) => w.path.toLowerCase() === repoB.toLowerCase());
    assert.ok(foundB, 'repoB should be discovered via local git scan');

    const foundClaudeOnly = discovery.workspaces.find((w) => w.path.toLowerCase() === claudeOnlyDir.toLowerCase());
    assert.ok(foundClaudeOnly, 'claude-only non-git folder should remain visible');
    assert.equal(foundClaudeOnly.isGitRepo, false);
    assert.ok(foundClaudeOnly.sources.includes('claude'));

    // Noise paths & bare homeDir must be excluded
    assert.equal(
      discovery.workspaces.some((w) => w.path.toLowerCase() === tmpNoiseDir.toLowerCase()),
      false
    );
    assert.equal(
      discovery.workspaces.some((w) => w.path.toLowerCase() === fakeHome.toLowerCase()),
      false
    );

    // Verify HTTP routes (/api/health, /api/workspace/discover, /api/workspace/pick)
    const { server } = await createWorkbenchServer({
      dataDir: tmpData,
      defaultWorkspace: projectsRoot,
      onPickDirectory: async () => repoB,
      workspaceDiscoveryOptions: {
        homeDir: fakeHome,
        tmpDir: fakeTmp,
        noisePatterns: [],
        codexHome,
        claudeDir,
        claudeJsonPath: claudeJson,
        geminiDir: path.join(fakeHome, '.gemini'),
        scanRoots: [projectsRoot],
      },
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    try {
      const healthRes = await fetch(`${base}/api/health`);
      assert.equal(healthRes.status, 200);
      const health = await healthRes.json();
      assert.equal(health.recommendedWorkspace.toLowerCase(), repoA.toLowerCase());
      assert.equal(health.capabilities.nativeFolderPicker, true);

      const discRes = await fetch(`${base}/api/workspace/discover?refresh=1`);
      assert.equal(discRes.status, 200);
      const disc = await discRes.json();
      assert.equal(disc.recommended.toLowerCase(), repoA.toLowerCase());
      assert.ok(disc.workspaces.length >= 3);

      const pickRes = await fetch(`${base}/api/workspace/pick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultPath: repoA }),
      });
      assert.equal(pickRes.status, 200);
      const picked = await pickRes.json();
      assert.equal(picked.supported, true);
      assert.equal(picked.canceled, false);
      assert.equal(picked.path.toLowerCase(), repoB.toLowerCase());
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('createWorkspaceProject & POST /api/workspace/create scaffold git repo safely and block traversal/duplicates', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tenon-ws-create-'));
  const tmpData = path.join(root, 'data');
  const parentDir = path.join(root, 'parent');
  await Promise.all([
    fs.mkdir(tmpData, { recursive: true }),
    fs.mkdir(parentDir, { recursive: true }),
  ]);

  const { server } = await createWorkbenchServer({
    dataDir: tmpData,
    defaultWorkspace: parentDir,
    workspaceDiscoveryOptions: {
      homeDir: path.join(root, 'home'),
      tmpDir: path.join(root, 'ignored-tmp'),
      noisePatterns: [],
      codexHome: '',
      claudeDir: '',
      claudeJsonPath: '',
      geminiDir: '',
      scanRoots: [parentDir],
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Valid creation with date suffix + Git init + initial commit
    const createRes = await fetch(`${base}/api/workspace/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '智能客服后端',
        parentDir,
        appendDate: true,
        initGit: true,
      }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.ok, true);
    assert.match(created.name, /^智能客服后端_\d{4}-\d{2}-\d{2}$/);
    assert.equal(created.gitInitialized, true);
    assert.equal(created.workspace.isGitRepo, true);
    assert.equal(created.workspace.hasCommits, true);
    assert.equal(created.workspace.changedFiles.length, 0);

    // 2. Duplicate creation -> 409 Conflict
    const dupRes = await fetch(`${base}/api/workspace/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: created.name,
        parentDir,
        appendDate: false,
      }),
    });
    assert.equal(dupRes.status, 409);

    // 3. Path traversal / illegal filename -> 400
    const badRes = await fetch(`${base}/api/workspace/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '..\\escape',
        parentDir,
      }),
    });
    assert.equal(badRes.status, 400);

    // 4. Direct helper sanity check (reserved Windows device name)
    await assert.rejects(
      () => createWorkspaceProject({ parentDir, name: 'CON' }),
      (err) => err.statusCode === 400
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('agent-chat mode supports lightweight multi-turn conversation via POST /api/runs/:id/message', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tenon-agent-chat-'));
  const tmpData = path.join(root, 'data');
  await fs.mkdir(tmpData, { recursive: true });

  const receivedPrompts = [];
  const mockLlm = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const userMsg = (body.messages || []).find((m) => m.role === 'user')?.content || '';
    receivedPrompts.push(userMsg);
    const reply = receivedPrompts.length === 1 ? '你好！随时直接问我任何代码问题。' : '收到，记住第一轮你说过你好。';
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '分析用户意图并准备简短回复。' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
  await new Promise((resolve) => mockLlm.listen(0, '127.0.0.1', resolve));
  const llmPort = mockLlm.address().port;

  const { server } = await createWorkbenchServer({
    dataDir: tmpData,
    defaultWorkspace: root,
    workspaceDiscoveryOptions: {
      homeDir: path.join(root, 'home'),
      tmpDir: path.join(root, 'ignored-tmp'),
      noisePatterns: [],
      codexHome: '',
      claudeDir: '',
      claudeJsonPath: '',
      geminiDir: '',
      scanRoots: [root],
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const waitUntilDone = async (runId) => {
    for (let i = 0; i < 40; i += 1) {
      const r = await (await fetch(`${base}/api/runs/${runId}`)).json();
      if (r.run.status === 'completed' || r.run.status === 'failed') return r.run;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error('Timed out waiting for chat turn completion');
  };

  try {
    // Register mock provider
    const pRes = await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Mock Chat LLM',
        kind: 'api',
        protocol: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${llmPort}/v1`,
        apiKey: 'sk-chat-test',
        defaultModel: 'mock-chat-1',
        enabled: true,
      }),
    });
    assert.equal(pRes.status, 200);
    const { provider } = await pRes.json();

    // Turn 1: Start natural agent-chat run
    const r1 = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'agent-chat',
        prompt: '你好',
        workspaceDir: root,
        geminiModel: `provider:${provider.id}:mock-chat-1`,
        providerId: provider.id,
        providerModel: 'mock-chat-1',
      }),
    });
    assert.equal(r1.status, 201);
    const { run: created } = await r1.json();
    const afterTurn1 = await waitUntilDone(created.id);

    assert.equal(afterTurn1.mode, 'agent-chat');
    assert.equal(afterTurn1.status, 'completed');
    assert.equal(afterTurn1.gate, null);
    assert.equal(afterTurn1.messages.length, 2);
    assert.equal(afterTurn1.messages[0].role, 'user');
    assert.equal(afterTurn1.messages[0].content, '你好');
    assert.equal(afterTurn1.messages[1].role, 'assistant');
    assert.match(afterTurn1.messages[1].content, /你好/);
    assert.match(afterTurn1.messages[1].thinkingText, /分析用户意图/);
    assert.ok(Array.isArray(afterTurn1.messages[1].trace) && afterTurn1.messages[1].trace.length >= 1);

    // Turn 2: Follow-up in the SAME thread
    const r2 = await fetch(`${base}/api/runs/${created.id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '我刚才说了什么？',
        geminiModel: `provider:${provider.id}:mock-chat-1`,
        providerId: provider.id,
        providerModel: 'mock-chat-1',
      }),
    });
    assert.equal(r2.status, 200);
    const afterTurn2 = await waitUntilDone(created.id);

    assert.equal(afterTurn2.status, 'completed');
    assert.equal(afterTurn2.messages.length, 4);
    assert.equal(afterTurn2.messages[2].content, '我刚才说了什么？');
    assert.match(afterTurn2.messages[3].content, /第一轮/);
    // Verify Turn 2 carried Turn 1 transcript context
    assert.match(receivedPrompts[1], /你好/);
    assert.match(receivedPrompts[1], /我刚才说了什么/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => mockLlm.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});
