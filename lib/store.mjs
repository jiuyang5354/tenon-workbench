import fs from 'node:fs/promises';
import path from 'node:path';

const RETRYABLE_FS_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isResponseWritable(res) {
  return Boolean(res && !res.writableEnded && !res.destroyed && !res.closed && res.writable !== false);
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

    // Windows fallback when antivirus/indexer holds a brief exclusive rename lock on target file
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

export class RunStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, 'runs.json');
    this.runs = new Map();
    this.subscribers = new Map(); // runId -> Set<res>
    this.globalSubscribers = new Set();
    this.saveTimer = null;
    this._saveDirty = false;
    this._saveInFlight = null;
    this._disposed = false;
    this._runCleanupHooks = new WeakMap();
    this._globalCleanupHooks = new WeakMap();
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    let recovered = false;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        const nowIso = new Date().toISOString();
        for (const item of list) {
          if (item && item.id) {
            let itemChanged = false;
            if (!Array.isArray(item.events)) {
              item.events = [];
              itemChanged = true;
            }
            // Any run left in running or awaiting_approval state across server restart is marked interrupted
            if (item.status === 'running' || item.status === 'awaiting_approval') {
              item.status = 'interrupted';
              item.gate = null;
              itemChanged = true;
            }
            if (item.gemini && item.gemini.status === 'running') {
              item.gemini.status = 'interrupted';
              itemChanged = true;
            }
            if (item.codex && item.codex.status === 'running') {
              item.codex.status = 'interrupted';
              itemChanged = true;
            }
            if (Array.isArray(item.messages)) {
              for (const msg of item.messages) {
                if (!msg || typeof msg !== 'object') continue;
                if (msg.status === 'running') {
                  msg.status = 'interrupted';
                  msg.liveStep = null;
                  if (!msg.error) {
                    msg.error = '服务重启导致本次回复中断';
                  }
                  itemChanged = true;
                } else if (msg.liveStep) {
                  msg.liveStep = null;
                  itemChanged = true;
                }
                if (Array.isArray(msg.trace)) {
                  for (const step of msg.trace) {
                    if (step && step.status === 'running') {
                      step.status = 'error';
                      itemChanged = true;
                    }
                  }
                }
              }
            }
            if (itemChanged) {
              item.updatedAt = nowIso;
              recovered = true;
            }
            this.runs.set(item.id, item);
          }
        }
      }
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        console.warn('[RunStore] Could not load persisted runs:', err.message);
      }
    }
    if (recovered) {
      this.scheduleSave();
    }
  }

  scheduleSave() {
    this._saveDirty = true;
    if (this._disposed) return;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this._drainSaveQueue();
    }, 300);
    if (typeof this.saveTimer.unref === 'function') {
      this.saveTimer.unref();
    }
  }

  async _drainSaveQueue() {
    if (this._saveInFlight) {
      return this._saveInFlight;
    }
    this._saveInFlight = (async () => {
      while (this._saveDirty && !this._disposed) {
        this._saveDirty = false;
        try {
          const ordered = this.list().slice(0, 60);
          await atomicWriteFile(this.filePath, JSON.stringify(ordered, null, 2));
        } catch (err) {
          console.error('[RunStore] Failed to persist runs:', err.message);
        }
      }
    })();
    try {
      await this._saveInFlight;
    } finally {
      this._saveInFlight = null;
      if (this._saveDirty && !this._disposed) {
        void this._drainSaveQueue();
      }
    }
  }

  async flush() {
    if (this._disposed) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    while ((this._saveDirty || this._saveInFlight) && !this._disposed) {
      if (this._saveInFlight) {
        await this._saveInFlight;
      } else {
        await this._drainSaveQueue();
      }
    }
  }

  dispose() {
    this._disposed = true;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.closeAllStreams();
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
    const set = this.subscribers.get(id);
    if (set) {
      for (const res of Array.from(set)) {
        this.unsubscribe(id, res);
        try {
          if (isResponseWritable(res)) {
            res.write(`event: deleted\ndata: ${JSON.stringify({ id })}\n\n`);
            res.end();
          }
        } catch {
          // Ignore closed stream
        }
      }
      this.subscribers.delete(id);
    }
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
    if (!Array.isArray(run.events)) run.events = [];
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
    if (!isResponseWritable(res)) return;
    if (!this.subscribers.has(id)) {
      this.subscribers.set(id, new Set());
    }
    const set = this.subscribers.get(id);
    if (set.has(res)) return;
    set.add(res);
    if (typeof res.once === 'function') {
      const onClose = () => this.unsubscribe(id, res);
      let hooks = this._runCleanupHooks.get(res);
      if (!hooks) {
        hooks = new Map();
        this._runCleanupHooks.set(res, hooks);
      }
      hooks.set(id, onClose);
      res.once('close', onClose);
      res.once('error', onClose);
    }
  }

  unsubscribe(id, res) {
    const set = this.subscribers.get(id);
    if (set) {
      set.delete(res);
      if (set.size === 0) this.subscribers.delete(id);
    }
    const hooks = res ? this._runCleanupHooks.get(res) : null;
    const onClose = hooks?.get(id);
    if (onClose && typeof res?.removeListener === 'function') {
      res.removeListener('close', onClose);
      res.removeListener('error', onClose);
      hooks.delete(id);
    }
  }

  subscribeGlobal(res) {
    if (!isResponseWritable(res)) return;
    if (this.globalSubscribers.has(res)) return;
    this.globalSubscribers.add(res);
    if (typeof res.once === 'function') {
      const onClose = () => this.unsubscribeGlobal(res);
      this._globalCleanupHooks.set(res, onClose);
      res.once('close', onClose);
      res.once('error', onClose);
    }
  }

  unsubscribeGlobal(res) {
    this.globalSubscribers.delete(res);
    const onClose = res ? this._globalCleanupHooks.get(res) : null;
    if (onClose && typeof res?.removeListener === 'function') {
      res.removeListener('close', onClose);
      res.removeListener('error', onClose);
      this._globalCleanupHooks.delete(res);
    }
  }

  closeAllStreams() {
    for (const [id, set] of Array.from(this.subscribers.entries())) {
      for (const res of Array.from(set)) {
        this.unsubscribe(id, res);
        try {
          if (!res.writableEnded && !res.destroyed) res.end();
        } catch {
          // Ignore
        }
      }
    }
    this.subscribers.clear();

    for (const res of Array.from(this.globalSubscribers)) {
      this.unsubscribeGlobal(res);
      try {
        if (!res.writableEnded && !res.destroyed) res.end();
      } catch {
        // Ignore
      }
    }
    this.globalSubscribers.clear();
  }

  emit(id, eventName, payload) {
    const set = this.subscribers.get(id);
    if (!set || set.size === 0) return;
    const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of Array.from(set)) {
      if (!isResponseWritable(res)) {
        this.unsubscribe(id, res);
        continue;
      }
      try {
        res.write(data);
      } catch {
        this.unsubscribe(id, res);
      }
    }
  }

  broadcastGlobal(eventName, payload) {
    if (this.globalSubscribers.size === 0) return;
    const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of Array.from(this.globalSubscribers)) {
      if (!isResponseWritable(res)) {
        this.unsubscribeGlobal(res);
        continue;
      }
      try {
        res.write(data);
      } catch {
        this.unsubscribeGlobal(res);
      }
    }
  }
}
