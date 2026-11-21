import {test,expect} from '@playwright/test';
// Duo stage WebRTC (2026-11-20, docs/DUO_STAGE_TEST.md): the view phone page (fake camera) sends its video straight
// to the PC page; the server relays only the signalling. Choosing JPEG on the phone falls back to the relay, and
// choosing WebRTC again reconnects. Both pages run in one browser here: this checks the wiring, not a real Wi-Fi.
test.use({launchOptions:{args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader',
  '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}});

test('duo stage: the view phone video reaches the PC over WebRTC, JPEG is the fallback',async({browser})=>{
  test.setTimeout(120000);
  const context=await browser.newContext({permissions:['camera'],viewport:{width:1400,height:900}});
  const errors=[];
  const pc=await context.newPage();pc.on('pageerror',e=>errors.push(`pc: ${e.message}`));
  await pc.goto('/test/building/?mode=duo&key=fragment-test');
  await expect.poll(()=>pc.evaluate(()=>window.buildingFragmentTest.snapshot().ready),{timeout:60000}).toBe(true);
  await expect(pc.locator('#autoSpacing')).toBeChecked();
  await expect(pc.locator('#viewTransport')).toContainText('JPEG 서버 중계');

  const phone=await context.newPage();phone.on('pageerror',e=>errors.push(`phone: ${e.message}`));
  await phone.goto('/test/stage-view/?key=fragment-test');
  await expect(phone.locator('#transport')).toHaveValue('rtc');
  await phone.locator('#start').click();

  const rtc=()=>pc.evaluate(()=>window.buildingFragmentTest.snapshot().view.rtc);
  await expect.poll(async()=>(await rtc()).status,{timeout:30000}).toBe('connected');
  await expect.poll(async()=>(await rtc()).frames,{timeout:15000}).toBeGreaterThan(20);
  let r=await rtc();
  expect(r.live).toBe(true);expect(r.frameVisible).toBe(true);expect(r.width).toBeGreaterThan(0);
  await expect(pc.locator('#viewTransport')).toContainText('WebRTC 직접');
  await expect.poll(()=>phone.evaluate(()=>window.stageView.snapshot().rtc),{timeout:10000}).toMatchObject({connected:1,all:true,transport:'rtc'});
  await expect(phone.locator('#perfStatus')).toContainText('WebRTC 직접');

  // The phone chooses JPEG: the WebRTC video stops and the PC says it uses the relay.
  await phone.locator('#transport').selectOption('jpeg');
  await expect.poll(async()=>(await rtc()).live,{timeout:10000}).toBe(false);
  await expect(pc.locator('#viewTransport')).toContainText('JPEG 서버 중계');
  expect((await phone.evaluate(()=>window.stageView.snapshot().rtc)).connected).toBe(0);

  // Back to WebRTC: the PC retries by itself and gets the video again.
  const before=(await rtc()).frames;
  await phone.locator('#transport').selectOption('rtc');
  await expect.poll(async()=>(await rtc()).status,{timeout:30000}).toBe('connected');
  await expect.poll(async()=>(await rtc()).frames,{timeout:15000}).toBeGreaterThan(before+10);

  // The phone leaves: the PC stops wanting the connection.
  await phone.close();
  await expect.poll(async()=>(await rtc()).status,{timeout:10000}).toBe('idle');
  expect(errors).toEqual([]);
  await context.close();
});
