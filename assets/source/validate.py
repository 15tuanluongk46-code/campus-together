"""Binary glTF structural + actual Blender re-import/evaluation checks."""
import json
import math
import struct
import hashlib
import sys
from pathlib import Path
import bpy
from mathutils import Vector

SOURCE=Path(__file__).resolve().parent;ROOT=SOURCE.parents[1]
sys.path.insert(0,str(SOURCE))
from motion import CLIPS, GAITS
OUT=ROOT/'apps/client/public/assets';EVIDENCE=SOURCE/'evidence'
assert bpy.app.background
# This is a factory-startup validation process, not the MCP/live file.
for obj in list(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
report={'files':{},'errors':[],'blender':bpy.app.version_string}


def check(condition,message):
    if not condition:report['errors'].append(message)


def bounds(objects):
    deps=bpy.context.evaluated_depsgraph_get();points=[]
    for obj in objects:
        if obj.type!='MESH':continue
        evaluated=obj.evaluated_get(deps);data=evaluated.to_mesh()
        points.extend(evaluated.matrix_world@v.co for v in data.vertices)
        evaluated.to_mesh_clear()
    return [[min(p[i] for p in points) for i in range(3)],
            [max(p[i] for p in points) for i in range(3)]]


for path in sorted(OUT.glob('*.glb')):
    raw=path.read_bytes();magic,version,length=struct.unpack_from('<4sII',raw)
    check((magic,version,length)==(b'glTF',2,len(raw)),path.name+': GLB header')
    n,kind=struct.unpack_from('<I4s',raw,12);doc=json.loads(raw[20:20+n])
    meshes=doc.get('meshes',[]);nodes=doc.get('nodes',[]);accessors=doc['accessors']
    names=[node.get('name','') for node in nodes]
    tris=sum(accessors[pr['indices']]['count']//3 for m in meshes for pr in m['primitives'])
    entry={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':tris,'materials':[m.get('name') for m in doc.get('materials',[])],
           'nodes':names,'animations':[a.get('name') for a in doc.get('animations',[])]}
    report['files'][path.name]=entry
    check(not any(name in names for name in ['Cube','Camera','Light']),path.name+': default scene leaked')
    check(tris<30000,path.name+': triangle budget')
    check(len(raw)<8*1024**2,path.name+': byte budget')
    check(all('pbrMetallicRoughness' in m for m in doc['materials']),path.name+': PBR material')
    for a in accessors:
        check(a['count']>0,path.name+': empty accessor')
        for key in ['min','max']:
            check(all(math.isfinite(v) for v in a.get(key,[])),path.name+': finite '+key)
    character=path.stem.startswith('student-')
    if character:
        check(set(CLIPS)==set(entry['animations']),path.name+': exact clips')
        check(all(n in names for n in ['carrySmall','carryLarge']),path.name+': sockets')
        check(len(doc.get('skins',[]))>0,path.name+': skin')
        for m in meshes:
            for pr in m['primitives']:
                check('JOINTS_0' in pr['attributes'] and 'WEIGHTS_0' in pr['attributes'],path.name+': skinned primitives')
    scene=bpy.data.scenes.new('CHECK-'+path.stem);bpy.context.window.scene=scene;scene.render.fps=30
    bpy.ops.import_scene.gltf(filepath=str(path))
    # glTF importer creates a hidden Icosphere custom bone display; it is not asset geometry.
    helpers={b.custom_shape for o in scene.objects if o.type=='ARMATURE' for b in o.pose.bones if b.custom_shape}
    objects=[o for o in scene.objects if o not in helpers]
    entry['importedObjects']=[o.name for o in objects]
    arm=next((o for o in objects if o.type=='ARMATURE'),None)
    if arm:
        arm.animation_data.action=None
        for track in arm.animation_data.nla_tracks:track.mute=True
        for bone in arm.pose.bones:bone.matrix_basis.identity()
    bpy.context.view_layer.update()
    lo,hi=bounds(objects);entry['restBoundsBlender']=[lo,hi]
    entry['restBoundsGltf']=[[lo[0],lo[2],-hi[1]],[hi[0],hi[2],-lo[1]]]
    if character:
        check(1.60<hi[2]<1.71,path.name+': height')
        check(abs(lo[2])<.015,path.name+': feet origin')
        weights=[]
        for obj in objects:
            if obj.type!='MESH':continue
            weights.extend(sum(g.weight for g in v.groups) for v in obj.data.vertices)
        check(all(abs(w-1)<1e-4 for w in weights),path.name+': normalized skin weights')
        # Import creates one action per clip. Identify via NLA strips, preserving slots.
        clips={track.name:(track.strips[0].action,track.strips[0].action_slot) for track in arm.animation_data.nla_tracks}
        entry['motion']={}
        for clip,(action,slot) in clips.items():
            arm.animation_data.action=action;arm.animation_data.action_slot=slot
            frames=round(action.frame_range[1]);lowest=100;highest=-100;samples=[];grips=[];contacts={'L':[],'R':[]};grip_frames=[]
            for frame in range(frames+1):
                scene.frame_set(frame);bpy.context.view_layer.update()
                # Every-frame evaluated skinned mesh floor check.
                low,high=bounds(objects);lowest=min(lowest,low[2]);highest=max(highest,high[2])
                if frame in [0,frames]:samples.append({b.name:[list(row) for row in b.matrix] for b in arm.pose.bones})
                if clip.startswith('carry'):
                    socket_name='carrySmall' if clip.startswith('carrySmall') else 'carryLarge'
                    socket=next(o for o in objects if o.name.split('.')[0]==socket_name)
                    positions=[arm.matrix_world@arm.pose.bones['DEF-hand.'+s].head for s in ['L','R']]
                    grips.append([(v-socket.matrix_world.translation).length for v in positions])
                    grip_frames.append([(socket.matrix_world.inverted()@arm.matrix_world@arm.pose.bones['DEF-hand.'+s].matrix).copy() for s in ['L','R']])
                if clip in GAITS:
                    gait=GAITS[clip]
                    for side,offset in [('L',0),('R',.5)]:
                        phase=(frame/frames+offset)%1
                        if phase<gait['duty'] and frame<frames:
                            foot=arm.matrix_world@arm.pose.bones['DEF-foot.'+side].head
                            contacts[side].append((phase,foot.y-gait['speed']*phase*frames/30,foot.z-.105))
            seam=max(abs(samples[0][name][r][c]-samples[1][name][r][c]) for name in samples[0] for r in range(4) for c in range(4))
            entry['motion'][clip]={'frames':frames+1,'minZ':lowest,'maxZ':highest,'endpointMatrixDelta':seam}
            check(lowest>-.025,path.name+': '+clip+' ground penetration '+str(lowest))
            if CLIPS[clip][1]:check(seam<.001,path.name+': '+clip+' loop seam')
            if grips:
                entry['motion'][clip]['gripDistanceRange']=[min(v for row in grips for v in row),max(v for row in grips for v in row)]
                translation_error=max((pair[i].translation-grip_frames[0][i].translation).length for pair in grip_frames for i in [0,1])
                angle_error=max(pair[i].to_quaternion().rotation_difference(grip_frames[0][i].to_quaternion()).angle for pair in grip_frames for i in [0,1])
                entry['motion'][clip]['gripTranslationDriftM']=translation_error
                entry['motion'][clip]['gripAngleDriftRad']=angle_error
                check(translation_error<.002 and angle_error<.002,path.name+': stable palm frames '+clip)
            if clip in GAITS:
                residual=max(max(v[1] for v in contacts[s])-min(v[1] for v in contacts[s]) for s in ['L','R'])
                sole_error=max(abs(v[2]) for s in ['L','R'] for v in contacts[s])
                entry['motion'][clip]['virtualGroundStanceResidualM']=residual
                entry['motion'][clip]['stanceSoleErrorM']=sole_error
                check(residual<.003 and sole_error<.003,path.name+': stance '+clip)
        arm.animation_data.action=None
    print('VALIDATED',path.name,entry['triangles'],'triangles',entry['bytes'],'bytes',flush=True)
    # Only remove our disposable imported datablocks, in a separate process.
    for obj in objects:bpy.data.objects.remove(obj,do_unlink=True)
report['pass']=not report['errors']
(EVIDENCE/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
if report['pass']:
    manifest_path=OUT/'manifest.json';manifest=json.loads(manifest_path.read_text())
    manifest['files']={name:{k:v for k,v in data.items() if k in ['bytes','sha256','triangles','restBoundsGltf']} for name,data in report['files'].items()}
    manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print('VALIDATION',report['pass'],report['errors'])
if report['errors']:raise RuntimeError('Asset validation failed; see validation.json')
