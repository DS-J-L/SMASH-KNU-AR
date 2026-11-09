import {validatePackageMetadata,validatePackageModels} from './package-contract.js';
import {ANALYTIC_ID,FILE_HASHES} from '../game/package-selection.js';
import {disposeRoots} from '../game/dispose-roots.js';
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
export async function verifyPackageBytes(name,bytes){if(!Object.hasOwn(FILE_HASHES,name))throw new Error('unrecognized_analytic_file');const h=hex(await crypto.subtle.digest('SHA-256',bytes));if(h!==FILE_HASHES[name])throw new Error('analytic_payload_hash_mismatch:'+name);return h;}
export async function loadPackage({id,base,loader,fetcher=fetch,isCurrent=()=>true}){
 const analytic=id===ANALYTIC_ID,fetchBytes=async name=>{const r=await fetcher(base+name);if(!r.ok)throw new Error(`${name}: HTTP ${r.status}`);const bytes=await r.arrayBuffer();if(analytic)await verifyPackageBytes(name,bytes);return bytes;},json=async name=>JSON.parse(new TextDecoder().decode(await fetchBytes(name)));
 let roots=[];
 try{const[meta,data]=await Promise.all([json('manifest.json'),json('colliders.json')]);validatePackageMetadata(meta,data);if(analytic!== (meta.schema_version==='knu-analytic-app-1.0'))throw new Error('package_selection_schema_mismatch');const names=analytic?[meta.assets.intact,meta.assets.fragments,meta.assets.colliders]:[meta.assets.intact,meta.assets.fragments];const settled=await Promise.allSettled(names.map(async name=>analytic?loader.parseAsync(await fetchBytes(name),base):loader.loadAsync(base+name)));roots=settled.filter(x=>x.status==='fulfilled').map(x=>x.value.scene);const failure=settled.find(x=>x.status==='rejected');if(failure)throw failure.reason;if(!isCurrent())throw new Error('stale_package_load');const[intact,shards,colliderRoot]=roots;validatePackageModels(meta,data,intact,shards,colliderRoot);if(colliderRoot)disposeRoots([colliderRoot]);return {meta,data,intact,shards};}catch(e){disposeRoots(roots);throw e;}
}
