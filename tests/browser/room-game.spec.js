import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

async function setup(page, {holdStart=false,holdStop=false}={}) {
  let activeRoom='room-1', session=null, starts=[], stops=[], cameras=['C0'], sendStatus=null, sendAck=null, stopAck=null;
  const finish=(reason)=>{if(session?.state==='playing')session={...session,state:'ended',remaining_ms:0,elapsed_ms:reason==='time_up'?60000:12500,reason};};
  await page.route('https://room-ui.test/**',async route=>{
    let pathname=new URL(route.request().url()).pathname;
    if(pathname==='/api/single/rooms') {
      await route.fulfill({json:{rooms:[1,2].map(i=>({room_id:`room-${i}`,monitor_connected:false,camera_count:0,max_cameras:i===2?1:3,game:null}))}});return;
    }
    if(pathname.startsWith('/api/single/rooms/') && pathname.endsWith('.svg')) {
      await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="white"/></svg>'}); return;
    }
    if(/^\/monitor\/room-[12]\/$/.test(pathname))pathname='/monitor/room/index.html';
    else if(pathname.endsWith('/'))pathname+='index.html';
    try {
      const body=await readFile(path.join(process.cwd(),'web',pathname));
      await route.fulfill({body,contentType:pathname.endsWith('.js')?'application/javascript':pathname.endsWith('.css')?'text/css':'text/html'});
    }catch{await route.fulfill({status:404,body:'missing'});}
  });
  await page.routeWebSocket('**/ws/status',ws=>ws.send(JSON.stringify({type:'system_status',message:'test'})));
  await page.routeWebSocket('**/ws/single/signaling',ws=>{
    const send=msg=>ws.send(JSON.stringify(msg));
    ws.onMessage(raw=>{
      const msg=JSON.parse(String(raw));
      if(msg.type==='join') {
        activeRoom=msg.room_id;
        send({type:'joined',room_id:activeRoom,connection_id:'pc',server_epoch:'test',heartbeat_interval_ms:1000,heartbeat_timeout_ms:5000});
        sendStatus=()=>send({type:'room_status',room_id:activeRoom,monitor_connected:true,monitor_connection_id:'pc',cameras:cameras.map(id=>({camera_id:id,connection_id:id.toLowerCase(),connected:true,transport:'server'})),game:session});
        sendStatus();
      } else if(msg.type==='start_game') {
        starts.push(msg);
        session={room_id:activeRoom,session_id:msg.session_id,state:'playing',remaining_ms:60000,elapsed_ms:0,camera_ids:msg.cameras.map(c=>c.camera_id),score:null,reason:null};
        sendAck=()=>send({type:'game_ack',game:session});
        if(!holdStart)sendAck();
      } else if(msg.type==='stop_game') {
        stops.push(msg);stopAck=()=>{finish(msg.reason);send({type:'game_status',game:session});};if(!holdStop)stopAck();
      } else if(msg.type==='get_game_status') send({type:'game_status',game:session});
      else if(msg.type==='ping') send({type:'pong'});
      else if(msg.type==='leave')ws.close();
    });
  });
  await page.clock.install(); await page.goto('https://room-ui.test/monitor/');
  return {starts,stops,end(){finish('time_up');sendStatus?.();},ack(){sendAck?.();},stopAck(){stopAck?.();},setScore(score){session.score=score;sendStatus?.();},setCameras(ids){cameras=ids;if(session?.camera_ids.some(id=>!ids.includes(id)))finish('camera_disconnected');sendStatus?.();}};
}

async function freshVideos(page) {
  await page.locator('.camera-tile').first().waitFor({state:'attached'});
  await page.evaluate(()=>{
    for(const video of document.querySelectorAll('.camera-tile video')){
      Object.defineProperty(video,'requestVideoFrameCallback',{value:undefined});
      Object.defineProperty(video,'readyState',{value:4});
      Object.defineProperty(video,'videoWidth',{value:640});
      Object.defineProperty(video,'currentTime',{configurable:true,get:()=>performance.now()/1000});
    }
  });
  await page.clock.runFor(200);
}

test('room buttons require PC entry and fresh video before starting',async({page})=>{
  const server=await setup(page);
  await expect(page.locator('.room-cards a')).toHaveCount(2);
  await expect(page.locator('#game-start')).toHaveCount(0);
  await page.getByRole('link',{name:'room-2 PC 입장'}).click();
  await expect(page).toHaveURL('https://room-ui.test/monitor/room-2/');
  await expect(page.locator('#room-status')).toContainText('room-2');
  await expect(page.locator('[data-start="room-2"]')).toBeDisabled();
  await expect(page.locator('#game-checks')).toContainText('✕ 연결된 모든 카메라의 최신 영상');
  expect(server.starts).toHaveLength(0);
  await page.locator('#qr-sheet summary').click();
  await expect(page.locator('.qr-card')).toHaveCount(1);
  expect(await page.locator('.qr-card a').evaluateAll(nodes=>nodes.every(n=>n.href.includes('room=room-2')))).toBe(true);
});

