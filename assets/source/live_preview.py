"""MCP-only optional review: append our scene without editing any existing one.

After MCP screenshot + scene confirmation, restore with restore_preview().
Does not save, rename, delete, or overwrite the user's current file/scene.
"""
from pathlib import Path
import bpy
from geometry import enum

def show_preview():
    source=Path(__file__).resolve().parent/'campus-assets.blend'
    original={'scene':bpy.context.scene.name,'file':bpy.data.filepath,
              'objectCount':len(bpy.context.scene.objects)}
    with bpy.data.libraries.load(str(source),link=False) as (available,loaded):
        loaded.scenes=['Campus-Asset-Library']
    scene=loaded.scenes[0];bpy.context.window.scene=scene
    scene['originalScene']=original['scene'];scene['originalFile']=original['file']
    scene['originalObjectCount']=original['objectCount']
    for area in bpy.context.screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active
            enum(space.shading,'type','MATERIAL')
            enum(space.region_3d,'view_perspective','CAMERA')
    print({'preview':scene.name,'original':original,'previewObjects':len(scene.objects)})


def restore_preview():
    preview=bpy.context.scene
    original=bpy.data.scenes[preview['originalScene']]
    assert bpy.data.filepath==preview['originalFile']
    assert len(original.objects)==preview['originalObjectCount']
    bpy.context.window.scene=original
    print({'restored':original.name,'file':bpy.data.filepath,'objects':len(original.objects)})
