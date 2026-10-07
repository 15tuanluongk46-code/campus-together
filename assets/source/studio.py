"""Separate review stage: lighting, camera, render helpers; never exported."""
import bpy
from mathutils import Vector
from geometry import box, material, enum


def setup():
    scene=bpy.context.scene
    try:scene.render.engine='BLENDER_EEVEE'
    except TypeError:scene.render.engine='BLENDER_EEVEE_NEXT'
    scene.render.resolution_x=1000;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
    enum(scene.render.image_settings,'file_format','PNG')
    enum(scene.render.image_settings,'color_mode','RGBA')
    scene.render.film_transparent=False
    scene.render.fps=30
    world=bpy.data.worlds.new('World-Campus-studio');scene.world=world;world.use_nodes=True
    bg=next(n for n in world.node_tree.nodes if n.type=='BACKGROUND')
    bg.inputs[0].default_value=(.18,.23,.23,1);bg.inputs[1].default_value=.65
    # New scene retains Blender's valid default view transform (dynamic RNA enum).
    print('view_transform',scene.view_settings.view_transform)
    for name,location,energy,size,color in [
        ('key',(-3,-4,5),500,4,(1,.91,.77)),
        ('fill',(3,-2,3),200,3,(.78,.9,1)),
        ('rim',(1,3,4),400,3,(1,.80,.52))]:
        data=bpy.data.lights.new('LGT-'+name,'AREA');data.energy=energy;data.size=size;data.color=color
        obj=bpy.data.objects.new('LGT-'+name,data);scene.collection.objects.link(obj);obj.location=location
        obj.rotation_euler=(Vector((0,0,.8))-obj.location).to_track_quat('-Z','Y').to_euler()
    camera=bpy.data.objects.new('CAM-review',bpy.data.cameras.new('CAM-review'));scene.collection.objects.link(camera)
    scene.camera=camera;enum(camera.data,'type','ORTHO');camera.data.ortho_scale=2.08
    camera.location=(2.5,-5,2.25);aim((0,0,.84))
    ground=box('review-ground',(0,0,-.055),(200,200,.1),material('studio-sand',(.48,.42,.31)),.01)
    ground['reviewOnly']=True
    return camera


def aim(target):
    camera=bpy.context.scene.camera
    camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()


def render(path, size=None):
    scene=bpy.context.scene
    if size:scene.render.resolution_x,scene.render.resolution_y=size
    assert scene.camera
    scene.render.filepath=str(path);bpy.ops.render.render(write_still=True)
