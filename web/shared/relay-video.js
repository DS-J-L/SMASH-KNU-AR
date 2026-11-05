// JPEG relay display: at most one image decoding and one latest pending image.
export function createRelayVideo(onStream, onStats, onFrame) {
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  let stream = null, pending = null, busy = false, closed = false;
  let count = 0, since = performance.now(), lastFrame = -1;
  async function draw() {
    if (busy || closed) return;
    busy = true;
    try {
      while (pending && !closed) {
        const frame = pending; pending = null;
        const image = new Image(); image.src = frame.data_url;
        await image.decode();
        if (closed) break;
        if (image.naturalWidth > 1280 || image.naturalHeight > 1280) throw new Error('영상 크기 초과');
        if (canvas.width !== image.naturalWidth) canvas.width = image.naturalWidth;
        if (canvas.height !== image.naturalHeight) canvas.height = image.naturalHeight;
        context.drawImage(image, 0, 0);
        if (!stream) { stream = canvas.captureStream(15); onStream(stream); }
        stream.getVideoTracks()[0]?.requestFrame?.();
        onFrame?.(frame,canvas);
        count++;
        const now = performance.now();
        if (now - since >= 1000) { onStats?.(`${(count * 1000 / (now - since)).toFixed(1)} FPS`); count = 0; since = now; }
      }
    } catch (error) { if (!closed) onStats?.(`영상 표시 실패: ${error.message}`); }
    finally { busy = false; }
  }
  return {
    push(frame) { if (closed || frame.frame_id <= lastFrame) return; lastFrame = frame.frame_id; pending = frame; void draw(); },
    close() { closed = true; pending = null; stream?.getTracks().forEach(track => track.stop()); },
  };
}
