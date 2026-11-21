"""Accuracy gates for the multi-phone test; never synthesize missing body joints."""
from dataclasses import dataclass
from itertools import combinations
import numpy as np


@dataclass
class Estimate:
    position_m: object = None
    camera_ids: tuple = ()
    reprojection_error_px: float | None = None
    reason: str | None = None
    ray_angle_deg: float | None = None


def ray_angle(point, calibs, ids):
    rays=[point-calibs[c].center for c in ids]
    if any(np.linalg.norm(r)<1e-9 for r in rays):return 0.
    rays=[r/np.linalg.norm(r) for r in rays]
    # Acute angle measures conditioning; antiparallel rays are also degenerate.
    return max(np.degrees(np.arccos(np.clip(abs(np.dot(a,b)),0,1))) for a,b in combinations(rays,2))


def errors(point,obs,calibs):
    result={}
    for c,xy in obs.items():
        cal=calibs[c]
        if cal.depth(point)[0]<=.01:result[c]=float('inf');continue
        measured=(cal.K@np.r_[xy,1])[:2]
        result[c]=float(np.linalg.norm(cal.project(point)[0]-measured))
    return result


def refine(point,obs,calibs,weights,ids):
    """Weighted pixel least squares, with a Huber loss against noisy observations."""
    x=point.copy()
    for _ in range(8):
        rows=[];residual=[]
        for c in ids:
            cal=calibs[c];q=cal.R@x+cal.t;z=q[2]
            if z<=.01:return x
            measured=(cal.K@np.r_[obs[c],1])[:2]
            predicted=np.array([cal.K[0,0]*q[0]/z+cal.K[0,2],cal.K[1,1]*q[1]/z+cal.K[1,2]])
            r=measured-predicted
            w=np.sqrt(weights[c]*min(1,4/max(np.linalg.norm(r),1e-9)))
            J=np.array([[cal.K[0,0]/z,0,-cal.K[0,0]*q[0]/z**2],
                        [0,cal.K[1,1]/z,-cal.K[1,1]*q[1]/z**2]])@cal.R
            rows.extend(J*w);residual.extend(r*w)
        J=np.asarray(rows);r=np.asarray(residual)
        try:step=np.linalg.solve(J.T@J+np.eye(3)*1e-8,J.T@r)
        except np.linalg.LinAlgError:break
        if not np.isfinite(step).all():break
        length=np.linalg.norm(step)
        x+=step*min(1,.5/max(length,1e-12))
        if length<1e-7:break
    return x


def estimate(obs,calibs,visibility,max_error_px=8):
    ids=tuple(sorted(obs))
    if len(ids)<2:return Estimate(reason='insufficient_views')
    weights={c:max(.01,min(1,visibility.get(c,1)))**4 for c in ids}
    limits={c:max_error_px*min(calibs[c].width,calibs[c].height)/720 for c in ids}
    candidates=[];bad_geometry=False
    for size in range(len(ids),1,-1):
        for subset in combinations(ids,size):
            rows=[]
            for c in subset:
                x,y=obs[c];P=calibs[c].Rt;w=np.sqrt(weights[c])
                rows.extend([w*(x*P[2]-P[0]),w*(y*P[2]-P[1])])
            try:
                _,_,vt=np.linalg.svd(np.asarray(rows));h=vt[-1]
                if abs(h[3])<1e-12:bad_geometry=True;continue
                point=h[:3]/h[3]
            except np.linalg.LinAlgError:continue
            if not np.isfinite(point).all():continue
            angle=ray_angle(point,calibs,subset)
            if angle<5:bad_geometry=True;continue
            point=refine(point,obs,calibs,weights,subset)
            err=errors(point,obs,calibs)
            inliers=tuple(c for c in ids if err[c]<=limits[c])
            if len(inliers)<2:continue
            point=refine(point,obs,calibs,weights,inliers);err=errors(point,obs,calibs)
            if any(err[c]>limits[c] for c in inliers):continue
            angle=ray_angle(point,calibs,inliers)
            if angle<5:bad_geometry=True;continue
            if len(inliers)==len(ids) and size==len(ids):
                return Estimate(point,inliers,max(err[c] for c in inliers),None,angle)
            # All-view residual is a tie breaker; don't select a near-parallel pair just
            # because two noisy rays can intersect with almost zero pixel residual.
            cost=sum(weights[c]*min((err[c]/limits[c])**2,25) for c in ids)
            score=(len(inliers),-cost,angle)
            candidates.append((score,point,inliers,err,angle))
    if not candidates:return Estimate(reason='poor_geometry' if bad_geometry else 'reprojection_error')
    candidates.sort(key=lambda v:v[0],reverse=True)
    best=candidates[0];_,point,used,err,angle=best
    # Three high-confidence detections with conflicting two-view reconstructions cannot
    # identify the bad camera reliably: report ambiguity instead of a fabricated joint.
    if len(ids)>2 and len(used)==2:
        selected_weight=sum(weights[c] for c in used)
        for other in candidates[1:]:
            _,q,other_ids,other_err,_=other
            if other_ids==used:continue
            if (np.linalg.norm(q-point)>.15 and abs(sum(weights[c] for c in other_ids)-selected_weight)<.1
                    and abs(other[0][1]-best[0][1])<.5):
                return Estimate(reason='ambiguous_views')
    return Estimate(point,used,max(err[c] for c in used),None,angle)
