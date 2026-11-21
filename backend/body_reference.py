"""Explicit stable standing capture; never follows a moving person after capture."""
import math
import statistics
import uuid


class BodyCapture:
    def __init__(self):
        self.reference=None;self.active=False;self.samples=[];self.reason='start_required'

    def start(self):
        self.reference=None;self.active=True;self.samples=[];self.reason='stand_on_marker'

    def invalidate(self):
        self.reference=None;self.active=False;self.samples=[];self.reason='camera_changed'

    def update(self,joints,at,ready_cameras):
        if not self.active:return False
        names=('left_hip','right_hip','left_ankle','right_ankle','left_shoulder','right_shoulder','nose')
        points=[joints.get(n,{}).get('p') if joints.get(n) else None for n in names]
        if ready_cameras!=3 or any(p is None for p in points):
            self.samples=[];self.reason='three_views_and_full_body_required';return False
        lh,rh,la,ra,ls,rs,nose=points
        center=[(la[k]+ra[k])/2 for k in range(3)]
        waist=(lh[2]+rh[2])/2;shoulder=(ls[2]+rs[2])/2
        if (math.hypot(*center[:2])>.15 or abs(la[2]-ra[2])>.08 or not -.03<=center[2]<=.2
            or not .35<waist<1.5 or shoulder-waist<.15 or nose[2]-shoulder<.05):
            self.samples=[];self.reason='stand_upright_on_marker';return False
        height=(nose[2]-(center[2]-.08))/.92
        value=max(.6,min(1.3,.6*height))
        if self.samples and (at-self.samples[-1][0]>250 or abs(value-statistics.median(s[1] for s in self.samples))>.04):self.samples=[]
        if not self.samples or at>self.samples[-1][0]:self.samples.append((at,value))
        self.samples=self.samples[-150:];self.reason='hold_still'
        if len(self.samples)>=20 and at-self.samples[0][0]>=2500:
            self.reference={'id':uuid.uuid4().hex,'waist_height_m':statistics.median(v for _,v in self.samples),
                'anchor_m':[0,0,0],'source':'three_view_standing','samples':len(self.samples)}
            self.active=False;self.reason='locked';return True
        return False

    def snapshot(self):
        return {'state':'locked' if self.reference else 'capturing' if self.active else 'required',
                'reason':self.reason,'samples':len(self.samples),'reference':self.reference}
