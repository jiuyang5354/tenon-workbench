import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const RETRYABLE_FS_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const MAX_WORKFLOWS = 100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function atomicWriteFile(filePath, content) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const uniqueSuffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const tmpPath = `${filePath}.${uniqueSuffix}.tmp`;
  await fs.writeFile(tmpPath, content, 'utf8');

  try {
    const retryDelays = [25, 60, 120, 240, 400];
    let lastErr = null;
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      try {
        await fs.rename(tmpPath, filePath);
        return;
      } catch (err) {
        lastErr = err;
        if (!RETRYABLE_FS_CODES.has(err?.code) || attempt === retryDelays.length) {
          break;
        }
        await sleep(retryDelays[attempt]);
      }
    }

    if (RETRYABLE_FS_CODES.has(lastErr?.code)) {
      await fs.copyFile(tmpPath, filePath);
      await fs.unlink(tmpPath).catch(() => {});
      return;
    }

    throw lastErr;
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

function sanitizeViewport(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const panX = Number(raw.panX);
  const panY = Number(raw.panY);
  const zoom = Number(raw.zoom);
  if (!Number.isFinite(panX) || !Number.isFinite(panY) || !Number.isFinite(zoom)) {
    return null;
  }
  return {
    panX: Math.round(panX * 100) / 100,
    panY: Math.round(panY * 100) / 100,
    zoom: Math.max(0.25, Math.min(2.0, Math.round(zoom * 1000) / 1000)),
  };
}

function sanitizeGraph(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.nodes)) {
    return null;
  }
  const nodes = raw.nodes
    .filter((n) => n && typeof n === 'object')
    .slice(0, 120)
    .map((n, idx) => ({
      id: typeof n.id === 'string' && n.id.trim() ? n.id.trim().slice(0, 80) : `n-${idx + 1}`,
      kind: typeof n.kind === 'string' && n.kind.trim() ? n.kind.trim().slice(0, 48) : 'codex-exec',
      title: typeof n.title === 'string' ? n.title.slice(0, 120) : '',
      subtitle: typeof n.subtitle === 'string' ? n.subtitle.slice(0, 200) : '',
      prompt: typeof n.prompt === 'string' ? n.prompt.slice(0, 12_000) : '',
      model: typeof n.model === 'string' ? n.model.trim().slice(0, 160) : '',
      effort: typeof n.effort === 'string' ? n.effort.trim().slice(0, 32) : '',
      x: Number.isFinite(Number(n.x)) ? Math.round(Number(n.x)) : 80,
      y: Number.isFinite(Number(n.y)) ? Math.round(Number(n.y)) : 120,
      w: Number.isFinite(Number(n.w)) ? Math.round(Number(n.w)) : 296,
      h: Number.isFinite(Number(n.h)) && Number(n.h) > 0 ? Math.round(Number(n.h)) : null,
      status: typeof n.status === 'string' ? n.status.slice(0, 24) : 'idle',
      muted: Boolean(n.muted),
      collapsed: Boolean(n.collapsed),
      cotOpen: Boolean(n.cotOpen),
      params: Array.isArray(n.params) ? n.params.slice(0, 16) : [],
      toggles: Array.isArray(n.toggles) ? n.toggles.slice(0, 12) : [],
      steps: Array.isArray(n.steps) ? n.steps.slice(0, 12) : [],
      outputMd: typeof n.outputMd === 'string' ? n.outputMd.slice(0, 60_000) : '',
      summarySource: typeof n.summarySource === 'string' ? n.summarySource.slice(0, 32) : '',
      durationMs: Number.isFinite(Number(n.durationMs)) ? Math.max(0, Math.round(Number(n.durationMs))) : 0,
    }));

  const idSet = new Set(nodes.map((n) => n.id));
  const edges = Array.isArray(raw.edges)
    ? raw.edges
        .filter((e) => e && typeof e === 'object' && idSet.has(e.source) && idSet.has(e.target) && e.source !== e.target)
        .slice(0, 400)
        .map((e, idx) => ({
          id: typeof e.id === 'string' && e.id.trim() ? e.id.trim().slice(0, 80) : `e-${idx + 1}`,
          source: e.source,
          target: e.target,
        }))
    : [];

  const validAccents = new Set(['sage', 'slate', 'amber']);
  const groups = Array.isArray(raw.groups)
    ? raw.groups
        .filter((g) => g && typeof g === 'object' && Array.isArray(g.nodeIds))
        .slice(0, 40)
        .map((g, idx) => ({
          id: typeof g.id === 'string' && g.id.trim() ? g.id.trim().slice(0, 80) : `grp-${idx + 1}`,
          title: typeof g.title === 'string' && g.title.trim() ? g.title.trim().slice(0, 80) : `节点组 #${idx + 1}`,
          accent: validAccents.has(g.accent) ? g.accent : 'sage',
          nodeIds: Array.from(new Set(g.nodeIds.filter((nid) => idSet.has(nid)))),
          collapsed: Boolean(g.collapsed),
        }))
        .filter((g) => g.nodeIds.length > 0)
    : [];

  return { nodes, edges, groups };
}

