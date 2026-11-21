"""IT1 test-only, fixed marker placement, per-fragment swept wrist and ankle (kick) contact."""
from __future__ import annotations

import math
import uuid
from dataclasses import replace
from functools import lru_cache

from backend.model_strike import (CONFIG, Placement, load_model_target, build_model_target,
                                 first_entry, inside_model, standing_in_model)

ANKLES = ("left_ankle", "right_ankle")
STRIKE_JOINTS = ("left_wrist", "right_wrist") + ANKLES
# Body overlapping the building (standing in it, or a hand/foot already inside): a fast move still breaks a
# piece. Slower than this, or jitter below the minimum move, is treated as just standing/touching.
OVERLAP_MIN_SPEED_MPS = 1.5
OVERLAP_MIN_MOVE_M = 0.08

BUILDING_HEIGHT_RATIO = .7


@lru_cache(maxsize=8)
def target_for(placement: Placement, scene_id='it1'):
    if scene_id=='it1':return load_model_target(placement=placement)
    from .building_scenes import scene_spec
    return build_model_target(scene_spec(scene_id)['colliders'],placement)


class FragmentTest:
    def __init__(self, placement=Placement(scale=0.6),scene_id='it1'):
        if scene_id!='it1':placement=replace(placement,scale=1.0)
        self.scene_id=scene_id
        self.target = target_for(placement,scene_id)
        self.collapse = True
        self.blast_enabled = True
        self.blast_radius = 3.0
        self.blast_strength = 12.0
        self.approximate = False
        self.depth_margin = 0.0
        self.body_reference = None
        self.neighbors, self.anchors = support_graph(placement,scene_id)
        self.reset()

    def reset(self):
        self.removed = set()
        self.previous = {}
        self.overlap_hit_at = {}
        self.epoch = uuid.uuid4().hex
        self.pending_event = None
        self.diagnostics = {}

    def clear_tracking(self):
        self.previous.clear()
        self.overlap_hit_at.clear()

    def mouse_hit(self, origin, direction, strength=12.0):
        strength = float(strength)
        if not math.isfinite(strength) or not .1 <= strength <= 20:
            raise ValueError('invalid mouse strength')
        if any(not isinstance(v, (int, float)) or not math.isfinite(v) or abs(v)>100
               for row in (origin, direction) for v in row) or len(origin)!=3 or len(direction)!=3:
            raise ValueError('invalid mouse ray')
        length=math.sqrt(sum(v*v for v in direction))
        if length<1e-8:
            raise ValueError('invalid mouse direction')
        direction=[v/length for v in direction]
        active=replace(self.target,fragments=[f for f in self.target.fragments if f.fragment_id not in self.removed])
        contact=first_entry(active,origin,[origin[k]+direction[k]*50 for k in range(3)])
        if not contact:
            return None
        self.clear_tracking()
        event=self.strike(contact['fragment_id'], 'mouse', direction, contact['point'], strength, self.blast_enabled)
        event['input_mode']='mouse_demo'
        event['strength']=strength
        return event

    def mouse_push(self, fragment_id, point, direction, strength):
        if type(fragment_id) is not int or fragment_id not in self.removed:
            raise ValueError('only released fragments can be pushed')
        for row in (point,direction):
            if not isinstance(row,list) or len(row)!=3 or any(not isinstance(v,(int,float)) or not math.isfinite(v) or abs(v)>100 for v in row):
                raise ValueError('invalid mouse push vector')
        length=math.sqrt(sum(v*v for v in direction))
        strength=float(strength)
        if length<1e-8 or not math.isfinite(strength) or not .1<=strength<=20:
            raise ValueError('invalid mouse push strength/direction')
        return {'event_id':uuid.uuid4().hex,'kind':'mouse_push','input_mode':'mouse_demo',
                'fragment_id':fragment_id,'point_m':point,'direction':[v/length for v in direction],
                'strength':strength,'released_ids':[],'unsupported_ids':[],'points':0}

    def snapshot(self, event=None):
        p = self.target.placement
        return {"building_id": self.target.building_id, "epoch": self.epoch,
                "scene_id":self.scene_id,
                "body_reference":self.body_reference,
                "display_height_m":self.target.hi[2],
                "placement": {"x_m": p.x_m, "y_m": p.y_m, "yaw_deg": p.yaw_deg, "scale": p.scale},
                "fragment_count": len(self.target.fragments), "removed_ids": sorted(self.removed),
                "score": len(self.removed),
                "blast_enabled": self.blast_enabled, "blast_radius": self.blast_radius, "blast_strength": self.blast_strength,
                "depth_margin": self.depth_margin, "diagnostics": self.diagnostics,
                "collapse": self.collapse, "event": event, "bounds": {"lo": self.target.lo, "hi": self.target.hi}}

    def release(self, ids, kind="impact", direction=None, point=None):
        valid = {f.fragment_id for f in self.target.fragments}
        requested = (set(ids) & valid) - self.removed
        self.removed.update(requested)
        unsupported = set()
        if self.collapse:
            unsupported = valid - self.removed - reachable(self.neighbors, self.anchors, self.removed)
            self.removed.update(unsupported)
        if not requested and not unsupported:
            return None
        fid = min(requested or unsupported)
        f = next(f for f in self.target.fragments if f.fragment_id == fid)
        return {"event_id": uuid.uuid4().hex, "kind": kind, "joint": None, "fragment_id": fid,
                "released_ids": sorted(requested | unsupported), "unsupported_ids": sorted(unsupported),
                "points": len(requested | unsupported),
                "direction": direction or [0, 0, 0], "point_m": point or [(a+b)/2 for a,b in zip(f.lo,f.hi)]}

    def strike(self, fid, kind, direction, point, strength, blast, *, all_fragments=False):
        ids=[fid]
        if all_fragments:
            ids=[f.fragment_id for f in self.target.fragments]
            blast=False
        elif blast:
            ids=[f.fragment_id for f in self.target.fragments
                 if sum(max(f.lo[k]-point[k],0,point[k]-f.hi[k])**2 for k in range(3)) <= self.blast_radius**2]
        event=self.release(ids,kind,direction,point)
        if event:
            event.update(fragment_id=fid,strength=strength,blast=blast,blast_radius=self.blast_radius)
            if all_fragments:event['effect_style']='screen_impact_v1'
        return event

    def update(self, joints, at, *, super_smash=False):
        geometry=depth_target_for(self.target.placement,self.depth_margin,self.scene_id)
        active = replace(geometry, fragments=[f for f in geometry.fragments if f.fragment_id not in self.removed])
        positions = {n: j["p"] if j else None for n, j in joints.items()}
        standing = standing_in_model(self.target, positions)
        candidates = []
        self.diagnostics={}
        for name in STRIKE_JOINTS:
            ankle = name in ANKLES
            p = positions.get(name)
            if p is None or len(p) != 3 or not all(math.isfinite(v) for v in p):
                self.previous.pop(name, None)
                self.diagnostics[name]={'reason':'invalid'}
                continue
            gaps=[max(self.target.lo[k]-p[k],0,p[k]-self.target.hi[k]) for k in range(3)]
            diagnostic={'position_m':list(p),'depth_gap_m':round(gaps[1],3),'distance_to_bounds_m':round(math.sqrt(sum(v*v for v in gaps)),3)}
            self.diagnostics[name]=diagnostic
            prev = self.previous.get(name)
            self.previous[name] = (list(p), at)
            if prev is None or not 0 < at - prev[1] <= 250 or math.dist(prev[0], p) > 1.5:
                diagnostic['reason']='baseline' if prev is None else 'gap'
                continue
            moved=math.dist(prev[0],p)
            speed=moved/((at-prev[1])/1000)
            fast = speed >= OVERLAP_MIN_SPEED_MPS and moved >= OVERLAP_MIN_MOVE_M
            if standing and not fast:
                diagnostic['reason']='standing'
                continue
            if ankle:
                # Kick rules shared with the model judge (docs/FOOT_STRIKE.md): a foot resting on or
                # walking past the floor-level building must not break it; it has to be lifted and fast.
                lift = p[2] if inside_model(active, p) is not None else max(p[2], prev[0][2])
                if lift < CONFIG.ankle_min_lift_m:
                    diagnostic['reason']='too_low'
                    continue
                if speed < CONFIG.ankle_min_speed_mps:
                    diagnostic['reason']='too_slow'
                    continue
            # Approximate depth can put both points inside the allowance. A deliberate fast swing
            # may hit there, but a first observation or a stationary hand still cannot.
            inside_prev = inside_model(active, prev[0]) is not None
            if inside_prev and not fast and not (self.approximate and speed>=.8 and moved>=.06):
                diagnostic['reason']='inside_slow'
                continue
            contact = first_entry(active, prev[0], p)
            if inside_prev:
                # Overlapping the building: a fast move breaks the piece the hand/foot is in, without needing to
                # enter from outside. One such hit per joint per cooldown so a sweep is not a machine gun.
                if at - self.overlap_hit_at.get(name, -1e9) < CONFIG.cooldown_ms:
                    diagnostic['reason']='cooldown'
                    continue
                if contact is None:
                    here = inside_model(active, p)
                    fid = here if here is not None else inside_model(active, prev[0])
                    contact = {"fragment_id": fid, "t": 1.0, "point": list(p if here is not None else prev[0])}
                contact = dict(contact, overlap=True)
            if contact:
                diagnostic['reason']='contact'
                if contact.get("overlap"):
                    diagnostic['overlap']=True
                    self.overlap_hit_at[name]=at
                candidates.append((contact["t"], name, contact, prev))
            else:diagnostic['reason']='outside'
        event = self.pending_event
        self.pending_event = None
        if candidates and event is None:
            _, name, contact, prev = min(candidates, key=lambda c: c[0])
            delta=[positions[name][k]-prev[0][k] for k in range(3)]
            speed=math.sqrt(sum(v*v for v in delta))/((at-prev[1])/1000)
            event = self.strike(contact["fragment_id"], "ankle" if name in ANKLES else "wrist", delta, contact["point"],
                                min(20,self.blast_strength*max(.6,min(1.5,speed/2))),self.blast_enabled and speed>=.8,
                                all_fragments=super_smash)
            event["joint"] = name
            if contact.get("overlap"):event['overlap']=True
            event['approx_depth_margin_m']=self.depth_margin
        return self.snapshot(event)


