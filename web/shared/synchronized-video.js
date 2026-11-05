import { VideoTimeline } from '/shared/video-timeline.js';
import { deviceTime } from '/shared/video-clock.js';
import { createRelayVideo } from '/shared/relay-video.js';

export function createSynchronizedVideo(onVideo, onSync, onFrame) {
  const timeline = new VideoTimeline(), surfaces = new Map();
  const fallback = new Map();
  let busy = false, closed = false, version = 0;
  let ids = new Map();
  function remove(id) {
    const surface = surfaces.get(id);
    if (surface) { surface.stream?.getTracks().forEach(track => track.stop()); onVideo(surface.cameraId, null, '영상 중단 · 동기화 제외'); surfaces.delete(id); }
  }
  async function tick() {
    if (busy || closed) return;
    for (const [id, entry] of fallback) if (performance.now() - entry.receivedAt > 1500) {
      entry.receiver.close(); fallback.delete(id);
      onVideo(entry.cameraId, null, '영상 중단');
    }
    const selected = timeline.select(performance.now());
    for (const id of selected.stalled) remove(id);
    if (!selected.batch) {
      if (fallback.size) { onSync?.('서버 시각 정보 없음 · 영상은 개별 표시 중(동기화 제외). 기기 새로고침 후 재입장하세요.'); return; }
      if (selected.state === 'waiting') onSync?.('카메라 시각/첫 프레임 동기화 대기');
      if (selected.state === 'empty') onSync?.('서버 중계 프레임 대기 · 중단 카메라는 1.5초 후 제외');
      if (selected.state === 'buffer_limit') onSync?.('동기화 버퍼 부족 · 영상 보류, 네트워크/시각 보정 확인');
      return;
    }
    busy = true;
    const generation = version;
    try {
      const images = await Promise.all(selected.batch.map(async ({ id, frame }) => {
        const image = new Image(); image.src = frame.data_url;
        let timeout;
        try {
          await Promise.race([image.decode(), new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('프레임 디코딩 시간 초과')), 1000);
          })]);
        } finally { clearTimeout(timeout); }
        if (image.naturalWidth > 1280 || image.naturalHeight > 1280) throw new Error('영상 크기 초과');
        return { id, image };
      }));
      if (closed || generation !== version) return;
      // Draw all decoded images in the same JS task, instead of each camera decoding/displaying independently.
      for (const { id, image } of images) {
        const cameraId = ids.get(id); if (!cameraId) continue;
        if (fallback.has(id)) { fallback.get(id).receiver.close(); fallback.delete(id); }
        let surface = surfaces.get(id);
        if (!surface) { surface = { canvas: document.createElement('canvas'), stream: null, cameraId }; surfaces.set(id, surface); }
        if (surface.canvas.width !== image.naturalWidth) surface.canvas.width = image.naturalWidth;
        if (surface.canvas.height !== image.naturalHeight) surface.canvas.height = image.naturalHeight;
        surface.canvas.getContext('2d').drawImage(image, 0, 0);
        if (!surface.stream) {
          surface.stream = surface.canvas.captureStream(15);
          onVideo(cameraId, surface.stream, '서버 중계 · 가장 늦은 프레임 기준 동기화');
        }
        surface.stream.getVideoTracks()[0]?.requestFrame?.();
        onFrame?.(cameraId);
      }
      onSync?.(`서버 중계 ${images.length}대 동기화 · 표시 기준 ${deviceTime(selected.target)}${fallback.size ? ' · 시각 없는 영상은 개별 표시' : selected.stalled.length ? ' · 중단 카메라 제외' : ''}`);
    } catch (error) { if (!closed) onSync?.(`동기화 표시 실패: ${error.message}`); }
    finally { busy = false; }
  }
  const timer = setInterval(() => void tick(), 1000 / 15);
  return {
    setCameras(cameras) {
      const next = new Map(cameras.map(c => [c.connection_id, c.camera_id]));
      if ([...ids.keys()].some(id => !next.has(id)) || [...next.keys()].some(id => !ids.has(id))) version++;
      for (const id of surfaces.keys()) if (!next.has(id)) remove(id);
      for (const [id, entry] of fallback) if (!next.has(id)) { entry.receiver.close(); fallback.delete(id); }
      ids = next; timeline.setCameras([...next.keys()], performance.now());
    },
    push(message) {
      const id = message.from_connection_id, cameraId = ids.get(id);
      if (!cameraId) return;
      if (!Number.isFinite(message.prepared_at_server_ms)) {
        remove(id);
        let entry = fallback.get(id);
        if (!entry) {
          entry = { cameraId, receiver: createRelayVideo(
            stream => { if (!closed && fallback.get(id) === entry) onVideo(cameraId, stream, '시각 동기화 대기 · 개별 영상 표시'); },
            note => { if (!closed && fallback.get(id) === entry) onVideo(cameraId, undefined, `동기화 제외 · ${note}`); },
            () => { if (!closed && fallback.get(id) === entry) onFrame?.(cameraId); }) };
          fallback.set(id, entry);
        }
        entry.receivedAt = performance.now(); entry.receiver.push(message);
      } else timeline.push(id, message, performance.now());
    },
    close() {
      closed = true; version++; clearInterval(timer);
      for (const id of [...surfaces.keys()]) remove(id);
      for (const entry of fallback.values()) entry.receiver.close();
      fallback.clear();
    },
  };
}
