const requireValue=(ok,message='invalid_fixed_frame')=>{if(!ok)throw new Error(message);};
export const gamma=n=>n*2**-53/(1-n*2**-53);
export function arithmeticBound(...points){return gamma(128)*16*Math.max(1,...points.flat().map(Math.abs));}
export function fixedFrame(origin){requireValue(origin.length===3&&origin.every(Number.isFinite));const o=Object.freeze([...origin]);return Object.freeze({origin:o,toWorld:p=>p.map((x,k)=>x+o[k]),toLocal:p=>p.map((x,k)=>x-o[k]),direction:v=>[...v]});}
export function assertNear(actual,expected,label,...scale){const error=Math.hypot(...actual.map((v,k)=>v-expected[k])),bound=arithmeticBound(actual,expected,...scale);requireValue(error<=bound,`${label}: ${error} > ${bound}`);return {error_m:error,bound_m:bound};}
