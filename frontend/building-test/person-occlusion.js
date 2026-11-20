import * as THREE from 'three';
const ENCODING='camera_z_mm_rg16_alpha_v1';

export async function loadOcclusionTexture(packet){
  if(!packet||packet.encoding!==ENCODING||!Number.isInteger(packet.width)||!Number.isInteger(packet.height)
    ||packet.width<1||packet.width>384||packet.height<1||packet.height>384
    ||typeof packet.data!=='string'||packet.data.length>400000||!packet.data.startsWith('data:image/png;base64,'))return null;
  try{
    const img=new Image();img.src=packet.data;await img.decode();
    if(img.naturalWidth!==packet.width||img.naturalHeight!==packet.height)return null;
    const texture=new THREE.Texture(img);texture.colorSpace=THREE.NoColorSpace;
    texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
    return texture;
  }catch{return null;}
}

export class PersonOcclusion{
  constructor(scene){
    this.texture=null;this.frameId=null;
    this.material=new THREE.ShaderMaterial({
      uniforms:{personDepth:{value:null},nearZ:{value:.01},farZ:{value:50}},
      vertexShader:'varying vec2 screenUV; void main(){screenUV=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:`uniform sampler2D personDepth;uniform float nearZ;uniform float farZ;varying vec2 screenUV;
        void main(){vec4 value=texture2D(personDepth,screenUV);if(value.a<.5)discard;
          float mm=floor(value.r*255.+.5)*256.+floor(value.g*255.+.5);float z=mm*.001;
          if(z<=nearZ||z>=farZ)discard;
          gl_FragDepth=.5*((farZ+nearZ)/(farZ-nearZ)-(2.*farZ*nearZ)/((farZ-nearZ)*z))+.5;}`,
      colorWrite:false,depthWrite:true,depthTest:true,depthFunc:THREE.AlwaysDepth,toneMapped:false,
    });
    this.mesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.material);
    this.mesh.renderOrder=-1000;this.mesh.frustumCulled=false;this.mesh.visible=false;scene.add(this.mesh);
  }
  // Swapping in the next outline keeps the current visibility; the draw loop decides it before each render.
  setFrame(texture,frameId){
    const visible=this.mesh.visible;
    this.clear();this.texture=texture;this.frameId=texture?frameId:null;this.material.uniforms.personDepth.value=texture;
    this.mesh.visible=visible&&!!texture;
  }
  clear(){this.mesh.visible=false;this.texture?.dispose();this.texture=null;this.frameId=null;this.material.uniforms.personDepth.value=null;}
  update(active){this.mesh.visible=Boolean(active&&this.texture);}
  snapshot(){return {hasMask:!!this.texture,visible:this.mesh.visible,frameId:this.frameId};}
  dispose(){this.clear();this.mesh.removeFromParent();this.mesh.geometry.dispose();this.material.dispose();}
}
