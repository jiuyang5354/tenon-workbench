import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import {
  classifyRiskFiles,
  discoverWorkspaces,
  createWorkspaceProject,
  inspectWorkspace,
  getWorkspaceDiff,
  createManagedWorktree,
  removeManagedWorktree,
} from '../lib/workspace.mjs';

const execFileAsync = promisify(execFile);
import {
  Orchestrator,
  ValidationError,
  parseReviewVerdict,
  parseProviderRef,
} from '../lib/orchestrator.mjs';
import { RunStore } from '../lib/store.mjs';
import {
  sanitizeAgentText,
  buildCodexArgs,
  buildAgyArgs,
  buildWindowsCmdLine,
  execCliFile,
} from '../lib/runners.mjs';
import {
  ProviderStore,
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

test('buildCodexArgs & buildAgyArgs enforce allowCodexNetwork opt-in and safe sandbox bounds', () => {
  // Default: network disabled
  const def = buildCodexArgs({ cwd: '/repo', sandbox: 'workspace-write' });
  assert.equal(def.safeSandbox, 'workspace-write');
  assert.equal(def.enableNetwork, false);
  assert.equal(def.args.includes('sandbox_workspace_write.network_access=true'), false);

  // Explicit opt-in with workspace-write enables network flag
  const optIn = buildCodexArgs({
    cwd: '/repo',
    sandbox: 'workspace-write',
    allowCodexNetwork: true,
    model: 'gpt-5-codex',
    reasoningEffort: 'xhigh',
  });
  assert.equal(optIn.safeSandbox, 'workspace-write');
  assert.equal(optIn.enableNetwork, true);
  const netIdx = optIn.args.indexOf('sandbox_workspace_write.network_access=true');
  assert.ok(netIdx > 0 && optIn.args[netIdx - 1] === '-c');

  // Resume also carries sandbox_mode and opt-in network flag
  const resumed = buildCodexArgs({
    cwd: '/repo',
    sandbox: 'workspace-write',
    allowCodexNetwork: true,
    resumeThreadId: 'thr_abc123',
  });
  assert.equal(resumed.args[0], 'exec');
  assert.equal(resumed.args[1], 'resume');
  assert.equal(resumed.args[2], 'thr_abc123');
  assert.equal(resumed.enableNetwork, true);
  assert.ok(resumed.args.includes('sandbox_mode="workspace-write"'));
  assert.ok(resumed.args.includes('sandbox_workspace_write.network_access=true'));

  // read-only (e.g. Pre-CI review) MUST stay offline even when allowCodexNetwork is true
  const ro = buildCodexArgs({
    cwd: '/repo',
    sandbox: 'read-only',
    allowCodexNetwork: true,
  });
  assert.equal(ro.safeSandbox, 'read-only');
  assert.equal(ro.enableNetwork, false);
  assert.equal(ro.args.includes('sandbox_workspace_write.network_access=true'), false);

  // Dangerous sandbox values are clamped to workspace-write
  const clamped = buildCodexArgs({
    cwd: '/repo',
    sandbox: 'danger-full-access',
    allowCodexNetwork: false,
  });
  assert.equal(clamped.safeSandbox, 'workspace-write');
  assert.equal(clamped.enableNetwork, false);

  // buildAgyArgs guards leading hyphen prompt
  const agyArgs = buildAgyArgs({ prompt: '--dangerous-flag', model: 'gemini-4-neon-high', mode: 'plan' });
  assert.ok(agyArgs.includes('--print= --dangerous-flag'));
});

test('Windows .cmd shim execution preserves special arguments and prevents cmd.exe shell injection', async (t) => {
  const line = buildWindowsCmdLine('C:\\Program Files\\shim.cmd', ['hello "x & echo INJECTED"']);
  assert.ok(line.startsWith('"') && line.endsWith('"'));
  assert.ok(line.includes('^^^&'), 'cmd.exe metacharacters should be double caret-escaped');

  if (process.platform !== 'win32') {
    t.skip('Windows-only live .cmd execution check');
    return;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tenon-cmd-sec-'));
  const jsPath = path.join(tmpDir, 'echo-argv.mjs');
  const cmdPath = path.join(tmpDir, 'space shim.cmd');
  const markerFile = path.join(tmpDir, 'should-not-exist.txt');

  try {
    await fs.writeFile(jsPath, 'console.log(JSON.stringify(process.argv.slice(2)));\n', 'utf8');
    await fs.writeFile(cmdPath, `@echo off\r\n"${process.execPath}" "${jsPath}" %*\r\n`, 'utf8');

    const argv = [
      '--version',
      'a & b',
      `hello "x & echo PWNED > ${markerFile}"`,
      '%USERNAME% | 中文 "引号" < >',
    ];
    const { stdout } = await execCliFile(cmdPath, argv, { timeout: 8000 });
    const roundtripped = JSON.parse(stdout.trim());
    assert.deepEqual(roundtripped, argv);

    const markerExists = await fs.access(markerFile).then(() => true).catch(() => false);
    assert.equal(markerExists, false, 'Shell redirection inside quoted arg must never execute');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('RunStore recovers interrupted messages/traces on init, flushes atomically, and prevents SSE leaks', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tenon-store-test-'));
  try {
    const stuckRuns = [
      {
        id: 'run_stuck_1',
        mode: 'agent-chat',
        title: 'Crash recovery test',
        workspaceDir: tmpDir,
        status: 'running',
        gate: { type: 'plan_approval', title: 'Pending' },
        gemini: { status: 'running' },
        codex: { status: 'running' },
        messages: [
          { id: 'u1', role: 'user', status: 'done', content: 'hi' },
          {
            id: 'a1',
            role: 'assistant',
            status: 'running',
            liveStep: 'Executing tool...',
            content: '',
            trace: [
              { id: 't1', kind: 'tool', title: 'Read file', status: 'done' },
              { id: 't2', kind: 'tool', title: 'Run test', status: 'running' },
            ],
          },
        ],
        createdAt: '2026-11-24T00:00:00.000Z',
        updatedAt: '2026-11-24T00:00:00.000Z',
      },
    ];
    await fs.writeFile(path.join(tmpDir, 'runs.json'), JSON.stringify(stuckRuns, null, 2), 'utf8');

    const store = new RunStore(tmpDir);
    await store.init();

    const recovered = store.get('run_stuck_1');
    assert.ok(recovered);
    assert.equal(recovered.status, 'interrupted');
    assert.equal(recovered.gate, null);
    assert.equal(recovered.gemini.status, 'interrupted');
    assert.equal(recovered.codex.status, 'interrupted');
    assert.ok(Array.isArray(recovered.events));
    assert.equal(recovered.messages[1].status, 'interrupted');
    assert.equal(recovered.messages[1].liveStep, null);
    assert.ok(recovered.messages[1].error);
    assert.equal(recovered.messages[1].trace[0].status, 'done');
    assert.equal(recovered.messages[1].trace[1].status, 'error');

    // Rapid concurrent mutations + serialized flush leave clean JSON and zero leftover .tmp files
    for (let i = 0; i < 15; i += 1) {
      store.update('run_stuck_1', (r) => {
        r.title = `Batch title #${i}`;
      });
    }
    await store.flush();

    const files = await fs.readdir(tmpDir);
    assert.equal(files.some((f) => f.endsWith('.tmp')), false, 'No orphaned .tmp files after flush');
    const persisted = JSON.parse(await fs.readFile(path.join(tmpDir, 'runs.json'), 'utf8'));
    assert.equal(persisted[0].title, 'Batch title #14');
    assert.equal(persisted[0].status, 'interrupted');

    // SSE subscriber cleanup & write-after-end safety
    const makeFakeRes = () => {
      const ee = new EventEmitter();
      ee.writable = true;
      ee.writableEnded = false;
      ee.destroyed = false;
      ee.closed = false;
      ee.writes = [];
      ee.write = (chunk) => {
        if (ee.writableEnded || ee.destroyed) throw new Error('write after end');
        ee.writes.push(chunk);
        return true;
      };
      ee.end = () => {
        ee.writableEnded = true;
        ee.writable = false;
        ee.emit('close');
      };
      return ee;
    };

    const runSub = makeFakeRes();
    const globalSub = makeFakeRes();
    store.subscribe('run_stuck_1', runSub);
    store.subscribeGlobal(globalSub);
    assert.equal(store.subscribers.get('run_stuck_1')?.size, 1);
    assert.equal(store.globalSubscribers.size, 1);

    // Emit when writable works, then remove() cleanly ends & detaches subscriber
    store.emit('run_stuck_1', 'ping', { ok: true });
    assert.equal(runSub.writes.length, 1);
    store.remove('run_stuck_1');
    assert.equal(runSub.writableEnded, true);
    assert.equal(store.subscribers.has('run_stuck_1'), false);

    // Emitting after stream ended never throws and prunes dead global subscriber
    globalSub.writableEnded = true;
    store.broadcastGlobal('run_updated', { id: 'x' });
    assert.equal(store.globalSubscribers.size, 0);

    store.dispose();
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Orchestrator wires allowCodexNetwork, enforces cancelRun generation guards, and resolves gate aborts accurately', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tenon-orch-guard-'));
  const store = new RunStore(tmpDir);
  await store.init();
  const orch = new Orchestrator(store);

  try {
    // Reject invalid mode with ValidationError (400)
    await assert.rejects(
      () => orch.startRun({ mode: 'invalid-mode', prompt: 'hello', workspaceDir: tmpDir }),
      (err) => err instanceof ValidationError && err.statusCode === 400
    );

    // Seed an active run and test cancelRun() + generation invalidation
    const runId = 'run_cancel_guard';
    store.create({
      id: runId,
      mode: 'agent-chat',
      title: 'Cancel test',
      workspaceDir: tmpDir,
      effectiveWorkDir: tmpDir,
      isGitRepo: false,
      status: 'running',
      activeStage: 'chat',
      config: { sandbox: 'workspace-write', allowCodexNetwork: true },
      gate: null,
      gemini: { status: 'idle' },
      codex: { status: 'running', threadId: 'thr_live_1' },
      metrics: { totalDurationMs: 0, geminiTokens: 0, codexTokens: 0 },
      messages: [
        {
          id: 'asst_1',
          role: 'assistant',
          status: 'running',
          liveStep: 'Running command',
          trace: [{ id: 'cmd_1', kind: 'tool', title: 'git status', status: 'running' }],
        },
      ],
      events: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const gen = orch.nextGeneration(runId);
    let aborted = false;
    assert.equal(orch.setActiveProcess(runId, { abort: () => { aborted = true; } }, gen), true);
    assert.equal(orch.isExecutionActive(runId, gen), true);

    assert.equal(orch.cancelRun(runId), true);
    assert.equal(aborted, true);
    assert.equal(orch.isExecutionActive(runId, gen), false);

    // Late process registration with stale generation must be rejected and aborted immediately
    let lateAborted = false;
    assert.equal(orch.setActiveProcess(runId, { abort: () => { lateAborted = true; } }, gen), false);
    assert.equal(lateAborted, true);

    const afterCancel = store.get(runId);
    assert.equal(afterCancel.status, 'cancelled');
    assert.equal(afterCancel.codex.status, 'cancelled');
    assert.equal(afterCancel.messages[0].status, 'cancelled');
    assert.equal(afterCancel.messages[0].liveStep, null);
    assert.equal(afterCancel.messages[0].trace[0].status, 'cancelled');
    // Cancelling an already-terminal run returns false
    assert.equal(orch.cancelRun(runId), false);

    // resolveGate('abort') distinguishes plan_approval -> cancelled vs review_escalation -> blocked
    const gatePlanId = 'run_gate_plan';
    store.create({
      id: gatePlanId,
      mode: 'full-pipeline',
      title: 'Gate plan abort',
      workspaceDir: tmpDir,
      status: 'running',
      gate: null,
      events: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const planGen = orch.nextGeneration(gatePlanId);
    const planGatePromise = orch.waitForHumanGate(gatePlanId, { type: 'plan_approval', message: 'approve?' }, planGen);
    assert.equal(store.get(gatePlanId).status, 'awaiting_approval');
    assert.equal(orch.resolveGate(gatePlanId, { action: 'abort' }), true);
    assert.deepEqual(await planGatePromise, { action: 'abort' });
    assert.equal(store.get(gatePlanId).status, 'cancelled');
    assert.equal(store.get(gatePlanId).gate, null);

    const gateRevId = 'run_gate_rev';
    store.create({
      id: gateRevId,
      mode: 'full-pipeline',
      title: 'Gate review abort',
      workspaceDir: tmpDir,
      status: 'running',
      gate: null,
      events: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const revGen = orch.nextGeneration(gateRevId);
    const revGatePromise = orch.waitForHumanGate(gateRevId, { type: 'review_escalation', message: 'blocked' }, revGen);
    assert.equal(orch.resolveGate(gateRevId, { action: 'abort' }), true);
    assert.deepEqual(await revGatePromise, { action: 'abort' });
    assert.equal(store.get(gateRevId).status, 'blocked');
    assert.equal(store.get(gateRevId).gate, null);
  } finally {
    store.dispose();
    orch.shutdown();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Server hardens media suffix ranges, non-object JSON bodies, gate action validation, and ProviderStore corruption backup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tenon-hardening-'));
  const tmpData = path.join(root, 'data');
  const wsDir = path.join(root, 'workspace');
  await Promise.all([fs.mkdir(tmpData, { recursive: true }), fs.mkdir(wsDir, { recursive: true })]);

  // Pre-seed a corrupt providers.json to verify backup preservation on init()
  await fs.writeFile(path.join(tmpData, 'providers.json'), '{not-valid-json', 'utf8');
  const pStore = new ProviderStore(tmpData);
  await pStore.init();
  const dataFiles = await fs.readdir(tmpData);
  assert.ok(dataFiles.some((f) => f.startsWith('providers.json.corrupt.') && f.endsWith('.bak')));

  // Short secrets <= 4 chars must be completely masked
  assert.equal(maskSecret('ab'), '••••');
  assert.equal(maskSecret('1234'), '••••');

  // Anthropic message_start usage parsing
  const anthStart = parseAnthropicSseChunk(JSON.stringify({
    type: 'message_start',
    message: { usage: { input_tokens: 42 } },
  }));
  assert.equal(anthStart.usage?.input_tokens, 42);

  // Create a dummy PNG file inside wsDir for range & header checks
  const mediaBytes = Buffer.from('0123456789ABCDEF');
  await fs.writeFile(path.join(wsDir, 'sample.png'), mediaBytes);

  const { server, store } = await createWorkbenchServer({ dataDir: tmpData, defaultWorkspace: wsDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // Non-object JSON body -> 400
    const arrRes = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '["not-an-object"]',
    });
    assert.equal(arrRes.status, 400);

    // Invalid gate action -> 400
    store.create({
      id: 'run_gate_val',
      mode: 'full-pipeline',
      title: 'Gate action check',
      workspaceDir: wsDir,
      status: 'awaiting_approval',
      events: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const badGate = await fetch(`${base}/api/runs/run_gate_val/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'drop_table' }),
    });
    assert.equal(badGate.status, 400);

    // Media null byte -> 400, traversal -> 403
    const nullMedia = await fetch(`${base}/api/workspace/media?dir=${encodeURIComponent(wsDir)}&file=sample.png%00.jpg`);
    assert.equal(nullMedia.status, 400);
    const escMedia = await fetch(`${base}/api/workspace/media?dir=${encodeURIComponent(wsDir)}&file=../outside.png`);
    assert.equal(escMedia.status, 403);

    // Media invalid range bytes=- -> 416
    const badRange = await fetch(`${base}/api/workspace/media?dir=${encodeURIComponent(wsDir)}&file=sample.png`, {
      headers: { Range: 'bytes=-' },
    });
    assert.equal(badRange.status, 416);

    // RFC 9110 suffix range bytes=-4 -> 206 with last 4 bytes and nosniff
    const suffixRange = await fetch(`${base}/api/workspace/media?dir=${encodeURIComponent(wsDir)}&file=sample.png`, {
      headers: { Range: 'bytes=-4' },
    });
    assert.equal(suffixRange.status, 206);
    assert.equal(suffixRange.headers.get('content-range'), 'bytes 12-15/16');
    assert.equal(suffixRange.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await suffixRange.text(), 'CDEF');

    // Verify allowCodexNetwork plumbing through POST /api/runs and POST /api/runs/:id/message without spawning external CLIs
    const mockLlm = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
    await new Promise((resolve) => mockLlm.listen(0, '127.0.0.1', resolve));
    try {
      const pRes = await fetch(`${base}/api/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Mock Net Flag Provider',
          kind: 'api',
          protocol: 'openai-compatible',
          baseUrl: `http://127.0.0.1:${mockLlm.address().port}/v1`,
          apiKey: 'sk-test-1234',
          defaultModel: 'mock-1',
          enabled: true,
        }),
      });
      const { provider } = await pRes.json();

      const netRunRes = await fetch(`${base}/api/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'agent-chat',
          prompt: 'turn 1',
          workspaceDir: wsDir,
          geminiModel: `provider:${provider.id}:mock-1`,
          allowCodexNetwork: true,
        }),
      });
      assert.equal(netRunRes.status, 201);
      const { run: createdNet } = await netRunRes.json();
      assert.equal(createdNet.config.allowCodexNetwork, true);

      // Wait for turn 1 to finish before continuing chat with allowCodexNetwork: false
      for (let i = 0; i < 40; i += 1) {
        const latest = await (await fetch(`${base}/api/runs/${createdNet.id}`)).json();
        if (latest.run.status === 'completed' || latest.run.status === 'failed') break;
        await new Promise((r) => setTimeout(r, 30));
      }

      const contRes = await fetch(`${base}/api/runs/${createdNet.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'turn 2',
          geminiModel: `provider:${provider.id}:mock-1`,
          allowCodexNetwork: false,
        }),
      });
      assert.equal(contRes.status, 200);
      const { run: updatedNet } = await contRes.json();
      assert.equal(updatedNet.config.allowCodexNetwork, false);

      for (let i = 0; i < 40; i += 1) {
        const latest = await (await fetch(`${base}/api/runs/${createdNet.id}`)).json();
        if (latest.run.status === 'completed' || latest.run.status === 'failed') break;
        await new Promise((r) => setTimeout(r, 30));
      }
      await fetch(`${base}/api/runs/${createdNet.id}`, { method: 'DELETE' });
    } finally {
      await new Promise((resolve) => mockLlm.close(resolve));
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('workspace helpers handle Chinese/space filenames, unborn repos, and guarded worktree removal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tenon-ws-edge-'));
  const repoDir = path.join(root, '中文 工程目录');
  try {
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: repoDir, windowsHide: true });

    // Unborn repo (no commits yet) must cleanly refuse managed worktree creation
    const wtUnborn = await createManagedWorktree(repoDir, 'unborn_1');
    assert.equal(wtUnborn.ok, false);
    assert.match(wtUnborn.error || '', /首次提交/);

    // Untracked Chinese/space file & binary file in unborn repo
    await fs.writeFile(path.join(repoDir, '设计 说明.md'), '# 测试\n', 'utf8');
    await fs.writeFile(path.join(repoDir, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03]));

    const info = await inspectWorkspace(repoDir);
    assert.equal(info.ok, true);
    assert.equal(info.isGitRepo, true);
    assert.ok(info.changedFiles.some((f) => f.file === '设计 说明.md'));

    const diffInfo = await getWorkspaceDiff(repoDir);
    assert.equal(diffInfo.ok, true);
    assert.match(diffInfo.diff, /设计 说明\.md/);
    assert.doesNotMatch(diffInfo.diff, /blob\.bin/, 'Binary NUL files should be skipped in untracked diffs');

    // removeManagedWorktree refuses unmanaged directories outside os.tmpdir()/conduit-wt-*
    const refused = await removeManagedWorktree(repoDir, repoDir);
    assert.equal(refused.ok, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('in-place session resume continues codex-exec and interrupted pipeline runs in the same thread and honors timeoutPolicy', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tenon-resume-inplace-'));
  const tmpData = path.join(root, 'data');
  const wsDir = path.join(root, 'ws');
  await fs.mkdir(wsDir, { recursive: true });

  const mockLlm = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'resumed-in-place-ok' } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
  await new Promise((resolve) => mockLlm.listen(0, '127.0.0.1', resolve));

  const { server, store, orchestrator } = await createWorkbenchServer({ dataDir: tmpData, defaultWorkspace: wsDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // Verify timeoutPolicy defaults to unlimited (0ms) and supports explicit modes
    assert.deepEqual(orchestrator.resolveTimeoutPolicy('none'), { timeoutMs: 0, idleTimeoutMs: 0 });
    assert.deepEqual(orchestrator.resolveTimeoutPolicy(''), { timeoutMs: 0, idleTimeoutMs: 0 });
    assert.deepEqual(orchestrator.resolveTimeoutPolicy('idle-10m'), { timeoutMs: 0, idleTimeoutMs: 600_000 });
    assert.deepEqual(orchestrator.resolveTimeoutPolicy('max-15m'), { timeoutMs: 900_000, idleTimeoutMs: 0 });
    assert.deepEqual(orchestrator.resolveTimeoutPolicy('max-30m'), { timeoutMs: 1_800_000, idleTimeoutMs: 0 });

    // Create mock provider for deterministic in-place execution
    const pRes = await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Resume Mock Provider',
        kind: 'api',
        protocol: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${mockLlm.address().port}/v1`,
        apiKey: 'sk-resume-1234',
        defaultModel: 'mock-r',
        enabled: true,
      }),
    });
    assert.equal(pRes.status, 200);
    const { provider } = await pRes.json();

    // Seed an interrupted full-pipeline run (with existing planText & codex threadId)
    store.create({
      id: 'run_pipe_interrupted',
      mode: 'full-pipeline',
      title: '被中断的全链路任务',
      prompt: '检查 PR 代码是否有 bug',
      workspaceDir: wsDir,
      effectiveWorkDir: wsDir,
      isGitRepo: false,
      status: 'interrupted',
      activeStage: 'interrupted',
      config: { geminiModel: 'gemini-4-neon-high', codexModel: '', sandbox: 'workspace-write', timeoutMode: 'none' },
      gemini: { status: 'done', planText: '初始架构方案保留', summaryText: '', copyText: '', durationMs: 1200, error: null },
      codex: { status: 'failed', threadId: '01a2104b-5ddd-7e90-95a4-da2d025a0a31', execText: '部分执行结果', diff: '', diffStat: '', durationMs: 300000, error: '已中断' },
      metrics: { geminiTokens: 100, codexTokens: 200, totalDurationMs: 301200 },
      messages: [],
      events: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const beforeList = await (await fetch(`${base}/api/runs`)).json();
    assert.equal(beforeList.runs.length, 1);

    // Continue in place via POST /api/runs/:id/message (must NOT open a second run!)
    const contRes = await fetch(`${base}/api/runs/run_pipe_interrupted/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '请从中断处继续完成',
        geminiModel: `provider:${provider.id}:mock-r`,
        timeoutMode: 'idle-10m',
      }),
    });
    assert.equal(contRes.status, 200);
    const { run: resumed } = await contRes.json();
    assert.equal(resumed.id, 'run_pipe_interrupted');
    assert.equal(resumed.config.timeoutMode, 'idle-10m');

    // Wait for follow-up turn to complete
    let latest = null;
    for (let i = 0; i < 40; i += 1) {
      latest = (await (await fetch(`${base}/api/runs/run_pipe_interrupted`)).json()).run;
      if (latest.status === 'completed' || latest.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(latest.status, 'completed');
    assert.equal(latest.gemini.planText, '初始架构方案保留', 'Original planText must remain intact');
    assert.equal(latest.codex.execText, '部分执行结果', 'Original codex.execText must remain intact');
    assert.equal(latest.messages.length, 2, 'User + assistant follow-up messages appended in place');
    assert.equal(latest.messages[1].content, 'resumed-in-place-ok');

    // Verify sidebar run count did NOT grow!
    const afterList = await (await fetch(`${base}/api/runs`)).json();
    assert.equal(afterList.runs.length, 1, 'In-place resume must never create a duplicate thread');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => mockLlm.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('POST /api/canvas/node-run enforces validation/CSRF and executes summary-card with any selected model', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tenon-canvas-summary-'));
  const tmpData = path.join(root, 'data');
  const wsDir = path.join(root, 'ws');
  await fs.mkdir(wsDir, { recursive: true });

  const mockLlm = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '### 最终结论\n测试全部通过。\n\n### 给你复述一遍\n- 已完成验证。' } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
  await new Promise((resolve) => mockLlm.listen(0, '127.0.0.1', resolve));

  const { server } = await createWorkbenchServer({ dataDir: tmpData, defaultWorkspace: wsDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // Reject empty prompt -> 400
    const emptyRes = await fetch(`${base}/api/canvas/node-run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeKind: 'summary-card', prompt: '   ' }),
    });
    assert.equal(emptyRes.status, 400);

    // Reject cross-site Origin -> 403
    const csrfRes = await fetch(`${base}/api/canvas/node-run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
      body: JSON.stringify({ nodeKind: 'summary-card', prompt: 'summarize' }),
    });
    assert.equal(csrfRes.status, 403);

    // Create mock external API provider and execute summary-card using provider:<id>:<model>
    const pRes = await fetch(`${base}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Summary Mock API',
        kind: 'api',
        protocol: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${mockLlm.address().port}/v1`,
        apiKey: 'sk-summary-9999',
        defaultModel: 'summary-v1',
        enabled: true,
      }),
    });
    assert.equal(pRes.status, 200);
    const { provider } = await pRes.json();

    const runRes = await fetch(`${base}/api/canvas/node-run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeKind: 'summary-card',
        nodeTitle: '画布卡片总结框',
        model: `provider:${provider.id}:summary-v1`,
        prompt: '总结最终结论并复述',
        cwd: wsDir,
      }),
    });
    assert.equal(runRes.status, 200);
    const body = await runRes.json();
    assert.equal(body.ok, true);
    assert.equal(body.engine, 'Summary Mock API');
    assert.equal(body.model, 'summary-v1');
    assert.match(body.text, /最终结论/);
    assert.match(body.text, /给你复述一遍/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => mockLlm.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('ComfyUI-style workflow persistence (/api/workflows) saves drafts, named workflows, renames, deletes, and survives restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tenon-workflows-api-'));
  const dataDir = path.join(root, 'data');
  const wsDir = path.join(root, 'ws');
  await fs.mkdir(wsDir, { recursive: true });

  const sampleGraph = {
    nodes: [
      {
        id: 'n-plan',
        kind: 'gemini-plan',
        title: '需求分析',
        subtitle: '理清范围',
        prompt: '先分析现有登录逻辑',
        model: 'gemini-4-neon-high',
        x: 60,
        y: 120,
        w: 296,
        status: 'completed',
        outputMd: '已定位 auth.mjs 边界',
      },
      {
        id: 'n-summary',
        kind: 'summary-card',
        title: '画布卡片总结框',
        subtitle: '输出结论与复述',
        prompt: '用大白话复述核心结论',
        model: 'codex:default',
        x: 460,
        y: 120,
        w: 368,
        status: 'completed',
        outputMd: '### 最终结论\n已完成分析。',
      },
    ],
    edges: [{ id: 'e-1', source: 'n-plan', target: 'n-summary' }],
    groups: [],
  };

  let srv1 = null;
  let srv2 = null;
  try {
    const inst1 = await createWorkbenchServer({ dataDir, defaultWorkspace: wsDir });
    srv1 = inst1.server;
    await new Promise((resolve) => srv1.listen(0, '127.0.0.1', resolve));
    const base1 = `http://127.0.0.1:${srv1.address().port}`;

    // 1. Initial empty state
    const initRes = await fetch(`${base1}/api/workflows`);
    assert.equal(initRes.status, 200);
    const initData = await initRes.json();
    assert.equal(initData.draft, null);
    assert.deepEqual(initData.workflows, []);

    // 2. Reject invalid empty graph (400) & cross-site origin (403)
    const badRes = await fetch(`${base1}/api/workflows/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: { nodes: [] } }),
    });
    assert.equal(badRes.status, 400);

    const csrfRes = await fetch(`${base1}/api/workflows/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
      body: JSON.stringify({ graph: sampleGraph }),
    });
    assert.equal(csrfRes.status, 403);

    // 3. Auto-save draft including node outputs & viewport
    const draftRes = await fetch(`${base1}/api/workflows/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '登录排查草稿',
        graph: sampleGraph,
        viewport: { panX: 120, panY: 88, zoom: 0.92 },
        lastTaskPrompt: '检查登录超时问题',
      }),
    });
    assert.equal(draftRes.status, 200);
    const draftJson = await draftRes.json();
    assert.equal(draftJson.ok, true);

    // 4. Save named workflow, then rename it
    const saveRes = await fetch(`${base1}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '我的 ComfyUI 流程',
        graph: sampleGraph,
        viewport: { panX: 120, panY: 88, zoom: 0.92 },
        lastTaskPrompt: '检查登录超时问题',
      }),
    });
    assert.equal(saveRes.status, 200);
    const saved = await saveRes.json();
    assert.equal(saved.workflows.length, 1);
    const wfId = saved.workflow.id;
    assert.equal(saved.workflow.name, '我的 ComfyUI 流程');

    const renameRes = await fetch(`${base1}/api/workflows/${encodeURIComponent(wfId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '登录修复标准流' }),
    });
    assert.equal(renameRes.status, 200);
    const renamed = await renameRes.json();
    assert.equal(renamed.workflow.name, '登录修复标准流');

    await inst1.workflowStore.flush();
    await new Promise((resolve) => srv1.close(resolve));
    srv1 = null;

    // 5. Cold restart with a brand new server instance -> verify 100% persistence on disk!
    const inst2 = await createWorkbenchServer({ dataDir, defaultWorkspace: wsDir });
    srv2 = inst2.server;
    await new Promise((resolve) => srv2.listen(0, '127.0.0.1', resolve));
    const base2 = `http://127.0.0.1:${srv2.address().port}`;

    const afterRestart = await (await fetch(`${base2}/api/workflows`)).json();
    assert.equal(afterRestart.activeWorkflowId, wfId);
    assert.equal(afterRestart.workflows.length, 1);
    assert.equal(afterRestart.workflows[0].name, '登录修复标准流');
    assert.equal(afterRestart.workflows[0].graph.nodes[0].outputMd, '已定位 auth.mjs 边界');
    assert.equal(afterRestart.workflows[0].graph.nodes[1].model, 'codex:default');
    assert.equal(afterRestart.draft.viewport.zoom, 0.92);
    assert.equal(afterRestart.draft.lastTaskPrompt, '检查登录超时问题');

    // 6. Delete workflow cleanly
    const delRes = await fetch(`${base2}/api/workflows/${encodeURIComponent(wfId)}`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);
    const afterDel = await delRes.json();
    assert.equal(afterDel.workflows.length, 0);
    assert.equal(afterDel.activeWorkflowId, null);
  } finally {
    if (srv1) await new Promise((resolve) => srv1.close(resolve));
    if (srv2) await new Promise((resolve) => srv2.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});
