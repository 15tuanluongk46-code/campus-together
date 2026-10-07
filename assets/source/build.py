"""Run with Blender --background --factory-startup --python assets/source/build.py."""
import sys
import json
from pathlib import Path
import bpy

SOURCE=Path(__file__).resolve().parent
ROOT=SOURCE.parents[1]
sys.path.insert(0,str(SOURCE))
assert bpy.app.background, 'Use a separate background Blender; never run in the user live file'
from geometry import enum
from palette import make_palette
from student import build
from motion import animate, CLIPS, GAITS
from props import build_props
import studio

OUT=ROOT/'apps/client/public/assets';OUT.mkdir(parents=True,exist_ok=True)
EVIDENCE=SOURCE/'evidence';EVIDENCE.mkdir(exist_ok=True)
scene=bpy.data.scenes.new('Campus-Asset-Library')
bpy.context.window.scene=scene
scene.render.fps=30
enum(scene.unit_settings,'system','METRIC');scene.unit_settings.scale_length=1
p=make_palette()
rig,body,badges,sockets=build(p)
actions=animate(rig)
student_objs=[rig,body,*badges.values(),*sockets]
variants=[('teal','Gió'),('terracotta','Nắng'),('marigold','Mầm'),('indigo','Sóng')]
tint_slots=[i for i,slot in enumerate(body.material_slots) if slot.material==p['teal']]


def export(objects,path,animated=False):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.hide_set(False);o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,
        export_animations=animated,export_animation_mode='ACTIONS',export_anim_single_armature=True,
        export_force_sampling=True,export_skins=True,export_yup=True,export_extras=True,
        export_apply=True,export_materials='EXPORT',export_copyright='Original Campus Together art, 2026; CC0-1.0')


def tint(color):
    for i in tint_slots:body.material_slots[i].material=p[color]


for index,(color,label) in enumerate(variants):
    tint(color)
    export([rig,body,badges[index+1],*sockets],OUT/f'student-{index}.glb',True)
tint('teal')
props=build_props(p)
for name,obj in props.items():export([obj],OUT/(name+'.glb'))
for obj in props.values():obj.hide_render=True;obj.hide_set(True)
for i,obj in badges.items():obj.hide_render=i!=1;obj.hide_set(i!=1)
camera=studio.setup()
rig.animation_data.action=actions['idle'];scene.frame_set(0)
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'campus-assets.blend'))
studio.render(EVIDENCE/'student-hero.png')
camera.location=(-2.5,5,2.0);studio.aim((0,0,.85));studio.render(EVIDENCE/'student-back.png')
camera.location=(.6,-4,1.65);camera.data.ortho_scale=.60;studio.aim((0,-.02,1.46));studio.render(EVIDENCE/'student-face.png',(800,800))
manifest={'schemaVersion':1,'units':'metres','up':'+Y','forward':'+Z','origin':'feet/bottom midpoint',
    'license':'CC0-1.0','source':'assets/source/campus-assets.blend',
    'characters':[{'id':i,'label':label,'url':f'/assets/student-{i}.glb','badge':i+1,'tint':color} for i,(color,label) in enumerate(variants)],
    'animations':{name:{'duration':frames/30,'loop':loop,**({'authoredSpeed':GAITS[name]['speed']} if name in GAITS else {})} for name,(frames,loop) in CLIPS.items()},
    'sockets':{'large':'carryLarge','small':'carrySmall'},'props':{name:'/assets/'+name+'.glb' for name in props},
    'itemAssets':{'crate':'crate','cable':'cable','fuse':'fuse','module':['module-sun','module-leaf','module-wave'],'banner':'banner','lantern':'lantern'}}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print('CAMPUS_BUILD_DONE',len(props),'props',len(actions),'clips')
