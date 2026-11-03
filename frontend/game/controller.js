const JOINTS = ['left_wrist', 'right_wrist'];
export const SINGLE_GATES = ['control_bound', 'control_alive', 'selected_stream_live', 'model_ready', 'transform_ready', 'scene_ready'];
const norm = a => Array.isArray(a) && a.length === 2 && a.every(v => Number.isFinite(v) && v >= 0 && v <= 1);
const wristValid = w => w?.valid === true && norm(w.image_norm) && Number.isFinite(w.visibility) && w.visibility >= .5;

export class GameController {
  constructor({ trackingMode = 'single_view_2d', source = 'live', taskType = 'pilot',
    now = () => performance.now(), uuid = () => crypto.randomUUID(), durationMs = 60000,
    ttlMs = 200, startTimeoutMs = 8000, onHit = () => true, onLog = () => {}, validateHit = () => false } = {}) {
    if (!['single_view_2d', 'keyboard_demo'].includes(trackingMode) || !['live', 'synthetic', 'replay'].includes(source) ||
        trackingMode === 'keyboard_demo' && source !== 'synthetic') throw new Error('unsupported_mode');
    Object.assign(this, { trackingMode, source, taskType, now, uuid, durationMs, ttlMs, startTimeoutMs, onHit, onLog, validateHit });
    this.gates = {}; this.context = null; this.generation = 0; this.reset();
  }
  reset() {
    this.generation++; this.phase = this.trackingMode === 'keyboard_demo' ? 'ready' : 'idle';
    this.score = 0; this.sessionId = null; this.endsAt = 0; this.seenEvents = new Set(); this.destroyed = new Set();
    this.pose = null; this.previous = {}; this.pairs = {}; this.reason = null; this.pendingRequest = null;
  }
  bind(context) {
    if (this.context && ['room_id', 'stream_id', 'server_epoch'].some(k => context[k] !== this.context[k])) this.abort('binding_changed');
    this.context = { ...context }; this.clearInput();
  }
  clearInput() { this.pose = null; this.previous = {}; this.pairs = {}; }
  setGates(gates) { Object.assign(this.gates, gates); }
  fresh() { return this.pose && this.now()-this.pose.observed_at_pc_ms >= 0 && this.now()-this.pose.observed_at_pc_ms < this.ttlMs; }
  ready() { return SINGLE_GATES.every(k => this.gates[k] === true) && this.fresh() && JOINTS.some(k => wristValid(this.pose.wrists?.[k])); }
  setPose(pose) {
    if (!this.context || pose?.schema !== 'single_camera.v1-draft' || ['room_id','stream_id','run_id','transform_version'].some(k => pose[k] !== this.context[k]) ||
        pose.tracking_mode !== this.trackingMode || pose.source !== this.source || pose.task_type !== this.taskType ||
        (this.phase === 'playing' && pose.session_id !== this.sessionId) ||
        !Number.isSafeInteger(pose.frame_id) || !Number.isFinite(pose.observed_at_pc_ms) ||
        pose.observed_at_pc_ms > this.now() || this.now()-pose.observed_at_pc_ms >= this.ttlMs ||
        this.pose && pose.frame_id <= this.pose.frame_id) return false;
    this.pose = structuredClone(pose); this.pairs = {};
    for (const joint of JOINTS) {
      const prev = this.previous[joint];
      if (wristValid(pose.wrists?.[joint])) {
        const dt = pose.observed_at_pc_ms - (prev?.observed_at_pc_ms ?? pose.observed_at_pc_ms);
        if (prev && dt > 0 && dt < this.ttlMs) this.pairs[joint] = [prev.frame_id, pose.frame_id];
        this.previous[joint] = { frame_id: pose.frame_id, observed_at_pc_ms: pose.observed_at_pc_ms };
      } else delete this.previous[joint];
    }
    return true;
  }
  async start(sendStart) {
    this.tick();
    if (!['idle','ready'].includes(this.phase) || !this.ready()) return false;
    const generation = this.generation;
    const request = { schema: 'single_camera.v1-draft', type: 'start', request_id: this.uuid(), session_id: this.uuid(),
      room_id: this.context.room_id, stream_id: this.context.stream_id, server_epoch: this.context.server_epoch,
      tracking_mode: this.trackingMode, source: this.source, task_type: this.taskType, config_version: 'single-monitor-1' };
    this.pendingRequest = request; this.phase = 'starting'; let timer;
    try {
      const ack = await Promise.race([Promise.resolve().then(() => {
        if(generation!==this.generation||this.phase!=='starting')throw new Error('start_cancelled');
        return sendStart(request);
      }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('start_timeout')), this.startTimeoutMs); })]);
      if (generation !== this.generation || this.phase !== 'starting') return false;
      if (ack?.type !== 'start_ack' || ['request_id','session_id','room_id','stream_id','server_epoch','tracking_mode','source','task_type','config_version'].some(k => ack[k] !== request[k])) throw new Error('ack_mismatch');
      if (!this.ready()) throw new Error('readiness_lost');
      this.sessionId = request.session_id; this.endsAt = this.now()+this.durationMs; this.phase = 'playing'; this.reason = null;
      this.clearInput(); this.emitLog({ ...request, type: 'started' }); return true;
    } catch (error) {
      if (generation === this.generation && this.phase === 'starting') { this.phase = 'idle'; this.reason = error.message; }
      return false;
    } finally { clearTimeout(timer); if (this.pendingRequest === request) this.pendingRequest = null; }
  }
  startKeyboard() {
    if (this.trackingMode !== 'keyboard_demo' || this.phase !== 'ready') return false;
    this.sessionId = this.uuid(); this.phase = 'playing'; this.endsAt = this.now()+this.durationMs; return true;
  }
  tick() {
    if(this.trackingMode === 'single_view_2d' && ['idle','ready'].includes(this.phase)) this.phase=this.ready()?'ready':'idle';
    if (this.phase === 'playing' && this.now() >= this.endsAt) {
      this.phase = 'ended'; this.reason = 'time_up';
      this.emitLog({type:'ended',session_id:this.sessionId,tracking_mode:this.trackingMode,source:this.source,task_type:this.taskType,reason:this.reason});
    }
  }
  abort(reason) { if (['playing','starting'].includes(this.phase)) { this.phase = 'ended'; this.reason = reason; } this.generation++; this.clearInput(); }
  remainingMs() { this.tick(); return this.phase === 'playing' ? Math.max(0, this.endsAt-this.now()) : this.phase === 'ended' ? 0 : this.durationMs; }
  acceptKeyboard(eventId, buildingId) {
    this.tick(); if (this.phase === 'ready') this.startKeyboard();
    if (this.trackingMode !== 'keyboard_demo' || this.phase !== 'playing' || this.seenEvents.has(eventId) || this.destroyed.has(buildingId)) return false;
    this.seenEvents.add(eventId); this.destroyed.add(buildingId); this.score += 100; return true;
  }
  acceptHit(event, { visible = true } = {}) {
    this.tick(); let reason = null;
    if (this.trackingMode !== 'single_view_2d' || this.phase !== 'playing') reason = 'not_playing';
    else if (!visible || !this.ready()) reason = 'not_ready';
    else if (!event || ['room_id','stream_id','run_id','transform_version'].some(k => event[k] !== this.context[k]) ||
      event.session_id !== this.sessionId || event.tracking_mode !== this.trackingMode || event.source !== this.source ||
      event.task_type !== this.taskType || event.schema !== 'single_camera.v1-draft') reason = 'context_mismatch';
    else if (typeof event.event_id !== 'string' || !event.event_id || event.event_id.length > 128 ||
      !JOINTS.includes(event.joint) || !Number.isSafeInteger(event.frame_id) || !Number.isSafeInteger(event.previous_frame_id) ||
      event.previous_frame_id<0 || event.frame_id<=event.previous_frame_id ||
      !norm(event.hit_point_image_norm) || !Number.isFinite(event.speed_norm_per_s) || event.speed_norm_per_s < 0 ||
      event.hit_point_m !== null || event.speed_mps !== null) reason = 'invalid_units_or_fields';
    else if (this.seenEvents.has(event.event_id)) reason = 'duplicate_event';
    else if (this.destroyed.has(event.building_id)) reason = 'already_destroyed';
    else if (!this.pairs[event.joint] || this.pairs[event.joint][0] !== event.previous_frame_id ||
      this.pairs[event.joint][1] !== event.frame_id || !this.validateHit(event)) reason = 'invalid_target_or_trajectory';
    else {
      try { if (this.onHit(event) === false) reason = 'effect_failed'; }
      catch { reason = 'effect_failed'; this.abort(reason); }
    }
    if (!reason) { this.seenEvents.add(event.event_id); this.destroyed.add(event.building_id); this.score += 100; }
    const result = { accepted: !reason, reject_reason: reason, score_delta: reason ? 0 : 100 };
    this.emitLog({ type:'hit_result', event_id: event?.event_id ?? null, session_id: this.sessionId, tracking_mode: this.trackingMode,
      room_id:this.context?.room_id??null,stream_id:this.context?.stream_id??null,run_id:this.context?.run_id??null,transform_version:this.context?.transform_version??null,
      frame_id:Number.isSafeInteger(event?.frame_id)?event.frame_id:null,previous_frame_id:Number.isSafeInteger(event?.previous_frame_id)?event.previous_frame_id:null,
      building_id:typeof event?.building_id==='string'?event.building_id:null,joint:JOINTS.includes(event?.joint)?event.joint:null,
      source: this.source, task_type: this.taskType, game_elapsed_ms: Math.max(0, this.durationMs-this.remainingMs()), ...result });
    return result;
  }
  emitLog(entry) { try { this.onLog(entry); } catch { this.logFailed = true; } }
  snapshot() { this.tick(); return { phase: this.phase, score: this.score, sessionId: this.sessionId,
    remainingMs: this.remainingMs(), reason: this.reason, ready: Boolean(this.ready()), seenEvents: this.seenEvents.size,
    destroyed: [...this.destroyed], source: this.source, tracking_mode: this.trackingMode }; }
}
