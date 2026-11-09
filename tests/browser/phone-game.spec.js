import {test,expect} from '@playwright/test';

// Real HTTP/WS, JPEG relay, game, hit detector, GLB and physics; synthetic camera/model.
for(const roomId of ['room-1','room-2']){
test(`${roomId}: phone wrists drive the team game and server score; stop and reconnect`,async({page,browser,baseURL})=>{
  const roomIndex=roomId==='room-1'?0:1;
  const cameras=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(`/monitor/${roomId}/`);
    await page.locator('#phone-game-link').click();
    await expect(page).toHaveURL(`${baseURL}/monitor/phone-game/?room=${roomId}`);
    await page.locator('#connect').click();
    for(const id of (roomId==='room-1'?['C0','C1','C2']:['C0'])){
      const context=await browser.newContext();cameras.push(context);
      await context.addInitScript(()=>{
        window.wrist=[.02,.02];
        navigator.mediaDevices.getUserMedia=async()=>{
          const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
          const ctx=canvas.getContext('2d');let n=0;
          setInterval(()=>{ctx.fillStyle=n++%2?'#245642':'#293860';ctx.fillRect(0,0,640,480);},50);
          return canvas.captureStream(20);
        };
      });
      const phone=await context.newPage();
      await phone.route('**/camera/pose.js',route=>route.fulfill({contentType:'application/javascript',body:`
        export async function createPoseLandmarker(){return{delegate:'CPU',landmarker:{
          detectForVideo(){if(window.failPose)throw new Error('synthetic inference stopped');const p=[];p[15]={x:window.wrist[0],y:window.wrist[1],visibility:.95};return{landmarks:[p]};},close(){}}};}
        export function extractWrists(result,width,height){const p=result.landmarks[0][15];return{left_wrist:{u_px:p.x*width,v_px:p.y*height,visibility:.95},right_wrist:null};}
      `}));
      await phone.goto(`${baseURL}/camera/room/?room=${roomId}&camera=${id}`);
      await phone.locator('#transport').selectOption('server');
      await phone.getByRole('button',{name:'선택한 방 입장 · 영상 보내기'}).click();
      await expect(phone.locator('#room-status')).toContainText('입장 완료');
    }
    await expect(page.locator('#start')).toBeEnabled();
    await page.evaluate(()=>{
      window.startNotices=[];
      window.noticeObserver=new MutationObserver(()=>window.startNotices.push(document.querySelector('#status').textContent));
      window.noticeObserver.observe(document.querySelector('#status'),{childList:true,subtree:true,characterData:true});
    });
    await page.locator('#start').click();
    await expect.poll(()=>page.evaluate(()=>singleCameraMonitor.snapshot().phase)).toBe('playing');
    await expect.poll(()=>page.evaluate(()=>singleCameraMonitor.snapshot().frameStats.processed)).toBeGreaterThan(5);
    await expect(page.locator('#status')).toHaveText('손목 타격 이벤트를 기다립니다.');
    expect(await page.evaluate(()=>{window.noticeObserver.disconnect();return window.startNotices.filter(text=>text.includes('입력이 끊겼습니다'));})).toEqual([]);
    const point=await page.evaluate(()=>{
      const triangles=singleCameraMonitor.getTarget().triangles;
      const t=triangles.reduce((a,b)=>{
        const area=t=>Math.abs((t[1][0]-t[0][0])*(t[2][1]-t[0][1])-(t[1][1]-t[0][1])*(t[2][0]-t[0][0]));return area(a)>area(b)?a:b;});
      return [0,1].map(i=>(t[0][i]+t[1][i]+t[2][i])/3);
    });
    await cameras[0].pages()[0].evaluate(p=>{window.wrist=p;},point);
    await expect(page.locator('#score')).toHaveText('100');
    await expect(page.locator('#fragments')).toHaveText('96 / 96');
    await expect.poll(async()=>{
      const data=await (await page.request.get('/api/single/rooms')).json();return data.rooms[roomIndex].game?.score;
    }).toBe(100);
    await page.locator('#stop').click();
    await expect.poll(()=>page.evaluate(()=>singleCameraMonitor.snapshot().phase)).toBe('ended');
    await page.locator('#reset').click();await page.locator('#connect').click();
    await expect(page.locator('#start')).toBeEnabled();
    await page.locator('#start').click();
    await expect.poll(()=>page.evaluate(()=>singleCameraMonitor.snapshot().phase)).toBe('playing');
    await cameras[0].pages()[0].evaluate(()=>{window.failPose=true;});
    await expect.poll(()=>page.evaluate(()=>singleCameraMonitor.snapshot().phase)).toBe('ended');
    const ended=(await (await page.request.get('/api/single/rooms')).json()).rooms[roomIndex].game;
    expect(ended.reason).toBe('camera_stalled');
    await cameras[0].pages()[0].evaluate(()=>{window.failPose=false;});
    await cameras[0].pages()[0].getByRole('button',{name:'퇴장 · 카메라 끄기'}).click();
    await cameras[0].pages()[0].getByRole('button',{name:'선택한 방 입장 · 영상 보내기'}).click();
    await page.locator('#reset').click();
    await expect(page.locator('#start')).toBeEnabled();await page.locator('#start').click();
    await expect.poll(()=>page.evaluate(()=>singleCameraMonitor.snapshot().phase)).toBe('playing');
    await cameras.at(-1).pages()[0].getByRole('button',{name:'퇴장 · 카메라 끄기'}).click();
    await expect.poll(()=>page.evaluate(()=>singleCameraMonitor.snapshot().phase)).toBe('ended');
    if(roomId==='room-1'){
      // Losing C2 stops the game, but C0 video is still genuinely live.
      await expect(page.locator('#video-state')).toHaveText('수신 중');
      await cameras[0].pages()[0].getByRole('button',{name:'퇴장 · 카메라 끄기'}).click();
    }
    await expect(page.locator('#video-state')).toHaveText('연결 끊김');
    await expect(page.locator('#start')).toBeDisabled();
    expect(errors).toEqual([]);
  }finally{for(const context of cameras)await context.close();}
});
}
