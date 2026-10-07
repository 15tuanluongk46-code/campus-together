"""Constraint-free, baked analytical two-bone motion in armature space.

Independent prop-led grip frame -> wrist targets -> analytical elbows. Flat
deform hierarchy is deliberate: no inherited Euler/IK dependency ambiguity.
"""
import math
import bpy
from mathutils import Vector, Matrix
from geometry import enum
from student import REST

CLIPS={'idle':(72,True),'walk':(24,True),'run':(16,True),
       'pickup':(30,False),'drop':(28,False),'carryIdle':(72,True),
       'carryWalk':(26,True),'interact':(40,True),'celebrate':(60,True),
       'carrySmallIdle':(72,True),'carrySmallWalk':(24,True)}
GAITS={'walk':{'speed':1.5,'duty':.50,'lift':.115},
       'run':{'speed':3.1,'duty':.35,'lift':.22},
       'carryWalk':{'speed':1.3,'duty':.52,'lift':.09},
       'carrySmallWalk':{'speed':1.5,'duty':.50,'lift':.11}}


def solve(a,b,l1,l2,pole):
    a,b,pole=Vector(a),Vector(b),Vector(pole)
    d=b-a;distance=d.length
    if distance>l1+l2+.0001:raise ValueError(f'unreachable limb {distance:.4f} > {l1+l2:.4f}')
    direction=d.normalized();along=(l1*l1-l2*l2+distance*distance)/(2*distance)
    bend=(pole-direction*pole.dot(direction)).normalized()
    return a+direction*along+bend*math.sqrt(max(0,l1*l1-along*along))


def place(rig,name,head,tail=None,rotation=None):
    bone=rig.pose.bones['DEF-'+name];rest=rig.data.bones[bone.name].matrix_local
    if rotation is None:
        old=Vector(REST[name][1])-Vector(REST[name][0]);new=Vector(tail)-Vector(head)
        rotation=old.rotation_difference(new).to_matrix().to_4x4()
    bone.matrix=Matrix.Translation(Vector(head))@rotation@rest.to_3x3().to_4x4()


def foot_path(phase,period,gait):
    duty=gait['duty'];span=gait['speed']*period*duty
    if phase<duty:return -.5*span+span*phase/duty,0
    t=(phase-duty)/(1-duty)
    # Hermite swing: matches stance speed at both boundaries, smooth clearance.
    v=span*(1-duty)/duty
    y=(2*t**3-3*t*t+1)*span*.5+(t**3-2*t*t+t)*v+(-2*t**3+3*t*t)*(-span*.5)+(t**3-t*t)*v
    return y,gait['lift']*math.sin(math.pi*t)**2


