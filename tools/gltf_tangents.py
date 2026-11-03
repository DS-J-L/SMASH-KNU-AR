"""Write orthonormal tangent frames for the exported normal-mapped primitives.

Blender's exporter can emit zero MikkTSpace tangents on small bevels. Calculate
from the final GLB positions/UVs instead; all arrays retain their original data.
"""
import json
import struct
import numpy as np


def add_tangents(path):
    raw=path.read_bytes();size=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+size]);binary=bytearray(raw[28+size:])
    types={5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}
    widths={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}
    def array(index):
        a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']]
        dtype=np.dtype(types[a['componentType']]);width=widths[a['type']]
        return np.ndarray((a['count'],width),dtype=dtype,buffer=binary,
            offset=v.get('byteOffset',0)+a.get('byteOffset',0),
            strides=(v.get('byteStride',width*dtype.itemsize),dtype.itemsize)).astype(np.float64)
    fallback=0;written=0
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            if 'normalTexture' not in doc['materials'][primitive['material']]:continue
            attrs=primitive['attributes'];p=array(attrs['POSITION']);n=array(attrs['NORMAL']);uv=array(attrs['TEXCOORD_0'])
            ids=array(primitive['indices']).astype(int).ravel().reshape(-1,3)
            t=np.zeros_like(p);b=np.zeros_like(p)
            for triangle in ids:
                i,j,k=triangle;e1=p[j]-p[i];e2=p[k]-p[i];du1=uv[j]-uv[i];du2=uv[k]-uv[i]
                det=du1[0]*du2[1]-du2[0]*du1[1]
                if abs(det)<1e-20:continue
                tangent=(e1*du2[1]-e2*du1[1])/det;bitangent=(e2*du1[0]-e1*du2[0])/det
                for vertex in triangle:t[vertex]+=tangent;b[vertex]+=bitangent
            t-=n*np.sum(n*t,axis=1)[:,None];length=np.linalg.norm(t,axis=1)
            for i in np.where(length<1e-12)[0]:
                axis=np.eye(3)[np.argmin(np.abs(n[i]))];t[i]=np.cross(axis,n[i]);fallback+=1
            t/=np.linalg.norm(t,axis=1)[:,None]
            handedness=np.where(np.sum(np.cross(n,t)*b,axis=1)<0,-1.,1.)
            result=np.column_stack((t,handedness)).astype('<f4')
            while len(binary)%4:binary.append(0)
            view=len(doc['bufferViews']);offset=len(binary);binary.extend(result.tobytes())
            doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':result.nbytes,'target':34962})
            attrs['TANGENT']=len(doc['accessors']);doc['accessors'].append({'bufferView':view,'componentType':5126,'count':len(p),'type':'VEC4'})
            written+=len(p)
    doc['buffers'][0]['byteLength']=len(binary)
    payload=json.dumps(doc,ensure_ascii=False,separators=(',',':')).encode('utf-8')
    payload+=b' '*((-len(payload))%4);binary+=b'\0'*((-len(binary))%4)
    path.write_bytes(struct.pack('<III',0x46546c67,2,28+len(payload)+len(binary))+struct.pack('<II',len(payload),0x4e4f534a)+payload+struct.pack('<II',len(binary),0x004e4942)+binary)
    return {'vertices':written,'fallback_vertices':fallback}
