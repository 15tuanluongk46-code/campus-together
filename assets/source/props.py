"""Reusable finished, original festival props. Every asset has feet/bottom origin."""
import math
import random
import bpy
from geometry import loft, tube, box, ellipsoid, mesh, join


def build_props(p):
    assets={}
    def make(name,fn):
        before=set(bpy.context.scene.objects);fn()
        parts=[o for o in bpy.context.scene.objects if o not in before]
        obj=join(parts,'GEO-'+name);obj['assetId']=name;assets[name]=obj
    def crate():
        box('crate-dark-interior',(0,0,.15),(.50,.32,.28),p['wood'],.018)
        for z in [.045,.135,.225]:
            for y in [-.177,.177]:box('crate-slat',(0,y,z),(.54,.034,.074),p['woodLight'],.008)
            for x in [-.26,.26]:box('crate-side',(x,0,z),(.034,.37,.074),p['woodLight'],.008)
        for x in [-.222,.222]:
            for y in [-.194,.194]:
                box('crate-corner-strap',(x,y,.14),(.045,.016,.28),p['teal'],.006)
                for z in [.03,.25]:ellipsoid('rivet',(x,y*1.045,z),(.007,.004,.007),p['brass'],8,6)
        for x in [-.09,0,.09]:box('crate-lid',(x,0,.29),(.085,.34,.022),p['cream'],.004)
        box('festival-mark',(0,-.20,.143),(.13,.01,.10),p['marigold'],.012)
        tube('leaf-mark',[(-.038,-.211,.12),(0,-.211,.16),(.036,-.211,.17)],.009,p['teal'])
        for x in [-.27,.27]:
            tube('grip-lip',[(x,-.07,.165),(x,0,.171),(x,.07,.165)],.016,p['ink'])
    make('crate',crate)
    def cable():
        for j in range(4):
            tube('coiled-cable',[(.11*math.cos(i*math.tau/40),.11*math.sin(i*math.tau/40),.022+j*.026) for i in range(41)],.011,p['ink'])
        tube('cable-tail',[(.11,0,.1),(.16,-.05,.07),(.20,-.05,.035)],.011,p['ink'])
        box('cable-plug',(.20,-.05,.032),(.055,.035,.04),p['teal'],.008)
        for x in [.19,.21]:box('plug-pin',(x,-.077,.034),(.006,.020,.008),p['brass'],.002)
        box('cable-tie',(0,-.115,.065),(.038,.022,.12),p['marigold'],.007)
    make('cable',cable)
    def fuse():
        box('fuse-casing',(0,0,.067),(.12,.08,.134),p['cream'],.018)
        box('fuse-window',(0,-.044,.073),(.072,.013,.071),p['teal'],.007)
        tube('fuse-wire',[(-.026,-.054,.048),(0,-.055,.09),(.026,-.054,.048)],.006,p['marigold'])
        for x in [-.035,.035]:box('fuse-pin',(x,0,.155),(.02,.035,.04),p['brass'],.002)
    make('fuse',fuse)
    for symbol in ['sun','leaf','wave']:
        def module(symbol=symbol):
            box('module-casing',(0,0,.12),(.24,.085,.24),p['teal'],.025)
            box('module-inlay',(0,-.049,.12),(.205,.019,.205),p['cream'],.019)
            if symbol=='sun':
                ellipsoid('sun-disc',(0,-.064,.12),(.041,.009,.041),p['marigold'])
                for j in range(8):
                    a=j*math.tau/8
                    tube('sun-ray',[(r*math.cos(a),-.065,.12+r*math.sin(a)) for r in [.056,.076]],.006,p['marigold'])
            elif symbol=='leaf':
                mesh('leaf-symbol',[(-.06,-.063,.065),(-.063,-.063,.148),(.064,-.063,.186),(.054,-.063,.103)],[(0,1,2,3)],p['leaf'])
                tube('leaf-vein',[(-.047,-.069,.076),(.046,-.069,.169)],.004,p['cream'])
            else:
                for z in [.087,.137]:tube('wave-symbol',[(x,-.068,z+.013*math.sin((x+.07)*45)) for x in [-.07+i*.007 for i in range(21)]],.007,p['teal'])
            for x in [-.065,0,.065]:box('module-contact',(x,0,.009),(.025,.041,.018),p['brass'],.002)
        make('module-'+symbol,module)
    def lantern():
        loft('paper-lantern',[(0,0,z,r,r) for z,r in [(0,.07),(.025,.095),(.065,.126),(.14,.135),(.215,.126),(.255,.095),(.28,.07)]],p['marigold'],24)
        for j in range(12):
            a=j*math.tau/12
            tube('lantern-rib',[(r*math.cos(a),r*math.sin(a),z) for z,r in [(.02,.097),(.07,.130),(.14,.139),(.21,.130),(.26,.097)]],.003,p['cream'],6)
        for z in [.006,.28]:loft('lantern-cap',[(0,0,z,.073,.073),(0,0,z+.012,.073,.073)],p['teal'],24)
        tube('lantern-loop',[(-.043,0,.295),(-.040,0,.35),(0,0,.37),(.040,0,.35),(.043,0,.295)],.007,p['ink'])
    make('lantern',lantern)
    def banner():
        tube('banner-roll',[(0,-.19,.06),(0,.19,.06)],.055,p['cream'],16)
        for y in [-.12,.12]:tube('banner-ribbon',[(-.06,y,.06),(0,y,.12),(.06,y,.06),(0,y,0),(-.06,y,.06)],.011,p['terracotta'])
        box('roll-tag',(.059,0,.058),(.012,.082,.059),p['teal'],.006)
    make('banner',banner)
    def bunting():
        points=[(-1.5+i*.1,0,2.3-.35*math.sin(math.pi*i/30)) for i in range(31)]
        tube('festival-string',points,.009,p['ink'])
        for j in range(9):
            x=-1.32+j*.33;z=2.3-.35*math.sin(math.pi*(x+1.5)/3)
            verts=[(x-.12,0,z),(x+.12,0,z),(x,.012,z-.29)]
            mesh('stitched-pennant',verts,[(0,1,2)],p[['teal','terracotta','marigold'][j%3]],False)
            tube('pennant-hem',[verts[0],verts[2],verts[1]],.004,p['cream'],6)
    make('bunting',bunting)
    for variant in ['round','slender']:
        def tree(variant=variant):
            rng=random.Random(42 if variant=='round' else 81)
            height=2.8 if variant=='round' else 3.3
            tube('tree-trunk',[(0,0,0),(.045,.02,.7),(-.025,0,1.4),(.1,.04,2.15)], [.13,.11,.08,.025],p['wood'],10)
            for j in range(7):
                a=j*2.4;z=1.2+j*.14;r=.48 if variant=='round' else .27
                end=(r*math.cos(a),r*math.sin(a),z+.5)
                tube('branch',[(0,0,z),end], [.045,.015],p['wood'],8)
            for j in range(13):
                a=j*2.4;r=rng.uniform(.15,.65) if variant=='round' else rng.uniform(.1,.35)
                z=height-.35-(j%4)*.24
                ellipsoid('leaf-crown',(r*math.cos(a),r*math.sin(a),z),(.49,.44,.43 if variant=='round' else .56),p[['leaf','leafLight','leafDark'][j%3]],12,8)
            for j in range(8):
                a=j*math.tau/8
                tube('root',[(0,0,.13),(.23*math.cos(a),.23*math.sin(a),.018)], [.045,.012],p['wood'],6)
        make('tree-'+variant,tree)
    def bench():
        for x in [-.55,.55]:
            for y in [-.18,.18]:box('bench-leg',(x,y,.22),(.06,.065,.44),p['teal'],.016)
            tube('back-frame',[(x,.19,.12),(x,.22,.75),(x,.23,.90)],.03,p['teal'])
        for y in [-.18,-.06,.06,.18]:box('seat-slat',(0,y,.46),(1.38,.095,.045),p['woodLight'],.014)
        for z in [.64,.78,.89]:box('back-slat',(0,.23,z),(1.38,.042,.088),p['woodLight'],.012)
    make('bench',bench)
    def pot():
        loft('terracotta-planter',[(0,0,0,.18,.18),(0,0,.27,.24,.24),(0,0,.30,.254,.254),(0,0,.34,.254,.254)],p['terracotta'],20)
        loft('soil',[(0,0,.32,.226,.226),(0,0,.326,.226,.226)],p['wood'],20)
        for j in range(9):
            a=j*2.4;x=.15*math.cos(a);y=.15*math.sin(a);z=.49+.09*(j%3)
            tube('flower-stem',[(x*.3,y*.3,.32),(x,y,z)],.007,p['leaf'])
            for k in range(6):
                b=k*math.tau/6
                ellipsoid('marigold-petal',(x+.03*math.cos(b),y+.03*math.sin(b),z),(.03,.023,.018),p['marigold'],8,6)
            ellipsoid('flower-center',(x,y,z+.013),(.019,.019,.012),p['terracotta'],8,6)
    make('flower-pot',pot)
    def station():
        box('station-plinth',(0,0,.025),(.45,.36,.05),p['teal'],.025)
        box('station-pedestal',(0,0,.40),(.21,.18,.76),p['cream'],.032)
        box('station-head',(0,-.03,.80),(.40,.30,.12),p['teal'],.035)
        ellipsoid('launch-button',(0,-.04,.877),(.083,.075,.031),p['marigold'],20,8)
        for x in [-.12,.12]:ellipsoid('status-light',(x,-.17,.81),(.020,.006,.018),p['marigold'],12,6)
    make('station',station)
    return assets