@lru_cache(maxsize=32)
def depth_target_for(placement, margin,scene_id='it1'):
    target=target_for(placement,scene_id)
    if not margin:return target
    # Minkowski extension along marker Y only; X and height are never enlarged.
    return replace(target,fragments=[replace(f,planes=[(n,d+abs(n[1])*margin) for n,d in f.planes]+
        [([1,0,0],f.hi[0]),([-1,0,0],-f.lo[0]),([0,0,1],f.hi[2]),([0,0,-1],-f.lo[2])],
        lo=[f.lo[0],f.lo[1]-margin,f.lo[2]],hi=[f.hi[0],f.hi[1]+margin,f.hi[2]]) for f in target.fragments],
        lo=[target.lo[0],target.lo[1]-margin,target.lo[2]],hi=[target.hi[0],target.hi[1]+margin,target.hi[2]])


def reachable(neighbors, anchors, removed):
    seen = set(anchors) - removed
    queue = list(seen)
    while queue:
        for n in neighbors[queue.pop()] - removed - seen:
            seen.add(n)
            queue.append(n)
    return seen


def model_command(model, message):
    """Shared authenticated viewer commands, independently owned by mono and multi hubs."""
    kind=message.get('type')
    if kind=='multi3d_model_config' and model.body_reference:return model
    if kind in ('multi3d_model_config','multi3d_model_scene'):
        scene_id=message.get('scene_id',model.scene_id)
        # Zones (several buildings) belong to the 3-camera mode; the 1-camera mode always shows the single IT1 building.
        if kind=='multi3d_model_scene' and not isinstance(scene_id,str):
            raise ValueError('scene_id must be a string')
        if model.approximate and scene_id!=model.scene_id:
            from .building_scenes import is_single_scene
            if not is_single_scene(scene_id):raise ValueError('1-camera mode shows one building at a time')
        p=message.get('placement',{})
        if kind=='multi3d_model_scene':p=model.target.placement.__dict__
        if not isinstance(p,dict):raise ValueError('placement must be an object')
        placement=Placement(**{k:float(p.get(k,default)) for k,default in
                              (('x_m',0),('y_m',0),('yaw_deg',0),('scale',.6))})
        if not all(math.isfinite(v) for v in (placement.x_m,placement.y_m,placement.yaw_deg,placement.scale)) or not .1<=placement.scale<=2 or max(abs(placement.x_m),abs(placement.y_m))>5:
            raise ValueError('invalid model placement')
        if scene_id!='it1':placement=replace(placement,scale=1.0)
        elif kind=='multi3d_model_scene' and model.scene_id!='it1':placement=replace(placement,scale=.6)
        new=FragmentTest(placement,scene_id);new.approximate=model.approximate;new.depth_margin=model.depth_margin
        new.collapse=model.collapse;new.blast_enabled=model.blast_enabled
        new.blast_radius=model.blast_radius;new.blast_strength=model.blast_strength
        if model.body_reference:
            return apply_body_reference(new,model.body_reference)
        return new
    if kind=='multi3d_model_reset':model.reset()
    elif kind=='multi3d_model_mouse':
        a,b=message.get('origin'),message.get('direction')
        if not isinstance(a,list) or not isinstance(b,list):raise ValueError('mouse ray must be lists')
        model.pending_event=model.mouse_hit(a,b,message.get('strength',12))
    elif kind=='multi3d_model_push':
        model.pending_event=model.mouse_push(message.get('fragment_id'),message.get('point_m'),message.get('direction'),message.get('strength',12))
    elif kind=='multi3d_model_blast_config':
        enabled=message.get('enabled');radius=float(message.get('radius',3));strength=float(message.get('strength',12))
        if not isinstance(enabled,bool) or not math.isfinite(radius) or not .1<=radius<=10 or not math.isfinite(strength) or not .1<=strength<=20:raise ValueError('invalid blast config')
        model.blast_enabled=enabled;model.blast_radius=radius;model.blast_strength=strength
    elif kind=='multi3d_model_depth_config':
        margin=float(message.get('margin',0))
        if not model.approximate or not math.isfinite(margin) or not 0<=margin<=.5:raise ValueError('invalid approximate depth margin')
        model.depth_margin=margin;model.clear_tracking()
    elif kind=='multi3d_model_collapse':
        if not isinstance(message.get('enabled'),bool):raise ValueError('enabled must be boolean')
        model.collapse=message['enabled'];model.pending_event=model.release([], 'support')
    elif kind in ('multi3d_model_release','multi3d_model_drop_all'):
        ids=message.get('ids',[]) if kind=='multi3d_model_release' else [f.fragment_id for f in model.target.fragments]
        if not isinstance(ids,list) or len(ids)>len(model.target.fragments) or any(type(v) is not int for v in ids) or (kind=='multi3d_model_release' and len(ids)>8):raise ValueError('invalid fragment IDs')
        model.pending_event=model.release(ids,'debris' if kind=='multi3d_model_release' else 'synthetic_drop');model.clear_tracking()
    else:raise ValueError('unsupported model command')
    return model