export class WorkflowStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, 'workflows.json');
    this.state = {
      version: 1,
      activeWorkflowId: null,
      draft: null,
      workflows: [],
    };
    this._saveQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const workflows = Array.isArray(parsed.workflows)
          ? parsed.workflows
              .filter((w) => w && typeof w === 'object' && w.id && w.graph)
              .map((w) => {
                const graph = sanitizeGraph(w.graph);
                if (!graph) return null;
                return {
                  id: String(w.id).slice(0, 80),
                  name: String(w.name || '未命名工作流').trim().slice(0, 80) || '未命名工作流',
                  graph,
                  viewport: sanitizeViewport(w.viewport),
                  lastTaskPrompt: typeof w.lastTaskPrompt === 'string' ? w.lastTaskPrompt.slice(0, 8000) : '',
                  nodeCount: graph.nodes.length,
                  edgeCount: graph.edges.length,
                  createdAt: w.createdAt || new Date().toISOString(),
                  updatedAt: w.updatedAt || new Date().toISOString(),
                };
              })
              .filter(Boolean)
              .slice(0, MAX_WORKFLOWS)
          : [];

        let draft = null;
        if (parsed.draft && typeof parsed.draft === 'object') {
          const graph = sanitizeGraph(parsed.draft.graph);
          if (graph && graph.nodes.length > 0) {
            draft = {
              name: typeof parsed.draft.name === 'string' ? parsed.draft.name.slice(0, 80) : '',
              activeWorkflowId: typeof parsed.draft.activeWorkflowId === 'string' ? parsed.draft.activeWorkflowId.slice(0, 80) : null,
              graph,
              viewport: sanitizeViewport(parsed.draft.viewport),
              lastTaskPrompt: typeof parsed.draft.lastTaskPrompt === 'string' ? parsed.draft.lastTaskPrompt.slice(0, 8000) : '',
              lastClusterReportMd: typeof parsed.draft.lastClusterReportMd === 'string' ? parsed.draft.lastClusterReportMd.slice(0, 60_000) : '',
              updatedAt: parsed.draft.updatedAt || new Date().toISOString(),
            };
          }
        }

        const activeId =
          typeof parsed.activeWorkflowId === 'string' && workflows.some((w) => w.id === parsed.activeWorkflowId)
            ? parsed.activeWorkflowId
            : null;

        this.state = {
          version: 1,
          activeWorkflowId: activeId,
          draft,
          workflows,
        };
      }
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        console.warn('[TENON] Failed to load workflows.json, starting fresh:', err?.message || err);
      }
    }
  }

  async _persist() {
    const payload = JSON.stringify(this.state, null, 2);
    const next = this._saveQueue
      .catch(() => {})
      .then(() => atomicWriteFile(this.filePath, payload));
    this._saveQueue = next;
    return next;
  }

  async flush() {
    try {
      await this._saveQueue;
    } catch {
      // ignore flush error during shutdown
    }
  }

  getState() {
    return {
      activeWorkflowId: this.state.activeWorkflowId,
      draft: this.state.draft,
      workflows: this.state.workflows,
    };
  }

  get(id) {
    return this.state.workflows.find((w) => w.id === id) || null;
  }

  async saveDraft(payload = {}) {
    const graph = sanitizeGraph(payload.graph);
    if (!graph || graph.nodes.length === 0) {
      throw new Error('工作流画布至少需要包含一个有效节点');
    }
    const now = new Date().toISOString();
    const activeWorkflowId =
      typeof payload.activeWorkflowId === 'string' && this.get(payload.activeWorkflowId)
        ? payload.activeWorkflowId
        : null;

    this.state.activeWorkflowId = activeWorkflowId;
    this.state.draft = {
      name: typeof payload.name === 'string' ? payload.name.trim().slice(0, 80) : '',
      activeWorkflowId,
      graph,
      viewport: sanitizeViewport(payload.viewport),
      lastTaskPrompt: typeof payload.lastTaskPrompt === 'string' ? payload.lastTaskPrompt.slice(0, 8000) : '',
      lastClusterReportMd: typeof payload.lastClusterReportMd === 'string' ? payload.lastClusterReportMd.slice(0, 60_000) : '',
      updatedAt: now,
    };
    await this._persist();
    return { ok: true, updatedAt: now };
  }

  async upsertWorkflow(payload = {}) {
    const graph = sanitizeGraph(payload.graph);
    if (!graph || graph.nodes.length === 0) {
      throw new Error('保存的工作流至少需要包含一个有效节点');
    }
    const existing = payload.id ? this.get(String(payload.id).trim()) : null;
    const cleanName = String(payload.name ?? existing?.name ?? '').trim().slice(0, 80);
    if (!cleanName) {
      throw new Error('请填写工作流名称');
    }
    const now = new Date().toISOString();
    const viewport = sanitizeViewport(payload.viewport);
    const lastTaskPrompt = typeof payload.lastTaskPrompt === 'string'
      ? payload.lastTaskPrompt.slice(0, 8000)
      : (existing?.lastTaskPrompt || '');

    const record = {
      id: existing?.id || `wf_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      name: cleanName,
      graph,
      viewport,
      lastTaskPrompt,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    if (existing) {
      const idx = this.state.workflows.findIndex((w) => w.id === existing.id);
      this.state.workflows[idx] = record;
    } else {
      this.state.workflows.unshift(record);
      if (this.state.workflows.length > MAX_WORKFLOWS) {
        this.state.workflows = this.state.workflows.slice(0, MAX_WORKFLOWS);
      }
    }

    this.state.activeWorkflowId = record.id;
    this.state.draft = {
      name: record.name,
      activeWorkflowId: record.id,
      graph,
      viewport,
      lastTaskPrompt,
      lastClusterReportMd: typeof payload.lastClusterReportMd === 'string' ? payload.lastClusterReportMd.slice(0, 60_000) : '',
      updatedAt: now,
    };

    await this._persist();
    return record;
  }

  async renameWorkflow(id, name) {
    const existing = this.get(String(id || '').trim());
    if (!existing) return null;
    const cleanName = String(name || '').trim().slice(0, 80);
    if (!cleanName) throw new Error('工作流名称不能为空');
    existing.name = cleanName;
    existing.updatedAt = new Date().toISOString();
    if (this.state.draft && this.state.draft.activeWorkflowId === existing.id) {
      this.state.draft.name = cleanName;
    }
    await this._persist();
    return existing;
  }

  async deleteWorkflow(id) {
    const cleanId = String(id || '').trim();
    const idx = this.state.workflows.findIndex((w) => w.id === cleanId);
    if (idx < 0) return false;
    this.state.workflows.splice(idx, 1);
    if (this.state.activeWorkflowId === cleanId) {
      this.state.activeWorkflowId = null;
    }
    if (this.state.draft && this.state.draft.activeWorkflowId === cleanId) {
      this.state.draft.activeWorkflowId = null;
    }
    await this._persist();
    return true;
  }
}
