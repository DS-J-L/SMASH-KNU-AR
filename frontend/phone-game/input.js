import {openRoom} from '/shared/room-link.js?v=phone-game-2';

// A matched JPEG and its validated normalized wrists arrive in one packet.
export class PairedReceiver {
  constructor({onFrame,onState}) { Object.assign(this,{onFrame,onState}); }
  setState(state) { if(this.state!==state){this.state=state;this.onState({state});} }
  deliver(canvas,pose,room) {
    const image=document.createElement('canvas');image.width=canvas.width;image.height=canvas.height;
    image.getContext('2d').drawImage(canvas,0,0);image.close=()=>{image.width=image.height=0;};
    this.setState('live');
    this.onFrame(image,{room_id:room,stream_id:pose.stream_id,frame_id:pose.frame_id,
      image_width:image.width,image_height:image.height,observed_at_pc_ms:performance.now(),
      phone_pose:pose,capture_time:pose.capture_time_ms,capture_time_source:pose.timestamp_source});
  }
  stop() { this.setState('disconnected'); }
}

export class RoomInputLink {
  constructor({receiver,onStatus,onMessage}) {
    Object.assign(this,{receiver,onStatus,onMessage});this.pending=new Map();this.frames=new Map();
    this.roomId=new URLSearchParams(location.search).get('room') || 'room-1';
  }
  connect() {
    this.stop();
    if(!['room-1','room-2'].includes(this.roomId)){this.onStatus({state:'failed',alive:false,message:'방 1 또는 방 2를 선택하세요.'});return;}
    this.room=openRoom({role:'monitor',roomId:this.roomId,onVideo:()=>{},
      onState:(state,message)=>{
        if(state==='closed'||state==='error'){this.onMessage({type:'session_lost',reason:'control_disconnected'});this.stop();}
        this.onStatus({state:state==='joined'?'connecting':state,alive:false,message});
      },
      onStatus:status=>{this.status=status;this.refresh();},
      onFrame:id=>{this.frames.set(id,performance.now());},
      onMatchedFrame:(id,canvas,pose)=>{
        if(id!=='C0'||!pose||pose.source!=='live')return;
        if(this.stream!==pose.stream_id){
          if(this.game?.state==='playing')this.room.stopGame(this.game.session_id,'camera_stalled');
          this.stream=pose.stream_id;
          this.onMessage({type:'stream_bound',room_id:this.roomId,stream_id:this.stream,server_epoch:this.status.server_epoch});}
        this.lastPose=performance.now();this.refresh();this.receiver.deliver(canvas,pose,this.roomId);
      },
      onGame:state=>{
        if(!state)return;
        const previous=this.game;
        this.game=state;if(state.state==='ended')this.stopPending=false;
        const pending=this.pending.get(state.session_id);
        if(pending&&state.state==='playing'){clearTimeout(pending.timer);this.pending.delete(state.session_id);
          pending.resolve({...pending.request,type:'start_ack'});}
        if(state.state==='ended'&&previous?.state==='playing'&&previous.session_id===state.session_id)
          this.onMessage({type:'session_lost',reason:state.reason});
        this.onMessage({type:'server_game',game:state});
      },
      onGameError:(code,type)=>{
        if(type==='start_game')for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(code));}
        if(type==='start_game')this.pending.clear();
        if(type==='game_hit'){
          this.onMessage({type:'session_lost',reason:code});
          if(this.game?.state==='playing')this.room?.stopGame(this.game.session_id);
        }
        this.onStatus({state:'connected',alive:this.alive(),message:`서버: ${code}`});
      },
    });
    this.timer=setInterval(()=>this.refresh(),100);
  }
  alive() {
    const now=performance.now();return Boolean(this.room&&this.stream&&this.status?.monitor_connected
      &&now-(this.lastPose ?? -Infinity)<200
      &&this.status.cameras.find(c=>c.camera_id==='C0')?.transport==='server'
      &&this.status.required_cameras.every(id=>this.status.cameras.some(c=>c.camera_id===id&&c.connected)
        &&now-(this.frames.get(id)??-Infinity)<1500));
  }
  refresh(){const alive=this.alive();this.onStatus({state:alive?'connected':'connecting',alive,
    message:alive?null:`${this.roomId==='room-2'?'방 2의 C0 한 대를':'방 1의 C0·C1·C2를'} 연결하고 C0는 서버 중계를 선택하세요. 같은 프레임의 영상·손목 수신 대기 중입니다.`});
    const now=performance.now(),camera=this.status?.cameras.find(c=>c.camera_id==='C0');
    if(!camera?.connected)this.receiver.setState('disconnected');
    else if(this.receiver.state==='live'&&now-(this.frames.get('C0')??-Infinity)>1500)this.receiver.setState('stalled');
    const stalled=now-(this.lastPose??-Infinity)>1500
      ||this.status?.required_cameras.some(id=>now-(this.frames.get(id)??-Infinity)>1500);
    if(this.room&&this.game?.state==='playing'&&stalled&&!this.stopPending){
      this.stopPending=true;this.room.stopGame(this.game.session_id,'camera_stalled');}}
  requestStart(request) {
    return new Promise((resolve,reject)=>{
      if(!this.alive()){reject(new Error('paired_pose_not_ready'));return;}
      const timer=setTimeout(()=>{this.pending.delete(request.session_id);reject(new Error('start_timeout'));},7500);
      this.pending.set(request.session_id,{resolve,reject,timer,request});
      const cameras=this.status.cameras.filter(c=>c.connected).map(c=>({...c,video_ready:true}));
      if(!this.room.startGame(request.session_id,cameras,'phone_2d')){
        clearTimeout(timer);this.pending.delete(request.session_id);reject(new Error('control_disconnected'));}
    });
  }
  send(message) {
    if(message.type==='end')return this.room?.stopGame(message.session_id);
    if(message.type==='log'&&message.entry?.type==='hit_result'&&message.entry.accepted)
      return this.room?.reportHit(message.entry);
    return true;
  }
  cancelStart(id){for(const [sid,p] of this.pending)if(p.request.request_id===id){clearTimeout(p.timer);p.reject(new Error('start_cancelled'));this.pending.delete(sid);}}
  stop(){clearInterval(this.timer);
    if(this.game?.state==='playing')this.room?.stopGame(this.game.session_id);
    this.room?.close();this.room=null;this.stream=null;this.status=null;this.stopPending=false;
    this.game=null;this.frames.clear();this.lastPose=-Infinity;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('control_disconnected'));}this.pending.clear();this.receiver.stop();}
}
