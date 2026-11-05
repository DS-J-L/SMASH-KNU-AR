// Server-clock estimate at frame preparation, not sensor exposure or network send completion.
export function deviceTime(now) {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(11, 23) + ' KST';
}

export function serverClockLabel(clock) {
  const estimate = clock?.estimate();
  return estimate ? `${deviceTime(estimate.nowMs)} · ±${estimate.uncertaintyMs.toFixed(1)}ms(추정)` : '시각 동기화 대기';
}

export function drawTimedFrame(canvas, video, cameraId, clock, drawOverlay) {
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.round(video.videoWidth * scale), height = Math.round(video.videoHeight * scale);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext('2d');
  context.drawImage(video, 0, 0, width, height);
  drawOverlay?.(canvas);
  const label = `${cameraId} · 서버 기준 전송 준비 ${serverClockLabel(clock)}`;
  const font = Math.max(10, Math.min(16, width / 32));
  context.fillStyle = 'rgba(0, 0, 0, 0.8)';
  context.fillRect(0, 0, width, font + 18);
  context.font = `600 ${font}px monospace`;
  context.textBaseline = 'top';
  context.fillStyle = '#ffffff';
  context.fillText(label, 8, 8, width - 16);
  return label;
}