test('server ACK starts sixty seconds, result appears and new round uses a new session',async({page})=>{
  const server=await setup(page);
  await page.getByRole('link',{name:'room-2 PC 입장'}).click();
  await expect(page.locator('.camera-tile')).toHaveCount(1);
  await freshVideos(page);
  await page.locator('[data-start="room-2"]').click();
  await expect(page.locator('#game-status')).toContainText('진행 중');
  expect(server.starts).toHaveLength(1);
  expect(server.starts[0].room_id).toBe('room-2');
  await expect(page.locator('[data-start="room-2"]')).toBeDisabled();
  expect(server.starts).toHaveLength(1);
  server.end(); await page.clock.runFor(61000);
  await expect(page.locator('#game-result')).toBeVisible();
  await expect(page.locator('#game-result')).toContainText('진행 60.0초');
  await expect(page.locator('#game-result')).toContainText('점수: 타격 연결 전');
  await page.getByRole('button',{name:'카메라 테스트로 돌아가기'}).click();
  await expect(page.locator('#game-result')).toBeHidden();
  await expect(page.locator('#game-status')).toContainText('카메라 테스트 중');
  await expect(page.locator('.camera-tile')).toHaveCount(1);
  await page.clock.fastForward(100);
  await page.locator('[data-start="room-2"]').click();
  await expect.poll(()=>server.starts.length).toBe(2);
  expect(server.starts[0].session_id).not.toBe(server.starts[1].session_id);
});

test('printable QR sheet has four fixed public camera URLs and excludes credentials',async({page})=>{
  await setup(page);
  await page.locator('#qr-sheet summary').click();
  await page.locator('#qr-base').fill('https://smash.example:8443');
  await page.getByRole('button',{name:'QR 주소 적용'}).click();
  await expect(page.locator('.qr-card')).toHaveCount(4);
  const links=await page.locator('.qr-card a').evaluateAll(nodes=>nodes.map(n=>n.href));
  expect(links).toContain('https://smash.example:8443/camera/room/?room=room-2&camera=C0');
  expect(links.every(link=>!link.includes('key=')&&!link.includes('token='))).toBe(true);
  await page.locator('#qr-base').fill('https://smash.example:8443/?key=secret');
  await page.getByRole('button',{name:'QR 주소 적용'}).click();
  await expect(page.locator('#qr-message')).toContainText('접속 키·경로 없이');
});

test('camera room selection restricts single-camera room to C0',async({page})=>{
  await setup(page);
  await page.goto('https://room-ui.test/camera/room/?room=room-2&camera=C2');
  await expect(page.locator('#room-id option')).toHaveCount(2);
  await expect(page.locator('#camera-id')).toHaveValue('C0');
  await expect(page.locator('#camera-id')).toBeDisabled();
  await page.locator('#room-id').selectOption('room-1');
  await expect(page.locator('#camera-id')).toBeEnabled();
  await page.locator('#camera-id').selectOption('C2');
  await page.locator('#room-id').selectOption('room-2');
  await expect(page.locator('#camera-id')).toHaveValue('C0');
});

test('room-1 start stays disabled until three fresh videos and disables after camera loss',async({page})=>{
  const server=await setup(page);
  await page.getByRole('link',{name:'room-1 PC 입장'}).click();
  await expect(page.locator('#game-start')).toBeDisabled();
  server.setCameras(['C0','C1']); await page.clock.runFor(200);
  await expect(page.locator('#game-start')).toBeDisabled();
  server.setCameras(['C0','C1','C2']);
  await expect(page.locator('.camera-tile')).toHaveCount(3);
  await expect(page.locator('#game-start')).toBeDisabled();
  await freshVideos(page);
  await expect(page.locator('#game-start')).toBeEnabled();
  server.setCameras(['C0','C1']); await page.clock.runFor(200);
  await expect(page.locator('#game-start')).toBeDisabled();
  await expect(page.locator('#game-start-note')).toContainText('C0 · C1 · C2 모두 연결');
  expect(server.starts).toHaveLength(0);
});

