import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
const calib=JSON.parse(execFileSync('.venv/Scripts/python.exe',['-c',"import sys,json;sys.path.insert(0,'tests');from test_multi3d_relay import calib;print(json.dumps(calib('C0')))"],{encoding:'utf8'}));
const allCalibs=JSON.parse(execFileSync('.venv/Scripts/python.exe',['-c',"import sys,json;sys.path.insert(0,'tests');from test_multi3d_relay import calib,CAMS;print(json.dumps({c:calib(c) for c in CAMS}))"],{encoding:'utf8'}));

for(const mono of [true,false])test((mono?'mono':'multi')+': person depth hides only overlapping rear geometry, including released fragments',async({page})=>{
  test.setTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/shader|VALIDATE_STATUS|WebGLProgram/.test(m.text()))errors.push(m.text());});
  await page.goto('/test/building/?'+(mono?'mode=mono&':'scene=it1&')+'key=fragment-test');await expect(page.locator('#dimensions')).toContainText('고정 높이');
  if(mono){await page.locator('#sceneSelect').selectOption('it1');await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().sceneId)).toBe('it1');await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().ready)).toBe(true);}
  await page.locator('#restore').click();
  await page.evaluate(async ({c,mono,calibs})=>{
    const u=new URL(mono?'/ws/test/mono3d?role=phone&key=fragment-test':'/ws/test/multi3d?role=phone&camera=C0&key=fragment-test',location.href);u.protocol='ws:';
    const ws=new WebSocket(u);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    ws.send(JSON.stringify(mono?{type:'mono3d_calib',image:c.image,K:c.K,camera:{R:c.R,t:c.t}}:c));
    const phones={C0:ws};
    if(!mono)for(const id of ['C1','C2']){const u=new URL('/ws/test/multi3d?role=phone&camera='+id+'&key=fragment-test',location.href);u.protocol='ws:';const w=new WebSocket(u);await new Promise(r=>{w.onopen=r;});phones[id]=w;w.send(JSON.stringify(calibs[id]));}
    const joints={nose:[0,.5,1.6],left_shoulder:[-.2,.5,1.35],right_shoulder:[.2,.5,1.35],left_elbow:[-.3,.5,1.1],right_elbow:[.3,.5,1.1],left_wrist:[-.4,.5,.9],right_wrist:[.4,.5,.9],left_hip:[-.1,.5,.9],right_hip:[.1,.5,.9],left_knee:[-.1,.5,.5],right_knee:[.1,.5,.5],left_ankle:[-.1,.5,.08],right_ankle:[.1,.5,.08]};
    const ids={nose:0,left_shoulder:11,right_shoulder:12,left_elbow:13,right_elbow:14,left_wrist:15,right_wrist:16,left_hip:23,right_hip:24,left_knee:25,right_knee:26,left_ankle:27,right_ankle:28};
    const projected=Object.fromEntries(Object.entries(calibs).map(([id,c])=>{const lm=Array.from({length:33},()=>[.5,.5,0]);for(const [n,p]of Object.entries(joints)){const q=[0,1,2].map(k=>c.R[k*3]*p[0]+c.R[k*3+1]*p[1]+c.R[k*3+2]*p[2]+c.t[k]);lm[ids[n]]=[(c.K.fx*q[0]/q[2]+c.K.cx)/c.image.width,(c.K.fy*q[1]/q[2]+c.K.cy)/c.image.height,.99];}return [id,lm];}));

    const jpeg=document.createElement('canvas');jpeg.width=c.image.width;jpeg.height=c.image.height;
    const ctx=jpeg.getContext('2d');ctx.fillStyle='#17202d';ctx.fillRect(0,0,jpeg.width,jpeg.height);
    const image=jpeg.toDataURL('image/jpeg'),mask=document.createElement('canvas');mask.width=128;mask.height=Math.round(128*c.image.height/c.image.width);
    const feed={ws,phones,mm:null,rect:null,valid:true,frame:0};window.personFeed=feed;
    feed.send=()=>{
      let occlusion=null;
      if(feed.mm!==null){
        const data=new Uint8ClampedArray(mask.width*mask.height*4);
        for(let y=0;y<mask.height;y++)for(let x=0;x<mask.width;x++){
          if(feed.rect&&(Math.abs(x/mask.width-feed.rect.u)>.055||Math.abs(y/mask.height-feed.rect.v)>.075))continue;
          const i=(y*mask.width+x)*4;data[i]=feed.mm>>8;data[i+1]=feed.mm&255;data[i+3]=255;
        }
        mask.getContext('2d').putImageData(new ImageData(data,mask.width,mask.height),0,0);
        occlusion={encoding:feed.bad?'unsupported':'camera_z_mm_rg16_alpha_v1',width:mask.width,height:mask.height,data:mask.toDataURL('image/png')};
      }
      if(mono)ws.send(JSON.stringify({type:'mono3d_frame',valid:feed.valid,joints}));else for(const [id,w]of Object.entries(phones))w.send(JSON.stringify({type:'multi3d_frame',landmarks:feed.valid?projected[id]:null}));
      ws.send(JSON.stringify({type:mono?'mono3d_jpeg':'multi3d_jpeg',t_ms:++feed.frame,data:image,occlusion,occlusion_valid:feed.visualOnly===true?!!occlusion:undefined}));return feed.frame;
    };feed.send();feed.timer=setInterval(feed.send,120);
  },{c:calib,mono,calibs:allCalibs});
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().projection.length)).toBe(mono?1:3);
  await expect(page.locator('.camera img').first()).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>{
    const p=window.buildingFragmentTest.cameraPickPoints();return window.buildingFragmentTest.cameraPixels(p).filter(v=>v[3]>200).length;
  })).toBeGreaterThan(2);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().person.joints)).toBe(13);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().person.torso)).toBe(true);
  const candidates=await page.evaluate(()=>{
    const points=window.buildingFragmentTest.cameraPickPoints(),pixels=window.buildingFragmentTest.cameraPixels(points);
    return points.filter((p,i)=>pixels[i][3]>200).sort((a,b)=>a.u-b.u);
  });expect(candidates.length).toBeGreaterThan(2);
  const inside=candidates[0],outside=candidates.find(p=>Math.abs(p.u-inside.u)>.15||Math.abs(p.v-inside.v)>.2);expect(outside).toBeTruthy();
  const setMask=async(mm,rect=inside)=>{
    const frame=await page.evaluate(({mm,rect})=>{Object.assign(window.personFeed,{mm,rect});return window.personFeed.send();},{mm,rect});
    await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().occlusion.frameId)).toBeGreaterThanOrEqual(frame);
    await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().occlusion.visible)).toBe(true);
  };
  const pixels=()=>page.evaluate(points=>window.buildingFragmentTest.cameraPixels(points),[inside,outside]);
  await setMask(200);
  await expect.poll(async()=>(await pixels())[0][3]).toBe(0);
  expect((await pixels())[1][3]).toBeGreaterThan(200);
  await page.screenshot({path:'test-results/building-fragments/person-front-occlusion.png',fullPage:true});
  await setMask(30000);expect((await pixels())[0][3]).toBeGreaterThan(200);
  await setMask(200);
  await page.locator('#personOcclusion').uncheck();await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().occlusion.visible)).toBe(false);
  expect((await pixels())[0][3]).toBeGreaterThan(200);
  await page.locator('#personOcclusion').check();
  await page.locator('[data-physics="gravity"]').uncheck();await page.locator('#impactBreak').uncheck();
  await page.locator('#stress').click();await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().physics.dynamic)).toBe(96);
  await setMask(200,null);
  const alpha=await page.evaluate(()=>{const p=window.buildingFragmentTest.cameraPickPoints();return window.buildingFragmentTest.cameraPixels(p).map(r=>r[3]);});
  expect(Math.max(...alpha)).toBe(0);
  await page.evaluate(()=>{window.personFeed.bad=true;window.personFeed.send();});
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().occlusion.hasMask)).toBe(false);
  await page.evaluate(()=>{window.personFeed.bad=false;window.personFeed.send();});
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().occlusion.visible)).toBe(true);
  await page.evaluate(()=>clearInterval(window.personFeed.timer));
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().occlusion.hasMask)).toBe(false);
  await page.evaluate(()=>{window.personFeed.send();window.personFeed.timer=setInterval(window.personFeed.send,120);});
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().occlusion.visible)).toBe(true);
  if(mono){
    await page.evaluate(()=>{window.personFeed.valid=false;window.personFeed.visualOnly=true;window.personFeed.send();});
    await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().person.visible)).toBe(false);
    await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().occlusion.visible)).toBe(true);
    await page.evaluate(()=>{window.personFeed.visualOnly=false;});
  }
  await page.evaluate(()=>{window.personFeed.valid=false;window.personFeed.send();});
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().person.visible)).toBe(false);
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().occlusion.hasMask)).toBe(false);
  await page.evaluate(()=>{clearInterval(window.personFeed.timer);Object.values(window.personFeed.phones).forEach(w=>w.close());});
  await expect.poll(()=>page.evaluate(()=>window.buildingFragmentTest.snapshot().occlusion.hasMask)).toBe(false);
  await page.locator('#restore').click();expect(errors).toEqual([]);
});
