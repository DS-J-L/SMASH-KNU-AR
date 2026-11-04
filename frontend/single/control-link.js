// PC consumer of the draft protocol. The room/signaling/control server is a separate deliverable.
export class ControlLink {
  constructor({ receiver, onStatus=()=>{}, onMessage=()=>{}, fetchImpl=(...args)=>fetch(...args), socket=url=>new WebSocket(url), now=()=>performance.now(), baseUrl=globalThis.location?.href??'http://localhost/' }) {
    Object.assign(this,{receiver,onStatus,onMessage,fetchImpl,socket,now,baseUrl});this.epoch=0;this.sockets=[];this.pending=new Map();this.waitingSignals=[];this.retiredStreams=new Set();
  }
  async connect() {
    this.stop(); const epoch=this.epoch;this.abort=new AbortController();
    this.onStatus({state:'connecting',alive:false});
    const timeout=setTimeout(()=>this.abort?.abort(),8000);
    try {
      const response=await this.fetchImpl('/api/single/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'pc',schema:'single_camera.v1-draft'}),signal:this.abort.signal});
      if(epoch!==this.epoch)return;
      if(!response.ok)throw new Error(response.status===404||response.status===405?'신호 서버가 아직 연결되지 않았습니다.':'방을 열지 못했습니다. 서버 접속을 확인하세요.');
      const room=await response.json(); if(epoch!==this.epoch)return;
      if(!['room_id','pc_token','server_epoch'].every(k=>typeof room[k]==='string'&&room[k]))throw new Error('방 정보 형식이 맞지 않습니다.');
      this.room=room;this.bound=false;this.lastHeartbeat=-Infinity;
      for(const path of ['signaling','control']) {
        const url=new URL('/ws/single/'+path,this.baseUrl);url.protocol=url.protocol==='https:'?'wss:':'ws:';
        const ws=this.socket(url.href);this[path]=ws;this.sockets.push(ws);
        ws.onopen=()=>{if(epoch===this.epoch)ws.send(JSON.stringify({schema:'single_camera.v1-draft',type:'join',role:'pc',room_id:room.room_id,token:room.pc_token}));};
        ws.onmessage=e=>{if(epoch!==this.epoch)return;try{this.receive(path,JSON.parse(e.data));}catch{this.fail('서버 메시지 형식이 맞지 않습니다.');}};
        ws.onerror=()=>{if(epoch===this.epoch)this.fail('서버 연결에 실패했습니다.');};
        ws.onclose=()=>{if(epoch===this.epoch)this.fail('제어 연결이 끊겼습니다. 다시 연결하세요.');};
      }
      this.timer=setInterval(()=>{
        if(epoch!==this.epoch)return;
        if(this.control?.readyState===1)this.send({type:'ping'});
        this.onStatus({state:this.bound?'connected':'connecting',alive:this.bound&&this.now()-this.lastHeartbeat<3000,join_url:room.join_url??null});
      },1000);
      this.handshake=setTimeout(()=>{if(epoch===this.epoch&&!this.bound)this.fail('휴대폰 연결 시간이 초과됐습니다. 다시 연결하세요.');},30000);
    } catch(error) {if(epoch===this.epoch)this.fail(error.name==='AbortError'?'서버 응답 시간이 초과됐습니다.':error.message);}
    finally {clearTimeout(timeout);}
  }
  receive(channel,m) {
    if(m.schema!=='single_camera.v1-draft'||m.room_id!==this.room?.room_id)return;
    if(m.server_epoch!==this.room?.server_epoch){this.onMessage({type:'session_lost',reason:'server_epoch_changed'});this.fail('서버가 다시 시작됐습니다. 복원 후 새로 연결하세요.');return;}
    if(channel==='signaling') {
      if(!['offer','ice'].includes(m.type)||typeof m.stream_id!=='string'||!m.stream_id||this.retiredStreams.has(m.stream_id))return;
      if(!this.receiver.binding||this.receiver.binding.stream_id!==m.stream_id){if(this.waitingSignals.length>=64){this.fail('영상 연결 정보가 너무 많습니다. 다시 연결하세요.');return;}this.waitingSignals.push(m);}
      else void this.receiver.receive(m);
      return;
    }
    let newBinding=false;
    if(m.type==='stream_bound'&&this.retiredStreams.has(m.stream_id))return;
    if(m.type==='stream_bound' && typeof m.stream_id==='string' && m.stream_id &&
      (!this.bound || this.streamId!==m.stream_id)) {
      newBinding=true;
      if(this.streamId){this.retiredStreams.add(this.streamId);if(this.retiredStreams.size>32)this.retiredStreams.delete(this.retiredStreams.values().next().value);}
      clearTimeout(this.handshake);this.bound=true;this.lastHeartbeat=this.now();this.streamId=m.stream_id;
      this.receiver.bind({room_id:m.room_id,stream_id:m.stream_id,server_epoch:m.server_epoch},{iceServers:this.room.ice_servers??[]});
      for(const signal of this.waitingSignals)if(signal.stream_id===m.stream_id)void this.receiver.receive(signal);
      this.waitingSignals=[];this.send({type:'receiver_ready',stream_id:m.stream_id},'signaling');
    }
    if(m.type==='pong'||m.type==='stream_bound')this.lastHeartbeat=this.now();
    if(m.type==='start_ack') {const p=this.pending.get(m.request_id);if(p){clearTimeout(p.timer);this.pending.delete(m.request_id);p.resolve(m);}}
    if(m.type!=='stream_bound'||newBinding)this.onMessage(m);
    this.onStatus({state:this.bound?'connected':'connecting',alive:this.bound&&this.now()-this.lastHeartbeat<3000,join_url:this.room.join_url??null});
  }
  alive(){return this.bound&&this.control?.readyState===1&&this.now()-this.lastHeartbeat>=0&&this.now()-this.lastHeartbeat<3000;}
  send(message,channel='control') {
    const ws=this[channel];if(ws?.readyState!==1)return false;
    ws.send(JSON.stringify({schema:'single_camera.v1-draft',room_id:this.room.room_id,server_epoch:this.room.server_epoch,...message}));return true;
  }
  requestStart(request) {
    return new Promise((resolve,reject)=>{
      if(!this.bound||this.now()-this.lastHeartbeat>=3000){reject(new Error('control_disconnected'));return;}
      const timer=setTimeout(()=>{this.pending.delete(request.request_id);reject(new Error('start_timeout'));},7500);
      this.pending.set(request.request_id,{resolve,reject,timer});
      if(!this.send(request)){clearTimeout(timer);this.pending.delete(request.request_id);reject(new Error('control_disconnected'));}
    });
  }
  cancelStart(requestId){const p=this.pending.get(requestId);if(p){clearTimeout(p.timer);this.pending.delete(requestId);p.reject(new Error('start_cancelled'));}}
  fail(message) {this.stop();this.onStatus({state:'failed',alive:false,message});}
  stop() {
    this.epoch++;this.abort?.abort();clearInterval(this.timer);clearTimeout(this.handshake);this.bound=false;this.waitingSignals=[];this.retiredStreams.clear();this.streamId=null;
    for(const ws of this.sockets){ws.onopen=ws.onmessage=ws.onerror=ws.onclose=null;ws.close();}this.sockets=[];
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('control_disconnected'));}this.pending.clear();
    this.receiver.stop();this.onStatus({state:'disconnected',alive:false});
  }
}
