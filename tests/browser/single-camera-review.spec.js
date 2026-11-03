import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Synthetic canvas/pose and a mocked signaling service exercise the live consumer branch.
// This is not a phone, MediaPipe, authentication, or real-server validation.
async function fixture(page,{pose=false,ackDelayMs=0}={}) {
  await page.route('**/api/single/rooms',route=>route.fulfill({json:{room_id:'review-room',server_epoch:'review-epoch',pc_token:'EXAMPLE_ONLY'}}));
  await page.goto('/monitor/single/');
  await expect.poll(()=>page.evaluate(()=>window.singleCameraMonitor?.snapshot().sceneReady)).toBe(true);
  await page.evaluate(({pose,ackDelayMs})=>{
    const header={schema:'single_camera.v1-draft',room_id:'review-room',server_epoch:'review-epoch',stream_id:'review-synthetic'};
    const logs=[],ends=[],starts=[],canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#d63286';ctx.fillRect(0,0,320,240);
    const timer=setInterval(()=>{ctx.fillStyle='#d63286';ctx.fillRect(0,0,320,240);},50);
    const stream=canvas.captureStream(15),sender=new RTCPeerConnection({iceServers:[]});
    for(const track of stream.getTracks())sender.addTrack(track,stream);
    let signal,control,started=false;const remoteIce=[];
    const emit=(socket,message)=>queueMicrotask(()=>socket?.onmessage?.({data:JSON.stringify({...header,...message})}));
    sender.onicecandidate=e=>emit(signal,{type:'ice',candidate:e.candidate?.toJSON()??null});
    const negotiate=async()=>{if(started)return;started=true;await sender.setLocalDescription(await sender.createOffer());emit(signal,{type:'offer',sdp:sender.localDescription.sdp});};
    window.WebSocket=class {
      constructor(url){this.channel=url.includes('/signaling')?'signaling':'control';this.readyState=0;
        if(this.channel==='signaling')signal=this;else control=this;
        queueMicrotask(()=>{this.readyState=1;this.onopen?.();});}
      send(json){const m=JSON.parse(json);
        if(m.type==='join'&&this.channel==='control')emit(this,{type:'stream_bound'});
        if(m.type==='receiver_ready')void negotiate();
        if(m.type==='answer')void sender.setRemoteDescription({type:'answer',sdp:m.sdp}).then(async()=>{for(const c of remoteIce)await sender.addIceCandidate(c);remoteIce.length=0;});
        if(m.type==='ice'){if(sender.remoteDescription)void sender.addIceCandidate(m.candidate);else remoteIce.push(m.candidate);}
        if(m.type==='ping')emit(this,{type:'pong'});
        if(m.type==='start'){starts.push(m);setTimeout(()=>emit(this,{...m,type:'start_ack'}),ackDelayMs);}
        if(m.type==='end')ends.push(m);
        if(m.type==='log')logs.push(m.entry);
      }
      close(){this.readyState=3;}
    };
    if(pose)window.singleCameraMonitor.attachPoseProcessor(async(_image,meta)=>({...meta,wrists:{left_wrist:{valid:true,image_norm:[.25,.4],visibility:1}}}));
    window.__reviewFixture={logs,ends,starts,kind:'synthetic',stop(){clearInterval(timer);sender.close();for(const t of stream.getTracks())t.stop();signal?.close();control?.close();}};
  },{pose,ackDelayMs});
  await page.locator('#connect').click();
}

test('PR5 review: received video is visible while pose adapter is absent and start stays blocked',async({page})=>{
  await fixture(page);
  await expect.poll(()=>page.evaluate(()=>window.singleCameraMonitor.snapshot().frameStats.processed),{timeout:7000}).toBeGreaterThan(2);
  await expect(page.locator('#video-state')).toHaveText('수신 중');await expect(page.locator('#pose-state')).toContainText('모듈 연결 대기');await expect(page.locator('#start')).toBeDisabled();
  const pixel=await page.locator('#background').evaluate(c=>[...c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data]);
  expect(pixel[0]).toBeGreaterThan(150);expect(pixel[1]).toBeLessThan(100);expect(pixel[2]).toBeGreaterThan(70);
  await page.evaluate(()=>window.__reviewFixture.stop());
});

test('PR5 review: server-forwarded and exported logs retain identical PC time and version fields',async({page})=>{
  await fixture(page,{pose:true});await expect(page.locator('#start')).toBeEnabled();await page.locator('#start').click();
  await expect.poll(()=>page.evaluate(()=>window.singleCameraMonitor.snapshot().phase)).toBe('playing');
  const remote=await page.evaluate(()=>window.__reviewFixture.logs.find(e=>e.type==='started'));
  expect(remote.model_version).toBe('knu-it1-v3');expect(Number.isFinite(remote.observed_at_pc_ms)).toBe(true);
  const pending=page.waitForEvent('download');await page.locator('#download').click();const download=await pending;
  const local=JSON.parse(await readFile(await download.path(),'utf8')).entries.find(e=>e.type==='started');
  expect(local).toEqual(remote);await page.evaluate(()=>window.__reviewFixture.stop());
});

test('PR5 review: persisted page restoration reloads a monitor whose resources were disposed',async({page})=>{
  let documents=0;page.on('request',r=>{if(r.isNavigationRequest()&&r.url().endsWith('/monitor/single/'))documents++;});
  await page.goto('/monitor/single/');await expect.poll(()=>page.evaluate(()=>window.singleCameraMonitor?.snapshot().sceneReady)).toBe(true);
  await page.evaluate(()=>{
    window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
    setTimeout(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})),0);
  });
  await expect.poll(()=>documents,{timeout:3000}).toBeGreaterThan(1);
  await expect.poll(()=>page.evaluate(()=>window.singleCameraMonitor?.snapshot().sceneReady)).toBe(true);
  await page.locator('#mode').selectOption('synthetic');await expect(page.locator('#start')).toBeEnabled();
});

for(const action of ['reset','mode'])test(`PR5 review: ${action} cancels a pending server start before a late ACK`,async({page})=>{
  await fixture(page,{pose:true,ackDelayMs:1000});await expect(page.locator('#start')).toBeEnabled();await page.locator('#start').click();
  await expect.poll(()=>page.evaluate(()=>window.singleCameraMonitor.snapshot().phase)).toBe('starting');
  if(action==='reset')await page.locator('#reset').click();else await page.locator('#mode').selectOption('synthetic');
  const wire=await page.evaluate(()=>({ends:window.__reviewFixture.ends,starts:window.__reviewFixture.starts}));
  expect(wire.ends).toHaveLength(1);expect(wire.ends[0].session_id).toBe(wire.starts[0].session_id);
  await page.waitForTimeout(1100);expect(await page.evaluate(()=>window.singleCameraMonitor.snapshot().sessionId)).toBeNull();
  await page.evaluate(()=>window.__reviewFixture.stop());
});
