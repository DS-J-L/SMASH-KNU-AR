export class VideoReceiver {
  constructor({ video, onFrame=()=>{}, onState=()=>{}, sendSignal=()=>{},
    createPeer=config=>new RTCPeerConnection(config), now=()=>performance.now() }) {
    Object.assign(this,{video,onFrame,onState,sendSignal,createPeer,now});
    this.epoch=0; this.pc=null; this.stream=null; this.callback=null; this.binding=null;
    this.chain=Promise.resolve(); this.state='disconnected';
  }
  status(state, reason=null) { this.state=state; this.onState({state,reason}); }
  bind(binding, rtcConfig={iceServers:[]}) {
    this.stop(); this.binding={...binding}; const epoch=this.epoch;
    const pc=this.createPeer(rtcConfig); this.pc=pc; this.ice=[]; this.iceSeen=new Set(); this.frameId=0; this.lastMedia=-1; this.status('connecting');
    pc.onicecandidate=e=>{if(epoch===this.epoch) this.sendSignal({...this.binding,type:'ice',candidate:e.candidate?.toJSON?.()??null});};
    pc.onconnectionstatechange=()=>{if(epoch===this.epoch && pc.connectionState==='connected' && this.stream) this.play(epoch); if(epoch===this.epoch && ['failed','disconnected','closed'].includes(pc.connectionState)) { this.cancelFrames(); this.status('stalled','영상 연결이 끊겼습니다. 다시 연결하세요.'); }};
    pc.ontrack=e=>{
      if(epoch!==this.epoch || e.track.kind!=='video') {e.track.stop();return;}
      if(this.stream) for(const track of this.stream.getTracks()) if(track!==e.track) {track.onended=track.onmute=track.onunmute=null;track.stop();}
      this.cancelFrames(); this.stream=new MediaStream([e.track]); this.video.srcObject=this.stream;
      e.track.onended=()=>{if(epoch===this.epoch){this.cancelFrames();this.status('stalled','휴대폰 영상이 종료됐습니다.');}};
      e.track.onmute=()=>{if(epoch===this.epoch){this.cancelFrames();this.status('stalled','새 영상 프레임을 기다립니다.');}};
      e.track.onunmute=()=>{if(epoch===this.epoch) this.play(epoch);};
      this.play(epoch);
    };
    return pc;
  }
  async play(epoch) {
    try { await this.video.play(); if(epoch!==this.epoch) return; this.status('live'); this.watchFrames(epoch); }
    catch { if(epoch===this.epoch) this.status('failed','영상 재생을 허용한 뒤 다시 연결하세요.'); }
  }
  receive(message) {
    const epoch=this.epoch, pc=this.pc;
    this.chain=this.chain.catch(()=>{}).then(async()=>{
      if(!pc || epoch!==this.epoch || !['room_id','stream_id'].every(k=>message[k]===this.binding[k])) return false;
      if(message.type==='offer') {
        if(typeof message.sdp!=='string' || pc.remoteDescription) return false;
        await pc.setRemoteDescription({type:'offer',sdp:message.sdp});
        if(epoch!==this.epoch) return false;
        for(const candidate of this.ice) { await pc.addIceCandidate(candidate); if(epoch!==this.epoch) return false; }
        this.ice=[];
        const answer=await pc.createAnswer(); if(epoch!==this.epoch)return false;
        await pc.setLocalDescription(answer); if(epoch!==this.epoch)return false;
        this.sendSignal({...this.binding,type:'answer',sdp:pc.localDescription.sdp}); return true;
      }
      if(message.type==='ice') {
        const candidate=message.candidate;
        if(candidate!==null && (typeof candidate!=='object' || typeof candidate.candidate!=='string')) return false;
        const key=JSON.stringify(candidate); if(this.iceSeen.has(key))return true;
        if(this.iceSeen.size>=128)throw new Error('ice_limit');
        this.iceSeen.add(key);
        if(pc.remoteDescription)await pc.addIceCandidate(candidate); else this.ice.push(candidate);
        return true;
      }
      return false;
    }).catch(error=>{if(epoch===this.epoch)this.status('failed',error.message==='ice_limit'?'연결 정보가 너무 많습니다. 다시 연결하세요.':'영상 연결 정보를 처리하지 못했습니다.');return false;});
    return this.chain;
  }
  watchFrames(epoch) {
    this.cancelFrames();
    const callback=(_now,meta={})=>{
      if(epoch!==this.epoch)return;
      const media=meta.mediaTime??this.video.currentTime;
      const w=this.video.videoWidth,h=this.video.videoHeight;
      if(this.video.readyState>=2 && w>0 && h>0 && media!==this.lastMedia) {
        this.lastMedia=media;
        const observed=this.now(),image=document.createElement('canvas');image.width=w;image.height=h;image.close=()=>{image.width=image.height=0;};
        try {
          image.getContext('2d').drawImage(this.video,0,0,w,h);
          this.onFrame(image,{...this.binding,frame_id:++this.frameId,image_width:w,image_height:h,
            observed_at_pc_ms:observed,media_time_s:media,capture_time:meta.captureTime??null,
            capture_time_source:meta.captureTime==null?'unavailable':'browser_estimate'});
        } catch {this.status('failed','영상 프레임을 읽지 못했습니다.');return;}
      }
      if(epoch===this.epoch)this.callback=this.video.requestVideoFrameCallback?this.video.requestVideoFrameCallback(callback):requestAnimationFrame(callback);
    };
    this.callback=this.video.requestVideoFrameCallback?this.video.requestVideoFrameCallback(callback):requestAnimationFrame(callback);
  }
  cancelFrames() {
    if(this.callback!==null){if(this.video.cancelVideoFrameCallback)this.video.cancelVideoFrameCallback(this.callback);else cancelAnimationFrame(this.callback);}
    this.callback=null;
  }
  stop() {
    this.epoch++; this.cancelFrames(); this.chain=Promise.resolve(); this.ice=[]; this.iceSeen=new Set();
    if(this.pc) {this.pc.ontrack=null;this.pc.onicecandidate=null;this.pc.onconnectionstatechange=null;this.pc.close();}
    if(this.stream) for(const t of this.stream.getTracks()){t.onended=null;t.onmute=null;t.onunmute=null;t.stop();}
    this.pc=null;this.stream=null;this.video.pause();this.video.srcObject=null;this.binding=null;
    this.status('disconnected');
  }
}
