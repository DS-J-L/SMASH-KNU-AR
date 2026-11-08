// Frame times use the common estimated server clock; arrival age uses PC monotonic time.
export class VideoTimeline {
  constructor({ staleMs = 1500, maxFrames = 32, toleranceMs = 120 } = {}) {
    this.cameras = new Map(); this.staleMs = staleMs; this.maxFrames = maxFrames;
    this.toleranceMs = toleranceMs; this.target = -Infinity;
  }
  setCameras(ids, now) {
    const wanted = new Set(ids);
    let changed = false;
    for (const id of this.cameras.keys()) if (!wanted.has(id)) { this.cameras.delete(id); changed = true; }
    for (const id of wanted) if (!this.cameras.has(id)) {
      this.cameras.set(id, { frames: [], receivedAt: now, lastId: -1 }); changed = true;
    }
    if (changed) this.target = -Infinity;
  }
  push(id, frame, now) {
    const camera = this.cameras.get(id), time = frame.prepared_at_server_ms;
    if (!camera || !Number.isFinite(time) || time < 0 || frame.frame_id <= camera.lastId) return false;
    const latest = camera.frames.at(-1);
    if (latest && time <= latest.prepared_at_server_ms) return false;
    // A resumed camera must not replay its old buffered history.
    if (now - camera.receivedAt > this.staleMs) { camera.frames = []; this.target = -Infinity; }
    camera.frames.push(frame); camera.lastId = frame.frame_id; camera.receivedAt = now;
    while (camera.frames.length > this.maxFrames) camera.frames.shift();
    return true;
  }
  select(now) {
    const active = [], stalled = [], waiting = [];
    for (const [id, camera] of this.cameras) {
      if (now - camera.receivedAt > this.staleMs) stalled.push(id);
      else if (!camera.frames.length) waiting.push(id);
      else active.push([id, camera]);
    }
    if (waiting.length) return { batch: null, state: 'waiting', stalled };
    if (!active.length) return { batch: null, state: 'empty', stalled };
    const target = Math.min(...active.map(([, camera]) => camera.frames.at(-1).prepared_at_server_ms));
    if (target <= this.target) return { batch: null, state: 'holding', stalled };
    const batch = [];
    for (const [id, camera] of active) {
      const frame = camera.frames.findLast(frame => frame.prepared_at_server_ms <= target);
      if (!frame || target - frame.prepared_at_server_ms > this.toleranceMs) return { batch: null, state: 'buffer_limit', stalled };
      batch.push({ id, frame });
    }
    this.target = target;
    for (const { id, frame } of batch) {
      const frames = this.cameras.get(id).frames;
      while (frames.length > 1 && frames[1].prepared_at_server_ms <= frame.prepared_at_server_ms) frames.shift();
    }
    return { batch, target, state: 'ready', stalled };
  }
}