def apply_body_reference(model, reference):
    """An explicit capture fixes scale and marker anchoring until the next capture."""
    if not isinstance(reference,dict) or not isinstance(reference.get('id'),str):raise ValueError('invalid body reference')
    waist=reference.get('waist_height_m')
    if type(waist) not in (int,float) or not math.isfinite(waist) or not .6<=waist<=1.3:raise ValueError('invalid waist height')
    if model.body_reference and model.body_reference['id']==reference['id']:return model
    base=target_for(Placement(scale=1),model.scene_id)
    scale=waist*BUILDING_HEIGHT_RATIO/base.hi[2]
    # Zone factory defaults to scale=1; apply the frozen person factor afterwards.
    model.target=target_for(Placement(scale=scale),model.scene_id)
    model.neighbors,model.anchors=support_graph(model.target.placement,model.scene_id)
    model.body_reference=dict(reference);model.reset()
    return model


@lru_cache(maxsize=8)
def support_graph(placement,scene_id='it1'):
    """Approximate welded contacts at rest, not a structural stress/material solver."""
    fragments = target_for(placement,scene_id).fragments
    from .building_scenes import scene_spec
    sources={} if scene_id=='it1' else {f['fragment_id']:f['building_id'] for f in scene_spec(scene_id)['colliders']['fragments']}
    tolerance = .003 * placement.scale
    neighbors = {f.fragment_id: set() for f in fragments}
    for i,a in enumerate(fragments):
        for b in fragments[i+1:]:
            if sources and sources[a.fragment_id]!=sources[b.fragment_id]:continue
            if not all(a.lo[k] <= b.hi[k]+tolerance and b.lo[k] <= a.hi[k]+tolerance for k in range(3)):
                continue
            # Opposed shared face planes + overlapping bounds infer a glued connection.
            if any(sum(n[k]*m[k] for k in range(3)) < -.9999 and abs(d+e) < tolerance
                   for n,d in a.planes for m,e in b.planes):
                neighbors[a.fragment_id].add(b.fragment_id)
                neighbors[b.fragment_id].add(a.fragment_id)
    anchors = {f.fragment_id for f in fragments if f.lo[2] <= tolerance}
    # Do not spontaneously collapse authored disconnected decorative pieces at startup.
    anchors |= set(neighbors) - reachable(neighbors, anchors, set())
    return neighbors, anchors
