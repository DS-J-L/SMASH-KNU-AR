import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
const snapshot=page=>page.evaluate(()=>window.singleCameraMonitor.snapshot());
async function open(page){await page.goto('/monitor/single/');await expect.poll(async()=>(await snapshot(page)).sceneReady).toBe(true);}
async function synthetic(page){await open(page);await page.locator('#mode').selectOption('synthetic');await expect(page.locator('#start')).toBeEnabled();}

test('single live entry remains gated when server and pose adapter are missing, leaves multiview scaffold unchanged',async({page,request})=>{
  await open(page);await expect(page.locator('#start')).toBeDisabled();await expect(page.locator('#pose-state')).toContainText('모듈 연결 대기');
  await page.locator('#connect').click();await expect(page.getByRole('status')).toContainText('신호 서버가 아직');
  expect(await snapshot(page)).toMatchObject({source:'live',phase:'idle',score:0,fragmentCount:0});
  const health=await request.get('/api/health');expect((await health.json()).stage).toBe('scaffold');
});
test('synthetic screen event fractures 96 shards once, three clean restores with distinct sessions',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await synthetic(page);
  await mkdir('docs/asset-validation/single-camera',{recursive:true});await page.screenshot({path:'docs/asset-validation/single-camera/ready.png'});
  const ids=[];
  for(let i=0;i<3;i++){
    await page.locator('#start').click();await expect(page.locator('#sample-hit')).toBeEnabled();ids.push((await snapshot(page)).sessionId);
    await page.locator('#sample-hit').click();await expect(page.locator('#score')).toHaveText('100');
    expect(await snapshot(page)).toMatchObject({source:'synthetic',phase:'playing',fragmentCount:96,bodyCount:97,score:100,targetActive:false,finiteBodies:true});
    await expect(page.locator('#sample-hit')).toBeDisabled();
    if(i===0)await page.screenshot({path:'docs/asset-validation/single-camera/fractured.png'});
    await page.locator('#reset').click();expect(await snapshot(page)).toMatchObject({fragmentCount:0,bodyCount:2,score:0,targetActive:true});
    await expect(page.locator('#start')).toBeEnabled();
  }
  expect(new Set(ids).size).toBe(3);expect(errors).toEqual([]);
});
test('rotated mirrored portrait display, resize invalidation and live mode switch reset synthetic session',async({page})=>{
  await synthetic(page);const before=await snapshot(page);
  await page.locator('#mirror').check();await page.locator('#rotation').selectOption('90');await page.setViewportSize({width:480,height:900});
  await expect(page.locator('#start')).toBeEnabled();expect((await snapshot(page)).transformVersion).toBeGreaterThan(before.transformVersion);
  await page.locator('#start').click();await expect(page.locator('#sample-hit')).toBeEnabled();await expect(page.locator('#mirror')).toBeDisabled();
  await page.locator('#sample-hit').click();await expect(page.locator('#score')).toHaveText('100');
  await page.locator('#mode').selectOption('live');await expect(page.locator('#start')).toBeDisabled();
  expect(await snapshot(page)).toMatchObject({source:'live',phase:'idle',score:0,fragmentCount:0,sessionId:null});
});
test('three virtual 60-second rounds expire without post-end hits and reset correctly',async({page})=>{
  await page.clock.install();await synthetic(page);const ids=[];
  for(let i=0;i<3;i++){
    await page.clock.runFor(240);await page.locator('#start').click();ids.push((await snapshot(page)).sessionId);
    await page.clock.fastForward(60500);await expect(page.locator('#time')).toHaveText('0s');
    expect(await snapshot(page)).toMatchObject({phase:'ended',score:0,fragmentCount:0});await expect(page.locator('#sample-hit')).toBeDisabled();
    await page.locator('#reset').click();await page.clock.runFor(240);await expect(page.locator('#start')).toBeEnabled();
  }
  expect(new Set(ids).size).toBe(3);
});
test('real WebRTC browser peer video receiver reconnects three times and rejects late old-stream signaling',async({page})=>{
  await page.route('**/__single-tests/receiver.js',async route=>route.fulfill({contentType:'text/javascript',body:await readFile(new URL('../../frontend/single/video-receiver.js',import.meta.url),'utf8')}));
  await page.route('**/__single-tests/index.html',route=>route.fulfill({contentType:'text/html',body:'<video id="video" muted playsinline></video>'}));
  await page.goto('/__single-tests/index.html');
  const result=await page.evaluate(async()=>{
    const {VideoReceiver}=await import('/__single-tests/receiver.js');const video=document.getElementById('video'),counts=[],states=[];
    let sender,streamId,currentFrames=[],resolveFrames,remoteIce=[];
    const receiver=new VideoReceiver({video,onState:s=>states.push(s.state),onFrame:(image,meta)=>{currentFrames.push(meta);image.close();if(currentFrames.length>=3)resolveFrames?.();},
      sendSignal:async m=>{if(m.type==='answer'){await sender.setRemoteDescription({type:'answer',sdp:m.sdp});for(const c of remoteIce)await sender.addIceCandidate(c);remoteIce=[];}
        else if(m.type==='ice'){if(sender.remoteDescription)await sender.addIceCandidate(m.candidate);else remoteIce.push(m.candidate);}}});
    let timer;
    for(let i=0;i<3;i++){
      streamId='stream-'+i;currentFrames=[];remoteIce=[];sender=new RTCPeerConnection({iceServers:[]});
      const binding={room_id:'browser-test',stream_id:streamId};receiver.bind(binding);
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d');
      let tick=0;timer=setInterval(()=>{ctx.fillStyle=tick++%2?'#333':'#999';ctx.fillRect(0,0,320,240);},50);
      const stream=canvas.captureStream(15);for(const track of stream.getTracks())sender.addTrack(track,stream);
      sender.onicecandidate=e=>{void receiver.receive({...binding,type:'ice',candidate:e.candidate?.toJSON()??null});};
      await sender.setLocalDescription(await sender.createOffer());
      const frames=new Promise((resolve,reject)=>{resolveFrames=resolve;setTimeout(()=>reject(new Error('video_frame_timeout')),10000);});
      await receiver.receive({...binding,type:'offer',sdp:sender.localDescription.sdp});await frames;
      const track=video.srcObject.getVideoTracks()[0];receiver.stop();
      counts.push({frames:currentFrames.length,width:currentFrames[0].image_width,firstFrame:currentFrames[0].frame_id,
        closed:track.readyState==='ended'&&receiver.pc===null&&video.srcObject===null,
        monotonic:currentFrames.every((m,j)=>j===0||m.frame_id>currentFrames[j-1].frame_id)});
      const late=await receiver.receive({...binding,type:'offer',sdp:sender.localDescription.sdp});if(late)throw new Error('old_offer_accepted');
      clearInterval(timer);sender.onicecandidate=null;sender.close();for(const t of stream.getTracks())t.stop();
    }
    return {counts,live:states.includes('live')};
  });
  expect(result.live).toBe(true);expect(result.counts).toHaveLength(3);
  for(const round of result.counts)expect(round).toMatchObject({width:320,closed:true,monotonic:true,firstFrame:1});
});