for (const roomId of ['room-1','room-2']) test(`${roomId} ACK opens one viewport camera with timer/score and restores after ending`,async({page},info)=>{
  const server=await setup(page,{holdStart:true});
  await page.getByRole('link',{name:`${roomId} PC 입장`}).click();
  if(roomId==='room-1')server.setCameras(['C0','C1','C2']);
  await expect(page.locator('.camera-tile')).toHaveCount(roomId==='room-1'?3:1);
  await freshVideos(page);
  await page.locator('#game-start').click();
  await expect.poll(()=>server.starts.length).toBe(1);
  await expect(page.locator('#game-hud')).toBeHidden(); // Approval, rather than click, changes layout.
  server.ack();
  await expect(page.locator('body')).toHaveClass(/game-expanded/);
  await expect(page.locator('#game-hud')).toBeVisible();
  await expect(page.locator('#play-timer')).toHaveText('60.0초');
  await expect(page.locator('#play-score')).toHaveText('—');
  await expect(page.locator('#play-score-note')).toHaveText('타격 연결 전');
  await expect(page.locator('.camera-tile:visible')).toHaveCount(1);
  await expect(page.locator('[data-camera="C0"].camera-tile')).toBeVisible();
  expect(await page.locator('#play-view').boundingBox()).toEqual({x:0,y:0,...page.viewportSize()});
  await page.evaluate(()=>{window.originalVideo=document.querySelector('[data-camera="C0"] video');});
  if(roomId==='room-1'){
    await page.locator('#play-cameras').getByRole('button',{name:'C2',exact:true}).click();
    await expect(page.locator('[data-camera="C2"].camera-tile')).toBeVisible();
    await expect(page.locator('[data-camera="C0"].camera-tile')).toBeHidden();
  }
  server.setScore(12);
  await expect(page.locator('#play-score')).toHaveText('12점');
  await expect(page.locator('#play-score-note')).toBeHidden();
  await page.clock.runFor(1100);
  expect(parseFloat(await page.locator('#play-timer').innerText())).toBeLessThan(60);
  await page.screenshot({path:info.outputPath('game-expanded.png')});
  await page.setViewportSize({width:390,height:844});
  expect(await page.locator('#play-view').boundingBox()).toEqual({x:0,y:0,width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('game-expanded-mobile.png')});
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/game-expanded/);
  await expect(page.locator('#game-expand')).toBeVisible();
  await expect(page.locator('.camera-tile:visible')).toHaveCount(roomId==='room-1'?3:1);
  await page.clock.runFor(1000); // Polling must keep the user's compact layout.
  await expect(page.locator('#game-hud')).toBeHidden();
  await page.locator('#game-expand').click();
  await expect(page.locator('#game-hud')).toBeVisible();
  if(roomId==='room-1'){
    server.setCameras(['C0','C1']);
    await expect(page.locator('[data-camera="C0"].camera-tile')).toBeVisible();
    await expect(page.locator('#play-cameras button')).toHaveCount(2);
    await expect(page.locator('#game-result')).toContainText('카메라 연결 끊김으로 자동 중지');
  }
  expect(await page.evaluate(()=>window.originalVideo===document.querySelector('[data-camera="C0"] video'))).toBe(true);
  server.end(); await page.clock.runFor(1100);
  await expect(page.locator('#game-hud')).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/game-expanded/);
  await expect(page.locator('#game-result')).toBeVisible();
  await expect(page.locator('#game-expand')).toBeHidden();
  await expect(page.locator('#game-result')).toContainText('점수: 12점');
  await page.getByRole('button',{name:'카메라 테스트로 돌아가기'}).click();
  await expect(page.locator('#game-result')).toBeHidden();
});

test('manual stop waits for server result, prevents double request and permits a fresh session',async({page})=>{
  const server=await setup(page,{holdStop:true});
  await page.getByRole('link',{name:'room-2 PC 입장'}).click();
  await freshVideos(page);await page.locator('#game-start').click();
  await expect(page.locator('#play-stop')).toBeVisible();
  await page.locator('#play-stop').click();
  await expect(page.locator('#play-stop')).toBeDisabled();
  await expect(page.locator('#game-result')).toBeHidden();
  await expect.poll(()=>server.stops.length).toBe(1);
  expect(server.stops[0].reason).toBe('manual_stop');
  server.stopAck();
  await expect(page.locator('#game-result')).toContainText('사용자 중지');
  await expect(page.locator('#game-result')).toContainText('진행 12.5초');
  await expect(page.locator('#game-hud')).toBeHidden();
  await expect(page.locator('#game-stop')).toBeHidden();
  await page.clock.runFor(2000);
  await expect(page.locator('#game-result')).toContainText('진행 12.5초');
  await page.locator('#game-back').click();await page.clock.runFor(100);
  await page.locator('#game-start').click();
  await expect(page.locator('#play-stop')).toBeVisible();
  await page.locator('#play-collapse').click();
  await page.locator('#game-stop').click();
  expect(server.starts[0].session_id).not.toBe(server.starts[1].session_id);
  await expect.poll(()=>server.stops.length).toBe(2);
  expect(server.stops[1].session_id).toBe(server.starts[1].session_id);
  server.stopAck();await expect(page.locator('#game-result')).toContainText('사용자 중지');
});

test('frozen required video automatically stops while normal hidden cameras keep playing',async({page})=>{
  const server=await setup(page);
  await page.getByRole('link',{name:'room-1 PC 입장'}).click();server.setCameras(['C0','C1','C2']);
  await expect(page.locator('.camera-tile')).toHaveCount(3);await freshVideos(page);
  await page.locator('#game-start').click();
  await expect(page.locator('.camera-tile:visible')).toHaveCount(1);
  await page.clock.runFor(2000);expect(server.stops).toHaveLength(0);
  await page.evaluate(()=>{const v=document.querySelector('[data-camera="C2"] video');Object.defineProperty(v,'currentTime',{value:v.currentTime});});
  await page.clock.runFor(1600);
  await expect.poll(()=>server.stops.length).toBe(1);
  expect(server.stops[0].reason).toBe('camera_stalled');
  await expect(page.locator('#game-result')).toContainText('카메라 영상 중단으로 자동 중지');
  await page.clock.runFor(2000);expect(server.stops).toHaveLength(1);
});