def pose(rig,clip,t):
    period=CLIPS[clip][0]/30;phase=t/period;wave=math.sin(math.tau*phase)
    moving=clip in GAITS;carry=clip.startswith('carry');small=clip.startswith('carrySmall');run=clip=='run'
    crouch=0;lean=.035 if run else 0;reach=1 if carry else 0
    if clip in ['pickup','drop']:
        u=phase if clip=='pickup' else 1-phase
        crouch=.40*math.sin(math.pi*u)**2;lean=.80*math.sin(math.pi*u)**2
        reach=(3*u*u-2*u**3)
    if moving:
        bob=.008*math.cos(4*math.pi*phase)
        if run:bob=.040*max(0,-math.cos(4*math.pi*phase))
        # 0.30m half-stride needs flexed support, not a stretched 0.706m leg.
        pelvis=Vector((.012*wave,0,.700+bob-crouch))
    else:pelvis=Vector((.008*wave,0,.79-crouch))
    chest=pelvis+Vector((0,-lean*.12,.12))
    body_rot=Matrix.Rotation(lean,4,'X')@Matrix.Rotation(.025*wave if moving and not carry else .009*wave,4,'Z')
    head=chest+body_rot.to_3x3()@Vector((0,0,.35))
    place(rig,'root',(0,0,0),(0,0,.15))
    place(rig,'pelvis',pelvis,rotation=Matrix.Identity(4))
    place(rig,'chest',chest,rotation=body_rot)
    place(rig,'head',head,rotation=Matrix.Rotation(.035*wave,4,'Z'))
    gripbase=chest+Vector((0,-.32 if small else -.40,.10 if small else .07))
    if clip in ['pickup','drop']:gripbase+=Vector((0,.02,-crouch*.24))
    # Socket bottom and palms share one translation: no carrying jitter.
    for name,offset in [('carryLarge',(0,0,-.15)),('carrySmall',(0,0,-.045))]:
        place(rig,name,gripbase+Vector(offset),rotation=Matrix.Identity(4))
    for side,s in [('L',1),('R',-1)]:
        offset=0 if side=='L' else .5;cycle=(phase+offset)%1
        fy,fz=foot_path(cycle,period,GAITS[clip]) if moving else (0,0)
        ankle=Vector((s*.115,fy,.105+fz));hip=pelvis+Vector((s*.115,0,.02))
        l1=(Vector(REST['thigh.'+side][1])-Vector(REST['thigh.'+side][0])).length
        l2=(Vector(REST['shin.'+side][1])-Vector(REST['shin.'+side][0])).length
        knee=solve(hip,ankle,l1,l2,(0,-1,0))
        place(rig,'thigh.'+side,hip,knee);place(rig,'shin.'+side,knee,ankle)
        place(rig,'foot.'+side,ankle,rotation=Matrix.Identity(4))
        shoulder=chest+body_rot.to_3x3()@Vector((s*.225,0,.29))
        swing=math.sin(math.tau*(phase+offset))
        wrist=shoulder+Vector((s*.075,(-.16 if run else -.105)*swing if moving else -.02,-.40 if run else -.43))
        if carry or clip in ['pickup','drop']:
            target=gripbase+Vector((s*.085 if small else s*.278,0,.012));wrist=wrist.lerp(target,reach)
        if clip=='interact':
            wrist=shoulder+Vector((s*.055,-.32-.02*wave,-.19+.016*wave))
        if clip=='celebrate':
            wrist=shoulder+Vector((s*(.21+.03*wave),-.035,.29+.025*wave))
        a=(Vector(REST['upperArm.'+side][1])-Vector(REST['upperArm.'+side][0])).length
        b=(Vector(REST['forearm.'+side][1])-Vector(REST['forearm.'+side][0])).length
        elbow=solve(shoulder,wrist,a,b,(s*.5,.5,-.4))
        place(rig,'upperArm.'+side,shoulder,elbow);place(rig,'forearm.'+side,elbow,wrist)
        # Palm hangs in idle, wraps downward around crate side lip in carry.
        place(rig,'hand.'+side,wrist,rotation=Matrix.Rotation(-.15*reach,4,'X'))
    bpy.context.view_layer.update()


def animate(rig):
    rig.animation_data_create();actions={}
    for bone in rig.pose.bones:enum(bone,'rotation_mode','QUATERNION')
    for clip,(frames,loop) in CLIPS.items():
        action=bpy.data.actions.new(clip);action.use_fake_user=True
        rig.animation_data.action=action
        for frame in range(frames+1):
            try:pose(rig,clip,frame/30)
            except ValueError as error:raise ValueError(f'{clip} frame {frame}: {error}') from error
            for bone in rig.pose.bones:
                bone.keyframe_insert('location',frame=frame,group=bone.name)
                bone.keyframe_insert('rotation_quaternion',frame=frame,group=bone.name)
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for key in curve.keyframe_points:enum(key,'interpolation','LINEAR')
        action['loop']=loop;actions[clip]=action
    rig.animation_data.action=actions['idle'];bpy.context.scene.frame_set(0)
    return actions
