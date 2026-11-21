import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
const data=JSON.parse(execFileSync('.venv/Scripts/python.exe',['-X','utf8','-c',
  "import sys,json,numpy as np;sys.path.insert(0,'tests');from test_multi3d_relay import CAMS,calib,landmarks;pts={'nose':[0,.5,1.65],'left_shoulder':[-.2,.5,1.4],'right_shoulder':[.2,.5,1.4],'left_elbow':[-.35,.5,1.15],'right_elbow':[.35,.5,1.15],'left_wrist':[-.4,.4,.95],'right_wrist':[.4,.4,.95],'left_hip':[-.12,.5,.9],'right_hip':[.12,.5,.9],'left_knee':[-.12,.5,.5],'right_knee':[.12,.5,.5],'left_ankle':[-.12,.5,.08],'right_ankle':[.12,.5,.08]};print(json.dumps({'points':pts,'calibs':{c:dict(calib(c),C=(-R.T@t).tolist()) for c,(R,t) in CAMS.items()},'rows':{c:landmarks(c,pts) for c in CAMS}}))"],{encoding:'utf8'}));

test('central skeleton uses thirteen measured joints and aligned inputs with delayed network delivery',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/test/multi3d/view.html?key=fragment-test');
  await page.evaluate(async data=>{
    const sockets={};window.accuracySockets=sockets;
    for(const c of ['C0','C1','C2']){
      const u=new URL('/ws/test/multi3d?role=phone&camera='+c+'&key=fragment-test',location.href);u.protocol='ws:';
      const ws=new WebSocket(u);sockets[c]=ws;
      ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='multi3d_clock_ping')ws.send(JSON.stringify({type:'multi3d_clock_pong',nonce:m.nonce,clock_id:c,device_time_ms:performance.now()}));};
      await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});ws.send(JSON.stringify(data.calibs[c]));
    }
    window.accuracyTimers=[];
    const send=()=>{
      const stamp=performance.now();
      for(const c of Object.keys(sockets)){
        const packet={type:'multi3d_frame',clock_id:c,input_at_ms:stamp,timestamp_source:'inference_input',landmarks:data.rows[c],fps:30};
        const timer=setTimeout(()=>{if(sockets[c].readyState===1)sockets[c].send(JSON.stringify(packet));},c==='C2'?80:0);window.accuracyTimers.push(timer);
      }
    };send();window.accuracyLoop=setInterval(send,70);
  },data);
  await expect.poll(()=>page.evaluate(()=>{
    const f=window.multi3dTest?.snapshot();return f?.timing==='inference_input_aligned'&&f.cameras_used.length===3&&Object.values(f.joints).filter(Boolean).length===13;
  }),{timeout:20000}).toBe(true);
  const state=await page.evaluate(()=>window.multi3dTest.snapshot());
  for(const [name,point]of Object.entries(data.points)){
    expect(Math.hypot(...state.joints[name].p.map((x,i)=>x-point[i]))).toBeLessThan(.002);
    expect(state.joints[name].ray_angle_deg).toBeGreaterThan(5);
  }
  await expect(page.locator('#info')).toContainText('입력시각 정렬');await expect(page.locator('#info')).toContainText('13 / 13');
  await expect(page.locator('#status')).not.toContainText('오류');
  await page.screenshot({path:'test-results/building-fragments/accurate-central-skeleton.png',fullPage:true});
  await page.evaluate(()=>{clearInterval(window.accuracyLoop);window.accuracyTimers.forEach(clearTimeout);Object.values(window.accuracySockets).forEach(ws=>ws.close());});
  expect(errors).toEqual([]);
});
