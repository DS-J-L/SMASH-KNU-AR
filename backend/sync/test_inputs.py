"""Input-frame alignment for the standalone multi-camera test (not hardware exposure sync)."""
from collections import deque
import math
from .clock import DeviceClock
MAX_SPREAD_MS=40
MAX_NEAREST_MS=30


class InputFrames:
    def __init__(self):
        self.clocks={};self.pending={};self.buffers={};self.last_input={}

    def reset(self,camera):
        for store in (self.clocks,self.pending,self.buffers,self.last_input):store.pop(camera,None)

    def ping(self,camera,nonce,at):
        pending=self.pending.setdefault(camera,{})
        pending[nonce]=at
        if len(pending)>8:pending.pop(next(iter(pending)))
        return {'type':'multi3d_clock_ping','nonce':nonce,'server_send_ms':at}

    def pong(self,camera,m,at):
        nonce=m.get('nonce');sent=self.pending.setdefault(camera,{}).pop(nonce,None) if isinstance(nonce,str) else None
        value=m.get('device_time_ms');clock_id=m.get('clock_id')
        if sent is None or not isinstance(clock_id,str) or not 1<=len(clock_id)<=100 or isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value):
            raise ValueError('invalid clock response')
        clock=self.clocks.setdefault(camera,DeviceClock())
        if clock.clock_id is not None and clock.clock_id!=clock_id:
            self.buffers.pop(camera,None);self.last_input.pop(camera,None)
        if not clock.add(clock_id,sent,value,at):raise ValueError('invalid clock round trip')

    def add(self,camera,frame,message):
        if 'input_at_ms' not in message and 'clock_id' not in message:
            frame.update(sample_at=frame['at'],timing='server_arrival',uncertainty=0.)
        else:
            stamp=message.get('input_at_ms');clock_id=message.get('clock_id')
            if isinstance(stamp,bool) or not isinstance(stamp,(int,float)) or not math.isfinite(stamp) or not isinstance(clock_id,str):raise ValueError('invalid input timestamp')
            clock=self.clocks.get(camera);sample=clock.to_server(clock_id,stamp) if clock else None
            uncertainty=clock.uncertainty_ms if clock else None
            frame.update(sample_at=sample,timing='inference_input_aligned',uncertainty=uncertainty)
            if sample is not None:
                if sample>frame['at']+max(5,uncertainty or 0) or frame['at']-sample>400:raise ValueError('stale or future input frame')
                previous=self.last_input.get(camera)
                if previous and previous[0]==clock_id and stamp<=previous[1]:return False
                self.last_input[camera]=(clock_id,stamp)
        self.buffers.setdefault(camera,deque(maxlen=60)).append(frame)
        return True

    def select(self,live):
        timed=any(f.get('timing')=='inference_input_aligned' for f in live.values())
        mode='inference_input_aligned' if timed else 'server_arrival';excluded={}
        available={}
        for c,current in live.items():
            if current.get('timing','server_arrival')!=mode:excluded[c]='timestamp_mode';continue
            if mode=='inference_input_aligned' and (current.get('sample_at') is None or (current.get('uncertainty') or 0)>10):
                excluded[c]='clock_uncertain';continue
            fs=[f for f in self.buffers.get(c,[current]) if f.get('sample_at',f['at']) is not None and f.get('timing',mode)==mode and current['at']-f['at']<=400]
            if fs:available[c]=fs
        if not available:return {},mode,None,excluded
        newest=max(fs[-1].get('sample_at',fs[-1]['at']) for fs in available.values())
        target=min(fs[-1].get('sample_at',fs[-1]['at']) for fs in available.values() if fs[-1].get('sample_at',fs[-1]['at'])>=newest-100)
        selected={}
        window=MAX_NEAREST_MS if timed else MAX_SPREAD_MS
        for c,fs in available.items():
            f=min(fs,key=lambda f:abs(f.get('sample_at',f['at'])-target))
            if abs(f.get('sample_at',f['at'])-target)<=window:selected[c]=f
            else:excluded[c]='time_skew'
        # Include clock uncertainty in the allowed pairwise spread budget.
        while len(selected)>1:
            ordered=sorted(selected,key=lambda c:selected[c].get('sample_at',selected[c]['at']))
            a,b=ordered[0],ordered[-1]
            spread=selected[b].get('sample_at',selected[b]['at'])-selected[a].get('sample_at',selected[a]['at'])
            if spread+(selected[a].get('uncertainty') or 0)+(selected[b].get('uncertainty') or 0)<=MAX_SPREAD_MS:break
            worst=max((a,b),key=lambda c:abs(selected[c].get('sample_at',selected[c]['at'])-target))
            selected.pop(worst);excluded[worst]='time_skew'
        return selected,mode,target,excluded
