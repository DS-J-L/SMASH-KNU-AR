// Duo stage, WebRTC path (2026-11-20, docs/DUO_STAGE_TEST.md): the PC finds the real person's outline in V's
// received video itself. The same frame is drawn on screen and given to MediaPipe, so the outline always sits on
// the person (the phone-side JPEG path gets this by sending the outline with its JPEG). Depth comes from the
// judging phone's stage-frame joints, else V's own ankles on the floor (view-person.js, same code as the phone).
import {createPoseLandmarker} from '/camera/pose.js?v=20261112-2';
import {copyPersonMask,skeletonMask,torsoMaskCoverage,MIN_TORSO_MASK_COVERAGE} from '../mono3d/person-depth.js?v=20261120-t1';
import {viewPersonDepth,VIEW_MASK_MAX} from './view-person.js?v=20261118-v2';

export function createPcOutline({model='lite'}={}){
  let landmarker=null,loading=null,lastTs=0,error=null,delegate=null,failed=0;
  return {
    load(){
      if(landmarker||loading)return loading;
      loading=createPoseLandmarker(model,['GPU','CPU'],{segmentation:true})
        .then(r=>{landmarker=r.landmarker;delegate=r.delegate;error=null;})
        .catch(e=>{error=String(e?.message??e);})
        .finally(()=>{loading=null;});
      return loading;
    },
    get ready(){return !!landmarker;},
    get status(){return landmarker?`PC 사람 인식 ${delegate}`:error?`PC 사람 인식 모델 없음: ${error}`:'PC 사람 인식 모델 준비 중';},
    // frame: canvas holding V's frame; calib {K (with width/height of V's calibration image), pose}; judge {joints, ageMs}.
    run(frame,now,calib,judge){
      if(!landmarker)return {depth:null,reason:this.status};
      const t0=performance.now(),ts=Math.max(lastTs+1,now);lastTs=ts;
      let out=null,landmarks=null,mask=null,maskError=null;
      try{out=landmarker.detectForVideo(frame,ts);landmarks=out.landmarks?.[0]??null;
        try{mask=copyPersonMask(out.segmentationMasks?.[0],...VIEW_MASK_MAX);}catch(e){maskError=e?.message??'readback_failed';}
      }catch(e){
        // A GPU instance that fails at run time: fall back to the CPU once.
        if(++failed===3){landmarker?.close?.();landmarker=null;createPoseLandmarker(model,['CPU'],{segmentation:true}).then(r=>{landmarker=r.landmarker;delegate=r.delegate;}).catch(()=>{});}
        return {depth:null,reason:`PC 사람 인식 실패: ${e?.message??e}`,ms:performance.now()-t0};
      }finally{out?.close?.();}
      let source='분할 윤곽';
      const coverage=torsoMaskCoverage(mask,landmarks);
      if(landmarks&&(!mask||(coverage!==null&&coverage<MIN_TORSO_MASK_COVERAGE))){
        const ratio=Math.min(1,VIEW_MASK_MAX[0]/frame.width,VIEW_MASK_MAX[1]/frame.height);
        const approx=skeletonMask(landmarks,Math.max(1,Math.round(frame.width*ratio)),Math.max(1,Math.round(frame.height*ratio)));
        if(approx){source='골격 근사 윤곽'+(maskError?' (분할 읽기 실패)':mask?' (분할 윤곽이 몸통과 불일치)':' (분할 윤곽 없음)');mask=approx;}
      }
      const r=viewPersonDepth(mask,landmarks,calib.K,calib.pose,judge);
      const ms=performance.now()-t0;
      if(!r.depth)return {depth:null,landmarks,reason:`가림 보류 · ${r.reason}`,ms};
      const depthText=r.source==='judge'?`판정 폰 관절 깊이${r.swapped?' (좌우 맞춤)':''}`:`바닥 발목 기준 근사 깊이${r.judge_rejected?` (${r.judge_rejected})`:''}`;
      return {depth:r.depth,landmarks,source:r.source,reason:`V 실제 사람 윤곽(PC 계산) · ${source} · ${depthText}`,ms};
    },
  };
}
