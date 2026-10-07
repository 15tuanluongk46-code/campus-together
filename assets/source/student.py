"""Original student: profile-modelled face/clothing, skinned limbs, designed details."""
import math
import bpy
from geometry import loft, ellipsoid, tube, box, digit, join, enum

REST = {
    'root':((0,0,0),(0,0,.15)),
    'pelvis':((0,0,.79),(0,0,.91)),
    'chest':((0,0,.91),(0,0,1.22)),
    'head':((0,0,1.26),(0,0,1.56)),
}
for side,sign in [('L',1),('R',-1)]:
    REST.update({
        'thigh.'+side:((sign*.115,0,.81),(sign*.115,-.018,.455)),
        'shin.'+side:((sign*.115,-.018,.455),(sign*.115,0,.105)),
        'foot.'+side:((sign*.115,0,.105),(sign*.115,-.17,.105)),
        'upperArm.'+side:((sign*.225,0,1.20),(sign*.285,0,.96)),
        'forearm.'+side:((sign*.285,0,.96),(sign*.30,-.02,.745)),
        'hand.'+side:((sign*.30,-.02,.745),(sign*.30,-.02,.665)),
    })
REST['carryLarge']=((0,-.40,.83),(0,-.40,.93))
REST['carrySmall']=((0,-.43,.97),(0,-.43,1.07))


