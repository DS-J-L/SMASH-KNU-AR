import {test,expect} from '@playwright/test';

// Phone pages: the corner-picking magnifier must sit above every panel, and the overlay panels
// must be hideable and movable. Runs against both the 1-camera and 3-camera phone pages.
test.use({viewport:{width:390,height:800},hasTouch:false});
for(const mode of ['mono3d','multi3d'])test(`${mode}: magnifier is above the panels; panels hide and move`,async({page,context})=>{
  test.setTimeout(60000);const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await context.addInitScript(()=>{
    navigator.mediaDevices.getUserMedia=async()=>{
      const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1280;const ctx=canvas.getContext('2d');
      let n=0;const draw=()=>{const g=ctx.createLinearGradient(0,0,720,1280);g.addColorStop(0,'#345');g.addColorStop(1,'#cba');ctx.fillStyle=g;ctx.fillRect(0,0,720,1280);
        ctx.fillStyle='#000';ctx.fillRect(250,500,220,220);ctx.fillStyle=n++%2?'#fff':'#eee';ctx.fillRect(0,0,4,4);};
      draw();setInterval(draw,50);return canvas.captureStream(20);
    };
  });
  await page.route('**/camera/pose.js*',route=>route.fulfill({contentType:'application/javascript',body:"export async function createPoseLandmarker(){return {delegate:'CPU',landmarker:{detectForVideo(){return {landmarks:[],worldLandmarks:[]};},close(){}}};}"}));
  await page.goto(`/test/${mode}/?key=fragment-test`);await page.locator('#start').click();
  await page.locator('#tapCorners').click();
  const view=await page.locator('#view').boundingBox();
  // Finger on the left half, below the corner-picking sheet; the loupe used to be painted under that sheet.
  const finger={x:view.x+90,y:view.y+view.height*.75};
  await page.mouse.move(finger.x,finger.y);await page.mouse.down();await page.mouse.move(finger.x+4,finger.y+4);
  const loupe=page.locator('#loupe');await expect(loupe).toBeVisible();
  const info=await page.evaluate(()=>{
    const l=document.getElementById('loupe'),r=l.getBoundingClientRect(),z=id=>Number(getComputedStyle(document.querySelector(id)).zIndex);
    return {rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},loupeZ:Number(getComputedStyle(l).zIndex),sheetZ:z('#sheet'),topbarZ:z('#topbar'),bannerZ:z('#banner'),
      vw:innerWidth,vh:innerHeight,topbarBottom:document.getElementById('topbar').getBoundingClientRect().bottom};
  });
  await page.screenshot({path:'test-results/building-fragments/phone-loupe-'+mode+'.png'});
  expect(info.loupeZ).toBeGreaterThan(Math.max(info.sheetZ,info.topbarZ,info.bannerZ));
  expect(info.rect.left).toBeGreaterThanOrEqual(0);expect(info.rect.right).toBeLessThanOrEqual(info.vw);
  expect(info.rect.top).toBeGreaterThanOrEqual(info.topbarBottom);
  expect(info.rect.left>finger.x||info.rect.right<finger.x).toBe(true);          // never under the finger
  expect(info.rect.left).toBeGreaterThan(info.vw/2-5);                           // finger on left → loupe on right
  await page.mouse.move(view.x+300,finger.y);
  await expect.poll(()=>page.evaluate(()=>document.getElementById('loupe').getBoundingClientRect().right<innerWidth/2)).toBe(true); // finger on right → loupe left
  await page.mouse.up();await expect(loupe).toBeHidden();
  await page.locator('#cancelCorners').click();

  // Hide/show every overlay panel.
  await expect(page.locator('#sheet')).toBeVisible();
  await page.locator('#uiToggle').click();
  await expect(page.locator('#sheet')).toBeHidden();await expect(page.locator('#uiToggle')).toBeVisible();
  await page.locator('#uiToggle').click();await expect(page.locator('#sheet')).toBeVisible();

  // Drag the sheet by its handle; a plain click still collapses it.
  const top0=(await page.locator('#sheet').boundingBox()).y,hb=await page.locator('#sheetHandle').boundingBox();
  await page.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2);await page.mouse.down();
  await page.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2-60,{steps:4});await page.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2-140,{steps:4});await page.mouse.up();
  const top1=(await page.locator('#sheet').boundingBox()).y;expect(top0-top1).toBeGreaterThan(100);
  await expect(page.locator('#sheet')).not.toHaveClass(/collapsed/);                // drag did not toggle collapse
  const hb2=await page.locator('#sheetHandle').boundingBox();await page.mouse.click(hb2.x+hb2.width/2,hb2.y+hb2.height/2);
  await expect(page.locator('#sheet')).toHaveClass(/collapsed/);
  // The phone pages no longer draw a building: its overlay module is never loaded or created.
  expect(requests.filter(u=>u.includes('phone-overlay')||u.includes('/api/scenes')||u.includes('/models/'))).toEqual([]);
  expect(await page.evaluate(()=>typeof window.phoneModelOverlay)).toBe('undefined');
  expect(errors).toEqual([]);
});
