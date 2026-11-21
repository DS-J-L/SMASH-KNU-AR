// Phone page helpers shared by the 1-camera and 3-camera test pages:
//  - a magnifier that is a real DOM element above every panel (it used to be painted on the video
//    canvas, so the step sheet and top bar covered it),
//  - a button that hides/shows all overlay panels,
//  - drag handles that move the step sheet and the status panel.
const ZOOM = 4;
let loupeCanvas = null;

function ensureLoupe() {
  if (loupeCanvas) return loupeCanvas;
  loupeCanvas = document.createElement('canvas');
  loupeCanvas.id = 'loupe'; loupeCanvas.hidden = true; loupeCanvas.setAttribute('aria-hidden', 'true');
  document.body.append(loupeCanvas);
  return loupeCanvas;
}

export function hideLoupe() { if (loupeCanvas) loupeCanvas.hidden = true; }

// source: frozen frame canvas; point: [x, y] in source pixels; finger: [clientX, clientY] of the touch.
export function showLoupe(source, point, finger, { mirrored = false } = {}) {
  const canvas = ensureLoupe();
  const size = Math.round(Math.max(120, Math.min(190, Math.min(innerWidth, innerHeight) * 0.38)));
  if (canvas.width !== size * 2 || canvas.height !== size * 2) { canvas.width = size * 2; canvas.height = size * 2; }
  canvas.style.width = canvas.style.height = size + 'px';
  // Always above the finger's side of the screen: opposite horizontal half, just below the top bar.
  const margin = 10, onLeftHalf = finger[0] < innerWidth / 2;
  const topBar = document.getElementById('topbar')?.getBoundingClientRect().bottom ?? 0;
  canvas.style.left = onLeftHalf ? '' : margin + 'px';
  canvas.style.right = onLeftHalf ? margin + 'px' : '';
  canvas.style.top = Math.round(topBar + margin) + 'px';
  const srcSize = Math.min(source.width, source.height) * 0.1, c = canvas.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0); c.imageSmoothingEnabled = false; c.fillStyle = '#000'; c.fillRect(0, 0, canvas.width, canvas.height);
  c.save();
  if (mirrored) { c.translate(canvas.width, 0); c.scale(-1, 1); }
  c.drawImage(source, point[0] - srcSize / 2, point[1] - srcSize / 2, srcSize, srcSize, 0, 0, canvas.width, canvas.height);
  c.restore();
  c.strokeStyle = '#ef4444'; c.lineWidth = 2; c.beginPath();
  c.moveTo(canvas.width / 2, 0); c.lineTo(canvas.width / 2, canvas.height);
  c.moveTo(0, canvas.height / 2); c.lineTo(canvas.width, canvas.height / 2); c.stroke();
  canvas.hidden = false;
}
export const LOUPE_ZOOM = ZOOM;

function readOffset(el) {
  return [Number(el.dataset.dx) || 0, Number(el.dataset.dy) || 0];
}
function setOffset(el, dx, dy) {
  el.dataset.dx = String(Math.round(dx)); el.dataset.dy = String(Math.round(dy));
  el.style.translate = dx || dy ? `${Math.round(dx)}px ${Math.round(dy)}px` : '';
}
export function resetPanelPosition(el) { if (el) setOffset(el, 0, 0); }

// Drag `el` by `handle`. A drag shorter than `slop` pixels is left to the handle's normal click.
export function makeMovable(el, handle, { slop = 8 } = {}) {
  if (!el || !handle) return;
  handle.style.touchAction = 'none';
  let start = null, moved = false;
  handle.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY, off: readOffset(el), id: e.pointerId }; moved = false;
    try { handle.setPointerCapture(e.pointerId); } catch { /* capture is optional */ }
  });
  handle.addEventListener('pointermove', e => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < slop) return;
    moved = true;
    el.style.translate = '';
    const r = el.getBoundingClientRect();           // position without the current offset
    let nx = start.off[0] + dx, ny = start.off[1] + dy;
    // Keep at least a grab-sized corner of the panel on screen.
    const keep = 48, baseLeft = r.left, baseTop = r.top;
    nx = Math.min(innerWidth - keep - baseLeft, Math.max(keep - r.right, nx));
    ny = Math.min(innerHeight - keep - baseTop, Math.max(-baseTop, ny));
    setOffset(el, nx, ny);
    e.preventDefault();
  });
  const end = e => {
    if (!start || e.pointerId !== start.id) return;
    start = null;
    try { handle.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };
  handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  // Swallow the click that follows a drag so the sheet does not also collapse.
  handle.addEventListener('click', e => { if (moved) { e.stopImmediatePropagation(); e.preventDefault(); moved = false; } }, true);
}

// Hide/show every overlay panel (sheet, status, banner) so the camera image can be seen unobstructed.
export function initOverlayToggle(button) {
  if (!button) return;
  const apply = hidden => {
    document.body.classList.toggle('ui-hidden', hidden);
    button.setAttribute('aria-pressed', String(hidden));
    button.textContent = hidden ? '◐' : '◉';
    button.setAttribute('aria-label', hidden ? '안내 패널 보이기' : '안내 패널 숨기기');
  };
  button.addEventListener('click', () => apply(!document.body.classList.contains('ui-hidden')));
  apply(false);
}
