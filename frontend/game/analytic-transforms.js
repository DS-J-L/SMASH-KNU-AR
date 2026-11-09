// Reviewed composition definitions copied unchanged.
export const quat=a=>({x:a[0],y:a[1],z:a[2],w:a[3]});
export function multiplyQuat(a,b){return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];}
export function placed(v,scene){const m=scene.rotation_matrix_row_major,t=scene.translation_m;return [0,1,2].map(a=>t[a]+[0,1,2].reduce((s,k)=>s+m[a*3+k]*v[k],0));}
