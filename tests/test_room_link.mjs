import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';

const source=await readFile(new URL('../web/shared/room-link.js',import.meta.url),'utf8');
async function harness(options={}) {
  const timers=new Map(),sockets=[],peers=[];let timerId=0,frames=0;
  const stream={getTracks:()=>[],getVideoTracks:()=>[]};
  class Socket {
    static OPEN=1;
    constructor(){this.readyState=1;this.bufferedAmount=0;this.sent=[];sockets.push(this);}
    send(text){this.sent.push(JSON.parse(text));}
    close(){this.readyState=3;this.onclose?.({code:1000});}
  }
  class Peer {
    constructor(){peers.push(this);}
    async getStats(){return new Map([['video',{type:'inbound-rtp',kind:'video',framesReceived:frames,framesDecoded:0}]]);}
    async setRemoteDescription(value){this.remoteDescription=value;}
    async createAnswer(){return {type:'answer',sdp:'answer'};}
    async setLocalDescription(value){this.localDescription=value;}
    close(){this.closed=true;}
  }
  const context=vm.createContext({URL,Date,crypto:webcrypto,performance:{now:()=>10},
    location:{href:'https://room.test/monitor/room-1/',protocol:'https:'},
    localStorage:{getItem(){return null;},setItem(){}},WebSocket:Socket,RTCPeerConnection:Peer,
    document:{createElement:()=>({captureStream:()=>stream,toDataURL:()=> 'data:image/jpeg;base64,test'})},
    setInterval(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearInterval(id){timers.delete(id);},
    setTimeout(){return ++timerId;},clearTimeout(){},
  });
  const dependency=new vm.SyntheticModule(['createSynchronizedVideo','drawTimedFrame','createServerClock'],function(){
    this.setExport('createSynchronizedVideo',()=>({setCameras(){},push(){},close(){}}));
    this.setExport('drawTimedFrame',()=> 'frame');
    this.setExport('createServerClock',()=>({ping:()=>1,receive(){},estimate:()=>null}));
  },{context});
  const module=new vm.SourceTextModule(source,{context});
  await module.link(()=>dependency);await module.evaluate();
  const seen=[];
  const room=module.namespace.openRoom({role:'monitor',onFrame:id=>seen.push(id),...options});
  const socket=sockets[0];socket.onopen();
  const receive=msg=>socket.onmessage({data:JSON.stringify(msg)});
  receive({type:'joined',connection_id:'pc',heartbeat_interval_ms:1000,heartbeat_timeout_ms:5000});
  const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
  return {room,socket,peers,timers,seen,receive,flush,setFrames:n=>{frames=n;},
    async tick(ms){[...timers.values()].find(timer=>timer.ms===ms)?.fn();await flush();}};
}

test('hidden WebRTC camera uses received frames, detects a stalled counter and ignores a closed peer',async()=>{
  const h=await harness();
  h.receive({type:'room_status',monitor_connection_id:'pc',cameras:[{camera_id:'C0',connection_id:'phone',connected:true,transport:'webrtc'}]});
  h.receive({type:'offer',from_connection_id:'phone',target_connection_id:'pc',camera_id:'C0',payload:{type:'offer',sdp:'offer'}});
  await h.flush();
  h.setFrames(1);await h.tick(500);assert.deepEqual(h.seen,['C0']);
  await h.tick(500);assert.deepEqual(h.seen,['C0']); // No new whole frame, no fake freshness.
  h.setFrames(2);await h.tick(500);assert.deepEqual(h.seen,['C0','C0']);
  h.room.close();h.setFrames(3);await h.tick(500);
  assert.equal(h.seen.length,2);assert.equal(h.peers[0].closed,true);assert.equal(h.timers.size,0);
});

test('server JPEG sender does not turn a frozen source into fresh timestamped video',async()=>{
  const video={videoWidth:640,videoHeight:480,currentTime:1};
  const h=await harness({role:'camera',cameraId:'C0',sourceVideo:video,transport:'server'});
  h.receive({type:'room_status',monitor_connected:true,monitor_connection_id:'pc',cameras:[]});
  await h.tick(1000/15);assert.equal(h.socket.sent.filter(msg=>msg.type==='video_frame').length,0);
  video.currentTime=2;await h.tick(1000/15);
  assert.equal(h.socket.sent.filter(msg=>msg.type==='video_frame').length,1);
  await h.tick(1000/15);assert.equal(h.socket.sent.filter(msg=>msg.type==='video_frame').length,1);
  h.room.close();assert.equal(h.timers.size,0);
});

test('WebRTC restores the same stream after a temporary disconnection',async()=>{
  const displayed=[];const h=await harness({onVideo:(id,stream)=>displayed.push(stream)});
  h.receive({type:'room_status',monitor_connection_id:'pc',cameras:[{camera_id:'C0',connection_id:'phone',connected:true,transport:'webrtc'}]});
  h.receive({type:'offer',from_connection_id:'phone',target_connection_id:'pc',camera_id:'C0',payload:{type:'offer',sdp:'offer'}});
  await h.flush();const pc=h.peers[0],stream={id:'original'};
  pc.ontrack({streams:[stream]});
  pc.connectionState='disconnected';pc.onconnectionstatechange();assert.equal(displayed.at(-1),null);
  pc.connectionState='connected';pc.onconnectionstatechange();assert.equal(displayed.at(-1),stream);
  h.room.close();
});

test('an older server rejecting stop does not close video membership',async()=>{
  const errors=[];const h=await harness({onGameError:(code,type)=>errors.push({code,type})});
  h.room.stopGame('session');h.receive({type:'error',code:'unsupported_message'});
  assert.deepEqual(errors,[{code:'unsupported_message',type:'stop_game'}]);
  assert.equal(h.socket.readyState,1);
  assert.ok(h.timers.size>0);
  h.room.close();
});
