import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VideoReceiver} from '../../frontend/single/video-receiver.js';
import {ControlLink} from '../../frontend/single/control-link.js';
const turn=()=>new Promise(r=>setImmediate(r));
const binding={room_id:'room',stream_id:'stream',server_epoch:'epoch'};
function peer(){return {remoteDescription:null,localDescription:null,closed:false,candidates:[],async setRemoteDescription(d){this.remoteDescription=d;},async createAnswer(){return {type:'answer',sdp:'answer'};},async setLocalDescription(d){this.localDescription=d;},async addIceCandidate(c){this.candidates.push(c);},close(){this.closed=true;}};}
const video=()=>({pause(){},srcObject:null,cancelVideoFrameCallback(){}});
test('T-SC-12 ICE before offer is queued/deduplicated and room/stream ownership checked',async()=>{
  const pc=peer(),sent=[],r=new VideoReceiver({video:video(),createPeer:()=>pc,sendSignal:m=>sent.push(m)});r.bind(binding);
  const ice={...binding,type:'ice',candidate:{candidate:'candidate-1'}};
  await r.receive(ice);await r.receive(ice);assert.equal(pc.candidates.length,0);
  await r.receive({...binding,type:'offer',sdp:'offer'});assert.equal(pc.candidates.length,1);assert.equal(sent[0].type,'answer');
  assert.equal(await r.receive({...binding,stream_id:'old',type:'ice',candidate:null}),false);r.stop();assert.equal(pc.closed,true);
});
test('T-SC-12 old unresolved peer cannot block or emit an answer into a replacement stream',async()=>{
  let resolve;const wait=new Promise(r=>resolve=r),first=peer(),second=peer(),sent=[];
  first.setRemoteDescription=async()=>wait;
  const peers=[first,second],r=new VideoReceiver({video:video(),createPeer:()=>peers.shift(),sendSignal:m=>sent.push(m)});
  r.bind(binding);const old=r.receive({...binding,type:'offer',sdp:'old'});await turn();
  r.bind({...binding,stream_id:'replacement'});
  const fresh=r.receive({...binding,stream_id:'replacement',type:'offer',sdp:'new'});
  // Replacement negotiation must finish before the old operation settles.
  assert.equal(await Promise.race([fresh,new Promise(r=>setTimeout(()=>r('blocked'),50))]),true);
  resolve();await old;assert.equal(sent.length,1);assert.equal(sent[0].stream_id,'replacement');r.stop();
});
function controlFixture(){
  const sockets=[],states=[],messages=[],receiver={binding:null,binds:0,received:[],stop(){this.binding=null;},bind(b){this.binding=b;this.binds++;},receive(m){this.received.push(m);}};
  let now=0;
  const link=new ControlLink({receiver,now:()=>now,onStatus:s=>states.push(s),onMessage:m=>messages.push(m),
    fetchImpl:async()=>({ok:true,json:async()=>({room_id:'room',pc_token:'secret',server_epoch:'epoch'})}),
    socket:()=>{const s={readyState:1,sent:[],send(data){this.sent.push(JSON.parse(data));},close(){this.readyState=3;}};sockets.push(s);return s;}});
  return {link,receiver,sockets,states,messages,setNow:v=>{now=v;}};
}
test('T-SC-10/12 signal/control channel ordering, duplicate binding and synchronous ACK',async()=>{
  const x=controlFixture();await x.link.connect();
  const envelope={schema:'single_camera.v1-draft',...binding};
  x.link.receive('signaling',{...envelope,type:'offer',sdp:'before-bind'});assert.equal(x.receiver.received.length,0);
  x.link.receive('control',{...envelope,type:'stream_bound'});assert.equal(x.receiver.received.length,1);
  x.link.receive('control',{...envelope,type:'stream_bound'});assert.equal(x.receiver.binds,1);
  x.link.control.send=data=>{const r=JSON.parse(data);x.link.receive('control',{...r,type:'start_ack'});};
  const request={...envelope,type:'start',request_id:'req',session_id:'session'};
  assert.equal((await x.link.requestStart(request)).session_id,'session');assert.equal(x.link.pending.size,0);x.link.stop();
});
test('T-SC-12 heartbeat uses current clock, wrong room ignored and server restart loses session',async()=>{
  const x=controlFixture();await x.link.connect();const envelope={schema:'single_camera.v1-draft',...binding};
  x.link.receive('control',{...envelope,type:'stream_bound'});assert.equal(x.link.alive(),true);x.setNow(3000);assert.equal(x.link.alive(),false);
  x.link.receive('control',{...envelope,type:'pong',room_id:'other'});assert.equal(x.link.alive(),false);
  x.link.receive('control',{...envelope,type:'pong',server_epoch:'new'});assert.ok(x.messages.some(m=>m.type==='session_lost'));assert.equal(x.link.bound,false);x.link.stop();
});
test('T-SC-12 stop while room request is loading prevents late sockets and pending ACK rejects',async()=>{
  let resolve;const p=new Promise(r=>resolve=r),x=controlFixture();x.link.fetchImpl=()=>p;
  const loading=x.link.connect();x.link.stop();resolve({ok:true,json:async()=>({room_id:'room',pc_token:'secret',server_epoch:'epoch'})});await loading;assert.equal(x.sockets.length,0);
  const y=controlFixture();await y.link.connect();y.link.receive('control',{schema:'single_camera.v1-draft',...binding,type:'stream_bound'});
  const ack=y.link.requestStart({type:'start',request_id:'pending'});y.link.stop();await assert.rejects(ack,/control_disconnected/);
});

test('PR5 review: replacement offer arriving before stream_bound survives channel ordering',async()=>{
  const x=controlFixture();await x.link.connect();
  try {
    const envelope={schema:'single_camera.v1-draft',...binding};
    x.link.receive('control',{...envelope,type:'stream_bound'});
    x.link.receive('signaling',{...envelope,stream_id:'next',type:'offer',sdp:'replacement'});
    assert.equal(x.receiver.received.length,0,'not sent to the old receiver');
    x.link.receive('control',{...envelope,stream_id:'next',type:'stream_bound'});
    assert.equal(x.receiver.received.length,1);assert.equal(x.receiver.received[0].stream_id,'next');
    x.link.receive('signaling',{...envelope,type:'ice',candidate:null});
    assert.equal(x.link.waitingSignals.length,0,'late retired stream is discarded');
  } finally {x.link.stop();}
});
