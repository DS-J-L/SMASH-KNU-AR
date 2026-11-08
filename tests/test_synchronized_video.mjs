import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

async function harness() {
  const callbacks = new Map(), displayed = [], notes = [], streams = [], frames = [], matched = [];
  let timerId = 0;
  const context = vm.createContext({
    Map, Set, Promise, Number, Math, Infinity, Date,
    performance: { now: () => 100 },
    setInterval(fn) { callbacks.set(++timerId,fn); return timerId; },
    clearInterval(id) { callbacks.delete(id); },
    setTimeout() { return 1; }, clearTimeout() {},
    Image: class { naturalWidth=640; naturalHeight=480; async decode() {} },
    document: {createElement() { return {
      width:0,height:0,getContext() { return { drawImage() {} }; },
      captureStream() {
        const track={stopped:false, stop(){this.stopped=true;},requestFrame(){}};
        const stream={getTracks:()=>[track],getVideoTracks:()=>[track]}; streams.push(stream); return stream;
      },
    }; }},
  });
  const modules=new Map();
  async function load(name) {
    if(modules.has(name)) return modules.get(name);
    const source=await readFile(new URL(`../web/shared/${name}`,import.meta.url),'utf8');
    const module=new vm.SourceTextModule(source,{context}); modules.set(name,module);
    await module.link(spec=>load(spec.split('/').at(-1).split('?')[0])); return module;
  }
  const module=await load('synchronized-video.js'); await module.evaluate();
  const sync=module.namespace.createSynchronizedVideo((id,stream,note)=>displayed.push({id,stream,note}),note=>notes.push(note),id=>frames.push(id),(id,canvas,pose)=>matched.push({id,canvas,pose}));
  const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
  return {sync,displayed,streams,notes,frames,matched,flush,async tick(){await callbacks.get(1)();await flush();}};
}

test('missing frame timestamps display independent video, then switch to synchronized output',async()=>{
  const h=await harness();
  h.sync.setCameras([{connection_id:'peer',camera_id:'C0'}]);
  h.sync.push({from_connection_id:'peer',frame_id:0,data_url:'jpeg',prepared_at_server_ms:null});
  await h.flush(); await h.tick();
  assert.ok(h.displayed.some(entry=>entry.stream && entry.note.includes('개별')));
  assert.ok(h.notes.at(-1).includes('동기화 제외'));
  assert.deepEqual(h.frames,['C0']);
  h.sync.push({from_connection_id:'peer',frame_id:1,data_url:'jpeg',prepared_at_server_ms:1000});
  await h.tick();
  assert.ok(h.displayed.at(-1).note.includes('동기화'));
  assert.equal(h.streams[0].getTracks()[0].stopped,true);
  assert.deepEqual(h.frames,['C0','C0']);
  h.sync.close();
  assert.ok(h.streams.every(stream=>stream.getTracks()[0].stopped));
});

test('both unsynchronized and synchronized JPEG paths preserve their own pose frame',async()=>{
  const h=await harness();h.sync.setCameras([{connection_id:'peer',camera_id:'C0'}]);
  const pose0={stream_id:'phone',frame_id:41},pose1={stream_id:'phone',frame_id:43};
  h.sync.push({from_connection_id:'peer',frame_id:7,data_url:'jpeg',prepared_at_server_ms:null,phone_pose:pose0});
  await h.flush();await h.tick();
  assert.equal(h.matched.at(-1).pose,pose0);
  h.sync.push({from_connection_id:'peer',frame_id:8,data_url:'jpeg',prepared_at_server_ms:1000,phone_pose:pose1});
  await h.tick();
  assert.equal(h.matched.at(-1).pose,pose1);
  assert.equal(h.matched.at(-1).canvas.width,640);
  h.sync.close();
});