def build(palette):
    p=palette;parts=[];badges={}
    def add(obj, bone):
        g=obj.vertex_groups.new(name='DEF-'+bone);g.add(list(range(len(obj.data.vertices))),1,'REPLACE')
        parts.append(obj);return obj
    def weighted(obj, upper, lower, joint):
        a=obj.vertex_groups.new(name='DEF-'+upper);b=obj.vertex_groups.new(name='DEF-'+lower)
        for v in obj.data.vertices:
            z=v.co.z;t=max(0,min(1,(z-joint+.045)/.09));t=t*t*(3-2*t)
            if t>0:a.add([v.index],t,'REPLACE')
            if t<1:b.add([v.index],1-t,'REPLACE')
        parts.append(obj);return obj
    add(loft('jacket-body',[(0,0,.80,.175,.105),(0,0,.84,.18,.12),(0,0,.96,.185,.12),
                          (0,0,1.12,.218,.137),(0,0,1.20,.216,.125),(0,0,1.25,.115,.082)],p['teal'],24),'chest')
    add(loft('ribbed-waist',[(0,0,.80,.178,.11),(0,0,.85,.182,.12)],p['cream'],24),'chest')
    add(loft('trouser-yoke',[(0,0,.72,.153,.085),(0,0,.80,.172,.106),(0,0,.835,.163,.10)],p['denim'],20),'pelvis')
    add(loft('neck',[(0,0,1.23,.067,.064),(0,0,1.33,.065,.064)],p['skin'],16),'head')
    add(loft('ribbed-collar',[(0,0,1.235,.091,.076),(0,0,1.273,.078,.070)],p['cream'],20),'chest')
    # A designed jaw/cheek/brow/cranium silhouette, not a sphere head.
    add(loft('face-sculpt',[(0,-.027,1.29,.046,.048),(0,-.03,1.31,.085,.079),
                          (0,-.025,1.35,.119,.098),(0,-.016,1.40,.148,.119),
                          (0,-.008,1.46,.153,.128),(0,.002,1.52,.149,.124),
                          (0,.015,1.58,.129,.110),(0,.021,1.625,.073,.066),
                          (0,.021,1.638,.018,.016)],p['skin'],32),'head')
    # Hair cap: hairline high on front, low at nape, with asymmetric swept fringe.
    verts=[];faces=[];n=32
    for j in range(7):
        t=j/7
        for i in range(n):
            a=i*math.tau/n;front=max(0,-math.sin(a))
            bottom=1.405+.125*front
            z=bottom+(1.661-bottom)*math.sin(t*math.pi/2)
            r=math.cos(t*math.pi/2)
            verts.append((.160*r*math.cos(a),.014+.139*r*math.sin(a),z))
    verts.append((0,.014,1.663))
    for j in range(6):
        for i in range(n):
            a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
    faces += [(6*n+i,6*n+(i+1)%n,len(verts)-1) for i in range(n)]
    from geometry import mesh
    add(mesh('swept-hair-cap',verts,faces,p['hair']),'head')
    for k in range(5):
        x=-.10+k*.043
        add(tube('swept-fringe-'+str(k),[(x-.038,-.083,1.628),(x-.015,-.122,1.596),
                    (x+.030,-.139,1.555),(x+.045,-.138,1.527+k*.006)],
                    [.025,.030,.025,.002],p['hairLight'] if k==1 else p['hair'],10),'head')
    for side,s in [('L',1),('R',-1)]:
        add(ellipsoid('ear.'+side,(s*.153,.0,1.423),(.028,.024,.045),p['skin']),'head')
        add(ellipsoid('ear-fold.'+side,(s*.172,-.014,1.424),(.008,.012,.021),p['blush'],12,8),'head')
        add(ellipsoid('eye-white.'+side,(s*.060,-.126,1.461),(.032,.014,.025),p['white']),'head')
        add(ellipsoid('iris.'+side,(s*.058,-.139,1.460),(.015,.005,.018),p['eye'],16,8),'head')
        add(ellipsoid('eye-glint.'+side,(s*.054-.004,-.144,1.468),(.005,.002,.005),p['white'],10,6),'head')
        add(tube('eyebrow.'+side,[(s*.027,-.132,1.502),(s*.057,-.134,1.509),(s*.090,-.119,1.501)],.010,p['hair']),'head')
        add(ellipsoid('cheek.'+side,(s*.100,-.109,1.408),(.027,.006,.012),p['blush'],12,8),'head')
    add(ellipsoid('nose-bridge',(0,-.137,1.428),(.026,.033,.035),p['skin']),'head')
    add(tube('smile',[(-.044,-.116,1.371),(-.023,-.125,1.362),(0,-.129,1.36),(.026,-.123,1.365),(.043,-.115,1.375)],.0045,p['hairLight']),'head')
    add(tube('lower-lip',[(-.017,-.126,1.353),(0,-.128,1.351),(.018,-.125,1.355)],.004,p['blush']),'head')
    # Functional clothing details with restrained scale hierarchy.
    add(tube('zipper',[(0,-.125,.852),(0,-.133,1.13),(0,-.084,1.247)],.004,p['brass']),'chest')
    for s in [-1,1]:
        add(tube('welt-pocket',[(s*.073,-.12,.90),(s*.145,-.096,.975)],.006,p['cream']),'chest')
        add(tube('shoulder-piping',[(s*.09,-.08,1.247),(s*.175,-.088,1.225),(s*.217,-.051,1.205)],.007,p['cream']),'chest')
    for side,s in [('L',1),('R',-1)]:
        # Tailored shoulder gusset overlaps the sleeve cap through high arm poses.
        add(ellipsoid('shoulder-gusset.'+side,(s*.221,0,1.199),(.079,.078,.078),p['cream'],16,10),'upperArm.'+side)
        xs=lambda z:s*(.225+(1.20-z)*.24)
        weighted(loft('sleeve.'+side,[(xs(z),0,z,rx,ry) for z,rx,ry in [(.765,.045,.047),(.80,.051,.052),
                    (.91,.060,.065),(.96,.065,.067),(1.04,.072,.070),(1.16,.081,.074),(1.225,.057,.051)]],p['cream'],16),
                    'upperArm.'+side,'forearm.'+side,.96)
        add(loft('cuff.'+side,[(s*.30,-.01,.744,.048,.047),(s*.30,-.01,.788,.048,.047)],p['teal'],16),'forearm.'+side)
        add(ellipsoid('palm.'+side,(s*.30,-.02,.705),(.042,.035,.055),p['skin']),'hand.'+side)
        for i in range(3):
            add(tube('finger.'+side+str(i),[(s*(.279+i*.02),-.031,.694),(s*(.279+i*.02),-.039,.665)],.011,p['skin']),'hand.'+side)
        add(tube('thumb.'+side,[(s*.267,-.029,.723),(s*.254,-.048,.696)],.014,p['skin']),'hand.'+side)
        weighted(loft('trouser-leg.'+side,[(s*.115,y,z,rx,ry) for z,y,rx,ry in [(.13,0,.061,.061),(.20,0,.067,.066),
                  (.36,-.013,.073,.071),(.455,-.018,.080,.075),(.53,-.014,.087,.080),(.68,0,.091,.086),(.78,0,.094,.086)]],p['denim'],16),
                  'thigh.'+side,'shin.'+side,.455)
        add(loft('trouser-turnup.'+side,[(s*.115,0,.131,.064,.064),(s*.115,0,.168,.064,.064)],p['stitch'],16),'shin.'+side)
        add(box('sneaker-sole.'+side,(s*.115,-.068,.032),(.15,.292,.064),p['sole'],.027),'foot.'+side)
        add(loft('sneaker-upper.'+side,[(s*.115,-.064,.063,.071,.136),(s*.115,-.072,.096,.070,.127),
                    (s*.115,-.048,.139,.059,.090),(s*.115,.0,.157,.048,.05)],p['cream'],20),'foot.'+side)
        add(box('heel-patch.'+side,(s*.115,.055,.111),(.092,.026,.066),p['teal'],.009),'foot.'+side)
        for j in range(3):
            add(tube('lace.'+side+str(j),[(s*.115-.033,-.075+j*.024,.142),(s*.115+.033,-.075+j*.024,.142)],.004,p['white']),'foot.'+side)
        add(tube('shoe-stripe.'+side,[(s*.184,-.15,.08),(s*.185,-.08,.085),(s*.18,.01,.097)],.007,p['teal']),'foot.'+side)
    add(box('backpack-main',(0,.175,1.045),(.30,.16,.345),p['terracotta'],.057),'chest')
    add(box('backpack-pocket',(0,.267,.99),(.231,.056,.147),p['teal'],.027),'chest')
    add(tube('backpack-zip',[(-.101,.300,1.033),(0,.306,1.049),(.101,.300,1.033)],.004,p['brass']),'chest')
    add(tube('backpack-handle',[(-.048,.172,1.216),(-.036,.175,1.264),(.036,.175,1.264),(.048,.172,1.216)],.013,p['ink']),'chest')
    for s in [-1,1]:
        add(tube('backpack-strap',[(s*.10,.18,1.18),(s*.155,.04,1.247),(s*.16,-.09,1.18),(s*.14,-.126,1.08),(s*.14,.115,.91)],.018,p['ink'],10),'chest')
        add(box('strap-buckle',(s*.153,-.135,1.11),(.035,.012,.04),p['brass'],.005),'chest')
    add(box('chest-badge',(-.076,-.143,1.131),(.080,.012,.090),p['marigold'],.012),'chest')
    add(box('pack-badge',(0,.303,.993),(.082,.012,.087),p['marigold'],.012),'chest')
    for number in range(1,5):
        objs=digit(number,(-.076,-.154,1.131),.060,p['ink'])+digit(number,(0,.316,.993),.060,p['cream'],True)
        for o in objs:
            g=o.vertex_groups.new(name='DEF-chest');g.add(list(range(len(o.data.vertices))),1,'REPLACE')
        badge=join(objs,'GEO-badge-'+str(number));badges[number]=badge
    body=join(parts,'GEO-student-skinned')
    arm=bpy.data.armatures.new('ARM-student');rig=bpy.data.objects.new('ARM-student',arm)
    bpy.context.collection.objects.link(rig)
    bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
    bpy.ops.object.mode_set(mode='EDIT')
    for name,(a,b) in REST.items():
        bone=arm.edit_bones.new('DEF-'+name);bone.head=a;bone.tail=b
        if name!='root':bone.parent=arm.edit_bones['DEF-root']
    bpy.ops.object.mode_set(mode='OBJECT')
    for obj in [body,*badges.values()]:
        obj.parent=rig
        mod=obj.modifiers.new('Student skin','ARMATURE');mod.object=rig
    # Empties compensate bone's rest axes so items attach with identity rotation.
    from mathutils import Matrix
    sockets=[]
    for name in ['carryLarge','carrySmall']:
        obj=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(obj)
        obj.parent=rig;enum(obj,'parent_type','BONE');obj.parent_bone='DEF-'+name
        bpy.context.view_layer.update()
        obj.matrix_world=Matrix.Translation(REST[name][0])
        obj['socket']='item origin; identity local TRS';sockets.append(obj)
    rig['height_m']=1.663;rig['forward']='-Y Blender / +Z glTF';rig['motion']='in-place'
    return rig,body,badges,sockets
