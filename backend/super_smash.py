"""Opt-in policy for the three-view test hub. No approximate or demo hit promotion."""
from collections import OrderedDict
import math
import uuid

from .fragment_test import STRIKE_JOINTS, model_command


class SuperSmash:
    def __init__(self):
        self.instance = uuid.uuid4().hex
        self.mode = 'normal'
        self.revision = 0
        self.control_revision = 0
        self.calibration_version = 0
        self.controller = None
        self.lease_at = -1e30
        self.pc_ready = False
        self.pc_epoch = None
        self.paused = False
        self.phase = 'normal'
        self.reason = 'normal'
        self.requests = {}
        self.input_modes = {}
        self.input_mode = 'unknown'
        self.clear()

    def clear(self):
        self.stable_at = None
        self.joints = {}
        self.last_observed = None

    def invalidate(self, model):
        self.calibration_version += 1
        self.clear()
        if model:
            model.clear_tracking()

    def expire(self, now):
        if self.controller is not None and now-self.lease_at > 3000:
            self.controller = None
            self.pc_ready = False
            self.control_revision += 1
            self.clear()

    def disconnect(self, viewer):
        self.requests.pop(viewer, None)
        if self.controller == viewer:
            self.controller = None
            self.pc_ready = False
            self.control_revision += 1
            self.clear()

    def presentation(self, message, viewer, model, now):
        age = message.get('c0_frame_age_ms')
        if (viewer != self.controller or message.get('server_instance_id') != self.instance
                or message.get('epoch') != model.epoch):
            return False
        if type(age) not in (int, float) or not math.isfinite(age) or age < 0:
            raise ValueError('invalid C0 frame age')
        self.lease_at = now
        self.pc_epoch = model.epoch
        self.pc_ready = (message.get('presentation_ready') is True and message.get('visible') is True
                         and message.get('assets_ready') is True and age <= 500)
        return True

    def decorate(self, snapshot, delivery='update'):
        self.revision += 1
        event = snapshot.get('event')
        if event and event.get('effect_style') == 'screen_impact_v1':
            self.phase = 'cleared'
            self.reason = 'cleared'
        snapshot.update(server_instance_id=self.instance, model_revision=self.revision,
                        control_revision=self.control_revision, calibration_version=self.calibration_version,
                        controller_viewer_id=self.controller, smash_mode=self.mode, phase=self.phase,
                        delivery='event' if event else delivery,
                        readiness={'ready': self.phase == 'armed', 'reason': self.reason,
                                   'joints': sorted(n for n,s in self.joints.items() if s.get('armed')),
                                   'input_mode': self.input_mode})
        if event:
            event.update(server_instance_id=self.instance, epoch=snapshot['epoch'], scene_id=snapshot['scene_id'],
                         model_revision=self.revision, calibration_version=self.calibration_version,
                         smash_mode=self.mode, tracking_source='multi_view_test')
            if event.get('effect_style') == 'screen_impact_v1':
                event.update(input_mode=self.input_mode, input_reference_ms=self.last_observed,
                             joint_cameras=self.joints.get(event.get('joint'), {}).get('cams', []))
        return snapshot

    def control(self, message, viewer, hub, now):
        self.expire(now)
        request = message.get('request_id')
        if not isinstance(request, str) or not 1 <= len(request) <= 100:
            raise ValueError('invalid request_id')
        cache = self.requests.setdefault(viewer, OrderedDict())
        if request in cache:
            return cache[request], None
        model = hub.fragment_test
        code = 'ok'
        if message.get('server_instance_id') != self.instance: code = 'stale_instance'
        elif message.get('expected_epoch') != model.epoch: code = 'stale_epoch'
        elif type(message.get('expected_control_revision')) is not int or message['expected_control_revision'] != self.control_revision: code = 'stale_control_revision'
        elif message.get('action') != 'claim_controller' and viewer != self.controller: code = 'not_controller'
        else:
            action = message.get('action')
            changed = True
            try:
                common={'type','request_id','server_instance_id','expected_epoch','expected_control_revision','action'}
                extra={'set_mode':{'mode'},'set_scene':{'scene_id'},'handoff_controller':{'viewer_id'}}.get(action,set())
                if set(message)-common-extra:raise ValueError('unexpected control fields')
                if action == 'claim_controller':
                    if self.controller not in (None, viewer): code = 'not_controller'
                    else:
                        changed = self.controller != viewer
                        self.controller = viewer
                        self.lease_at = now
                elif action == 'handoff_controller':
                    target = message.get('viewer_id')
                    if target not in hub.viewer_ids.values(): raise ValueError('viewer unavailable')
                    self.controller = target
                    self.pc_ready = False
                    self.lease_at = now
                    self.clear()
                elif action == 'set_mode':
                    mode = message.get('mode')
                    if mode not in ('normal', 'super_smash'): raise ValueError('invalid mode')
                    changed = mode != self.mode
                    if changed:
                        self.mode = mode
                        model.reset()
                        self.paused = False
                        self.pc_ready = False
                        self.clear()
                elif action == 'reset':
                    model.reset()
                    self.pc_ready = False
                    self.clear()
                elif action in ('pause', 'resume'):
                    self.paused = action == 'pause'
                    model.clear_tracking()
                    self.clear()
                elif action == 'set_scene':
                    hub.fragment_test = model_command(model, {'type':'multi3d_model_scene','scene_id':message.get('scene_id')})
                    self.pc_ready = False
                    self.clear()
                else:
                    raise ValueError('unsupported action')
            except (ValueError, TypeError, KeyError):
                code = 'invalid_command'
            if code == 'ok' and changed:
                self.control_revision += 1
        self.phase = ('paused' if self.paused else 'normal' if self.mode == 'normal' else
                      'cleared' if len(hub.fragment_test.removed)==len(hub.fragment_test.target.fragments) else 'preparing')
        self.reason = self.phase
        state = self.decorate(hub.fragment_test.snapshot(), 'snapshot')
        ack = {'type':'multi3d_model_control_ack','request_id':request,'accepted':code=='ok','code':code,
               **{k:state[k] for k in ('server_instance_id','epoch','control_revision','model_revision','smash_mode','phase')}}
        cache[request] = ack
        if len(cache)>128:cache.popitem(last=False)
        return ack, state

    def gate(self, hub, joints, observed_at, now, timing, views, can_hit):
        """None means the same input sample: preserve previous points without judging twice."""
        self.expire(now)
        model = hub.fragment_test
        if self.mode == 'normal' and not self.paused:
            self.phase = self.reason = 'normal'
            return joints if can_hit else {}
        reason = None
        if self.paused: reason = 'paused'
        elif len(model.removed) == len(model.target.fragments): reason = 'cleared'
        elif not self.controller or not self.pc_ready or self.pc_epoch != model.epoch: reason = 'pc_not_ready'
        elif not can_hit: reason = 'body_not_ready'
        else:
            status = hub.status()['cameras']
            for c in ('C0','C1','C2'):
                s = status[c]
                if not s['connected'] or not s['calibrated'] or s['age_ms'] is None or s['age_ms']>400:
                    reason = 'three_cameras_required';break
                if not s['clock_ready'] or s['clock_uncertainty_ms'] is None or s['clock_uncertainty_ms']>10:
                    reason = 'clock_not_ready';break
            if not reason and (timing != 'inference_input_aligned' or len(views)<2): reason = 'input_not_aligned'
        modes={self.input_modes.get(c,'unknown') for c in views}
        self.input_mode=next(iter(modes)) if len(modes)==1 else 'unknown'
        if not reason and self.input_mode not in ('live','synthetic','replay'):reason='input_source_unknown'
        if reason:
            self.clear();model.clear_tracking()
            self.reason = reason
            self.phase = reason if reason in ('paused','cleared') else 'preparing'
            return {}
        self.stable_at = now if self.stable_at is None else self.stable_at
        if self.last_observed is not None and observed_at <= self.last_observed:return None
        self.last_observed = observed_at
        allowed={}
        for name in STRIKE_JOINTS:
            joint=joints.get(name);p=joint.get('p') if joint else None
            cams=joint.get('cams',[]) if joint else []
            valid=(isinstance(p,list) and len(p)==3 and all(type(x) in (int,float) and math.isfinite(x) for x in p)
                   and len(set(cams)&set(views))>=2)
            previous=self.joints.get(name)
            if valid and previous and (observed_at-previous['at']>250 or math.dist(previous['p'],p)>1.5):
                previous=None;self.joints.pop(name,None);model.previous.pop(name,None);model.overlap_hit_at.pop(name,None)
            if not valid:
                self.joints.pop(name,None);model.previous.pop(name,None);model.overlap_hit_at.pop(name,None);continue
            state=previous or {'outside_at':None,'samples':0,'armed':False}
            outside=all(sum(max(f.lo[k]-p[k],0,p[k]-f.hi[k])**2 for k in range(3))>=.05**2
                        for f in model.target.fragments if f.fragment_id not in model.removed)
            if not state['armed']:
                if outside:
                    state['outside_at']=observed_at if state['outside_at'] is None else state['outside_at']
                    state['samples']+=1
                    state['armed']=(state['samples']>=2 and observed_at-state['outside_at']>=100 and now-self.stable_at>=300)
                else:state.update(outside_at=None,samples=0)
            state.update(p=p,at=observed_at,cams=cams);self.joints[name]=state
            if state['armed']:allowed[name]=joint
            else:model.previous.pop(name,None)
        self.phase='armed' if allowed else 'preparing'
        self.reason='ready' if allowed else 'move_outside_to_prepare'
        return allowed
