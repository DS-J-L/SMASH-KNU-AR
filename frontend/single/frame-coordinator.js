export const FRAME_KEYS = ['room_id', 'stream_id', 'run_id', 'transform_version'];
const matches = (a, b) => FRAME_KEYS.every(k => a?.[k] === b?.[k]);
const close = resource => resource?.close?.();

// Processor borrows the resource until its promise settles. A Worker must clone it before transfer.
export class FrameCoordinator {
  constructor({ process, onMatched, onInvalid = () => {}, now = () => performance.now(), ttlMs = 200 }) {
    Object.assign(this, { process, onMatched, onInvalid, now, ttlMs });
    this.context = null; this.generation = 0; this.pending = null; this.displayed = null;
    this.busy = false; this.disposed = false; this.lastFrame = -1;
    this.stats = { submitted: 0, processed: 0, dropped: 0, failed: 0, maxPending: 0, lastProcessMs: 0, maxProcessMs: 0, lastFrameAgeMs: 0 };
  }
  configure(context) {
    this.generation++; this.context = { ...context }; this.lastFrame = -1;
    close(this.pending?.resource); this.pending = null;
    close(this.displayed?.resource); this.displayed = null;
  }
  submit(resource, meta) {
    if (this.disposed || !matches(meta, this.context) || !Number.isSafeInteger(meta.frame_id) ||
        meta.frame_id <= this.lastFrame || !Number.isFinite(meta.observed_at_pc_ms) ||
        meta.observed_at_pc_ms > this.now() || this.now()-meta.observed_at_pc_ms >= this.ttlMs) {
      close(resource); this.stats.dropped++; return false;
    }
    this.lastFrame = meta.frame_id; this.stats.submitted++;
    if (this.pending) { close(this.pending.resource); this.stats.dropped++; }
    this.pending = { resource, meta: { ...meta }, generation: this.generation };
    this.stats.maxPending = Math.max(this.stats.maxPending, 1);
    void this.drain(); return true;
  }
  async drain() {
    if (this.busy || this.disposed) return;
    this.busy = true;
    try {
      while (this.pending && !this.disposed) {
        const item = this.pending; this.pending = null;
        let retained = false;
        try {
          const start = this.now();
          const result = await this.process(item.resource, item.meta);
          this.stats.lastProcessMs=this.now()-start;
          this.stats.maxProcessMs=Math.max(this.stats.maxProcessMs,this.stats.lastProcessMs);
          this.stats.lastFrameAgeMs=this.now()-item.meta.observed_at_pc_ms;
          if (this.disposed || item.generation !== this.generation || !matches(item.meta, this.context) ||
              this.now()-item.meta.observed_at_pc_ms >= this.ttlMs) { this.stats.dropped++; continue; }
          if (!result || !matches(result, item.meta) || ['frame_id','image_width','image_height','observed_at_pc_ms','session_id','source','tracking_mode','task_type'].some(k=>result[k]!==item.meta[k])) {
            throw new Error('pose_frame_mismatch');
          }
          if(this.onMatched(item.resource, item.meta, result)===false){this.stats.dropped++;continue;}
          close(this.displayed?.resource); this.displayed = item; retained = true;
          this.stats.processed++;
        } catch (error) {
          this.stats.failed++;
          if (item.generation === this.generation && !this.disposed) this.onInvalid(error);
        } finally { if (!retained) close(item.resource); }
      }
    } finally { this.busy = false; }
  }
  dispose() { this.disposed = true; this.configure(null); }
}
