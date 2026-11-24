import fs from 'node:fs/promises';
import path from 'node:path';

export class RunStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, 'runs.json');
    this.runs = new Map();
    this.subscribers = new Map(); // runId -> Set<res>
    this.globalSubscribers = new Set();
    this.saveTimer = null;
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item && item.id) {
            // Any run left in running or awaiting_approval state across server restart is marked interrupted
            if (item.status === 'running' || item.status === 'awaiting_approval') {
              item.status = 'interrupted';
              item.gate = null;
              item.updatedAt = new Date().toISOString();
            }
            this.runs.set(item.id, item);
          }
        }
      }
    } catch {
      // Fresh store
    }
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      try {
        await fs.mkdir(this.dataDir, { recursive: true });
        const ordered = this.list().slice(0, 60);
        const tmpPath = `${this.filePath}.${process.pid}.tmp`;
        await fs.writeFile(tmpPath, JSON.stringify(ordered, null, 2), 'utf8');
        await fs.rename(tmpPath, this.filePath);
      } catch (err) {
        console.error('[RunStore] Failed to persist runs:', err.message);
      }
    }, 300);
  }

  create(run) {
    this.runs.set(run.id, run);
    this.scheduleSave();
    this.broadcastGlobal('run_created', this.summarize(run));
    return run;
  }

  get(id) {
    return this.runs.get(id) || null;
  }

  list() {
    return Array.from(this.runs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  summarize(run) {
    return {
      id: run.id,
      mode: run.mode,
      title: run.title,
      pinned: Boolean(run.pinned),
      workspaceDir: run.workspaceDir,
      status: run.status,
      activeStage: run.activeStage,
      geminiModel: run.config?.geminiModel,
      codexModel: run.config?.codexModel || 'default',
      reviewRound: run.reviewRound || 0,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      metrics: run.metrics,
    };
  }

  remove(id) {
    const existed = this.runs.delete(id);
    if (!existed) return false;
    this.scheduleSave();
    this.broadcastGlobal('run_deleted', { id });
    return true;
  }

  update(id, mutator) {
    const run = this.runs.get(id);
    if (!run) return null;
    mutator(run);
    run.updatedAt = new Date().toISOString();
    this.scheduleSave();
    this.emit(id, 'state', run);
    this.broadcastGlobal('run_updated', this.summarize(run));
    return run;
  }

  appendEvent(id, event) {
    const run = this.runs.get(id);
    if (!run) return;
    const enriched = {
      ts: new Date().toISOString(),
      ...event,
    };
    run.events.push(enriched);
    if (run.events.length > 600) {
      run.events = run.events.slice(-600);
    }
    run.updatedAt = enriched.ts;
    this.scheduleSave();
    this.emit(id, 'event', enriched);
  }

  subscribe(id, res) {
    if (!this.subscribers.has(id)) {
      this.subscribers.set(id, new Set());
    }
    this.subscribers.get(id).add(res);
  }

  unsubscribe(id, res) {
    const set = this.subscribers.get(id);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) this.subscribers.delete(id);
  }

  subscribeGlobal(res) {
    this.globalSubscribers.add(res);
  }

  unsubscribeGlobal(res) {
    this.globalSubscribers.delete(res);
  }

  emit(id, eventName, payload) {
    const set = this.subscribers.get(id);
    if (!set || set.size === 0) return;
    const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of set) {
      try {
        res.write(data);
      } catch {
        set.delete(res);
      }
    }
  }

  broadcastGlobal(eventName, payload) {
    if (this.globalSubscribers.size === 0) return;
    const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of this.globalSubscribers) {
      try {
        res.write(data);
      } catch {
        this.globalSubscribers.delete(res);
      }
    }
  }
}
