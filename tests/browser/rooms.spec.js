import { test, expect } from '@playwright/test';

async function camera(browser, baseURL, id, transport = 'webrtc') {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d'); let count = 0;
      const timer = setInterval(() => { ctx.fillStyle = count++ % 2 ? '#246040' : '#203050'; ctx.fillRect(0,0,640,480); }, 50);
      const stream = canvas.captureStream(20);
      stream.getTracks().forEach(track => track.addEventListener('ended', () => clearInterval(timer)));
      return stream;
    };
  });
  const page = await context.newPage();
  // Exercise the real room camera controller with deterministic synthetic wrist inference.
  await page.route('**/camera/pose.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    export async function createPoseLandmarker() {
      return { delegate: 'CPU', landmarker: { detectForVideo() {
        const points=[];
        for(const [i,x,y] of [[0,320,100],[11,120,180],[13,120,130],[15,120,80],[23,220,300],[25,240,380],[27,260,440]])
          points[i]={x:x/640,y:y/480,visibility:0.9};
        return {landmarks:[points]};
      }, close() {} } };
    }
    export function extractWrists() {
      return { left_wrist: { u_px: 120, v_px: 80, visibility: 0.9 }, right_wrist: null };
    }
  ` }));
  await page.goto(`${baseURL}/camera/room/?camera=${id}`);
  await page.locator('#transport').selectOption(transport);
  await page.getByRole('button', {name: '선택한 방 입장 · 영상 보내기'}).click();
  await expect(page.locator('#room-status')).toContainText('입장 완료');
  return { context, page };
}

test('one to three real RTC canvas feeds, responsive layout, leave and rejoin', async ({page, browser, baseURL}) => {
  test.setTimeout(90000);
  const cameras = [];
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('/monitor/room-1/');
    await expect(page.locator('#room-status')).toContainText('입장 완료');
    for (const id of ['C0','C1','C2']) {
      cameras.push(await camera(browser, baseURL, id, id === 'C0' ? 'webrtc' : 'server'));
      await expect(page.locator('.camera-tile')).toHaveCount(cameras.length);
      await expect.poll(() => page.locator(`[data-camera="${id}"] video`).evaluate(video => video.videoWidth)).toBe(640);
      await expect(page.locator(`[data-camera="${id}"] h3`)).toContainText(id === 'C0' ? 'WebRTC 직접' : '서버 중계');
    }
    expect(await page.locator('#camera-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(3);
    await page.setViewportSize({width: 390,height: 844});
    expect(await page.locator('#camera-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await cameras[1].page.getByRole('button', {name:'퇴장 · 카메라 끄기'}).click();
    await expect(page.locator('.camera-tile')).toHaveCount(2);
    await expect(page.locator('[data-camera="C0"] video')).toHaveJSProperty('videoWidth', 640);
    await page.getByRole('button',{name:'방 나가기'}).click();
    await expect(page).toHaveURL(/\/monitor\/$/);
    await page.goto('/monitor/room-1/');
    await expect(page.locator('.camera-tile')).toHaveCount(2);
    await expect.poll(() => page.locator('[data-camera="C2"] video').evaluate(v=>v.videoWidth)).toBe(640);
    await cameras[0].page.getByRole('button',{name:'퇴장 · 카메라 끄기'}).click();
    await expect(page.locator('[data-camera="C0"]')).toHaveCount(0);
    await cameras[0].page.locator('#transport').selectOption('server');
    await cameras[0].page.getByRole('button',{name:'선택한 방 입장 · 영상 보내기'}).click();
    await expect(page.locator('[data-camera="C0"] h3')).toContainText('서버 중계');
    await expect.poll(()=>page.locator('[data-camera="C0"] video').evaluate(v=>v.videoWidth)).toBe(640);
    expect(errors).toEqual([]);
  } finally { for (const camera of cameras) await camera.context.close(); }
});

test('cancel pending permission stops late tracks and keeps camera slot empty', async ({page}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.grant = resolve; });
  });
  await page.goto('/camera/room/');
  await page.getByRole('button',{name:'선택한 방 입장 · 영상 보내기'}).click();
  await page.getByRole('button',{name:'퇴장 · 카메라 끄기'}).click();
  await page.evaluate(() => {
    const track = { stop() { window.stopped = true; } };
    window.grant({ getTracks: () => [track] });
  });
  await expect.poll(()=>page.evaluate(()=>window.stopped)).toBe(true);
  await expect(page.locator('#room-status')).toHaveText('퇴장했습니다.');
  expect((await (await page.request.get('/api/single/rooms')).json()).rooms[0].camera_count).toBe(0);
});

test('server relay synchronizes clock and displays a real JPEG stream', async ({page,browser,baseURL}) => {
  await page.goto('/monitor/room-1/');
  await expect(page.locator('#room-status')).toContainText('입장 완료');
  const phone=await camera(browser,baseURL,'C0','server');
  try {
    await expect(page.locator('#viewer-clock')).toContainText('KST');
    await expect(phone.page.locator('#send-clock')).toContainText('KST');
    await expect(phone.page.locator('#pose-status')).toContainText('서버 수신 프레임');
    await expect(phone.page.locator('#pose-status')).toContainText('왼손(120, 80)');
    await expect.poll(()=>page.locator('[data-camera="C0"] video').evaluate(v=>v.videoWidth)).toBe(640);
    await expect(page.locator('#sync-status')).toContainText('1대 동기화');
    await expect.poll(()=>page.locator('[data-camera="C0"] video').evaluate(video=>{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
      const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0,640,480);
      const [r,g,b]=ctx.getImageData(120,80,1,1).data;
      return r>80 && g>140 && b>180;
    })).toBe(true);
    await expect.poll(()=>page.locator('[data-camera="C0"] video').evaluate(video=>{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
      const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0,640,480);
      const [r,g,b]=ctx.getImageData(120,105,1,1).data;
      return g>150 && g>r+20 && g>b+20;
    })).toBe(true);
    await expect.poll(()=>page.locator('[data-camera="C0"] video').evaluate(video=>{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
      const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0,640,480);
      const [r,g,b]=ctx.getImageData(320,100,1,1).data;
      return r>180 && g>160 && b<190;
    })).toBe(true);
    await phone.page.getByRole('button',{name:'퇴장 · 카메라 끄기'}).click();
    await page.getByRole('button',{name:'방 나가기'}).click();
  } finally { await Promise.race([phone.context.close(),new Promise(resolve=>setTimeout(resolve,2000))]); }
});
