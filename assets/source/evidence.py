"""Review exported GLBs, not only authoring meshes. Outputs stills + full-FPS frames."""
import sys
import json
import math
import hashlib
from pathlib import Path
import bpy
from mathutils import Vector, Matrix

SOURCE=Path(__file__).resolve().parent;ROOT=SOURCE.parents[1];sys.path.insert(0,str(SOURCE))
from geometry import enum
from motion import CLIPS
import studio
assert bpy.app.background
for o in list(bpy.data.objects):bpy.data.objects.remove(o,do_unlink=True)
scene=bpy.context.scene;scene.name='Campus-GLB-Review'
OUT=ROOT/'apps/client/public/assets';E=SOURCE/'evidence';E.mkdir(exist_ok=True)
stamp=hashlib.sha256(b''.join(p.read_bytes() for p in sorted(OUT.glob('*.glb')))).hexdigest()
stamp_path=E/'render-source-sha256.txt'
reuse=stamp_path.exists() and stamp_path.read_text()==stamp
camera=studio.setup();camera.data.ortho_scale=2.10
characters=[]
for index in range(4):
    before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=str(OUT/f'student-{index}.glb'))
    objects=[o for o in scene.objects if o not in before]
    arm=next(o for o in objects if o.type=='ARMATURE')
    clips={tr.name:(tr.strips[0].action,tr.strips[0].action_slot) for tr in arm.animation_data.nla_tracks}
    for tr in arm.animation_data.nla_tracks:tr.mute=True
    arm.animation_data.action,arm.animation_data.action_slot=clips['idle']
    arm.location.x=(index-1.5)*.75
    characters.append((objects,arm,clips))
scene.frame_set(0)
camera.location=(2,-7,2.5);camera.data.ortho_scale=3.7;studio.aim((0,0,.8))
studio.render(E/'variants-glb.png',(1400,900))
for objects,arm,clips in characters[1:]:
    for o in objects:o.hide_render=True
objects,arm,clips=characters[0];arm.location.x=0
camera.location=(2.8,-5,2.05);camera.data.ortho_scale=2.1;studio.aim((0,0,.79))
before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=str(OUT/'crate.glb'))
crate=next(o for o in scene.objects if o not in before and o.type=='MESH')
crate.hide_render=True
socket=next(o for o in objects if o.name=='carryLarge')
crate.parent=socket;crate.matrix_parent_inverse=Matrix.Identity(4);crate.matrix_basis=Matrix.Identity(4)
before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=str(OUT/'cable.glb'))
smallprop=next(o for o in scene.objects if o not in before and o.type=='MESH')
smallprop.parent=next(o for o in objects if o.name=='carrySmall')
smallprop.matrix_parent_inverse=Matrix.Identity(4);smallprop.matrix_basis=Matrix.Identity(4)
smallprop.hide_render=True
for clip,(frames,loop) in CLIPS.items():
    arm.animation_data.action,arm.animation_data.action_slot=clips[clip]
    crate.hide_render=clip not in ['carryIdle','carryWalk']
    smallprop.hide_render=not clip.startswith('carrySmall')
    directory=E/clip;directory.mkdir(exist_ok=True)
    for frame in sorted(set([0,frames//4,frames//2,3*frames//4,frames-1])):
        scene.frame_set(frame)
        if not reuse or not (directory/f'pose-{frame:03d}.png').exists():studio.render(directory/f'pose-{frame:03d}.png',(480,540))
    if clip in CLIPS:
        directory=E/(clip+'-frames');directory.mkdir(exist_ok=True)
        for frame in range(frames):
            scene.frame_set(frame)
            if not reuse or not (directory/f'{frame:03d}.png').exists():studio.render(directory/f'{frame:03d}.png',(360,400))
arm.animation_data.action,arm.animation_data.action_slot=clips['carryIdle']
scene.frame_set(0);crate.hide_render=False
smallprop.hide_render=True
camera.location=(1.8,-3,1.6);camera.data.ortho_scale=1.02;studio.aim((0,-.25,1.0))
studio.render(E/'carry-grip-glb.png',(1000,1000))
arm.animation_data.action,arm.animation_data.action_slot=clips['carrySmallIdle']
scene.frame_set(0);crate.hide_render=True;smallprop.hide_render=False
studio.render(E/'small-grip-glb.png',(1000,1000))
smallprop.hide_render=True
for o in objects:o.hide_render=True
crate.hide_render=True
prop_objects=[];prop_groups={}
names=['crate','cable','fuse','module-sun','module-leaf','module-wave','lantern','banner','flower-pot','bench','station','bunting','tree-round','tree-slender']
for i,name in enumerate(names):
    before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=str(OUT/(name+'.glb')))
    new=[o for o in scene.objects if o not in before]
    for o in new:
        if o.parent is None:o.location.x=(i%4-1.5)*1.8;o.location.y=(i//4)*1.8
    prop_objects.extend(new)
    prop_groups[name]=new
camera.location=(8,-12,10);camera.data.ortho_scale=12;studio.aim((0,2.8,.6))
studio.render(E/'props-glb.png',(1500,1200))
for o in prop_objects:o.hide_render=True
for name,group in prop_groups.items():
    for o in group:
        o.hide_render=False
        if o.parent is None:o.location.x=0;o.location.y=0
    mesh_objects=[o for o in group if o.type=='MESH']
    bpy.context.view_layer.update()
    corners=[o.matrix_world@Vector(v) for o in mesh_objects for v in o.bound_box]
    low=Vector([min(v[i] for v in corners) for i in range(3)])
    high=Vector([max(v[i] for v in corners) for i in range(3)])
    center=(low+high)/2;extent=max(high-low)
    camera.location=center+Vector((extent*.9,-extent*1.7,extent*.8))
    camera.data.ortho_scale=extent*1.5;studio.aim(center)
    studio.render(E/(name+'-detail.png'),(512,512))
    for o in group:o.hide_render=True
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'campus-glb-review.blend'))
stamp_path.write_text(stamp)
print('RENDER_EVIDENCE_DONE')
