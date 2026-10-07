"""Small original geometry vocabulary; all outputs use metre-space vertices."""
import math
import bpy
from mathutils import Vector, Matrix


def enum(obj, prop, value):
    choices = [item.identifier for item in obj.bl_rna.properties[prop].enum_items]
    if value not in choices:
        raise ValueError(f'{prop}: {value} not in {choices}')
    setattr(obj, prop, value)


def material(name, color, rough=.7, metal=0):
    mat = bpy.data.materials.new('MAT-' + name)
    mat.use_nodes = True
    shader = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = rough
    shader.inputs['Metallic'].default_value = metal
    mat.diffuse_color = (*color, 1)
    return mat


def mesh(name, verts, faces, mat, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new('GEO-' + name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(mat)
    for p in data.polygons:
        p.use_smooth = smooth
    return obj


def loft(name, rings, mat, sides=16):
    """Each ring: (x,y,z, x radius,y radius). Hand-designed silhouettes."""
    verts = [(x + rx*math.cos(a*2*math.pi/sides),
              y + ry*math.sin(a*2*math.pi/sides), z)
             for x,y,z,rx,ry in rings for a in range(sides)]
    faces = []
    for j in range(len(rings)-1):
        for i in range(sides):
            a=j*sides+i; b=j*sides+(i+1)%sides
            faces.append((a,b,b+sides,a+sides))
    faces += [tuple(reversed(range(sides))),
              tuple((len(rings)-1)*sides+i for i in range(sides))]
    return mesh(name,verts,faces,mat)


def ellipsoid(name, center, radii, mat, seg=16, rings=10):
    # Closed ring mesh with poles; unlike overlapping spheres, useful as facial detail.
    verts=[(center[0],center[1],center[2]-radii[2])]
    for j in range(1,rings):
        v=-math.pi/2+j*math.pi/rings
        for i in range(seg):
            u=2*math.pi*i/seg
            verts.append((center[0]+radii[0]*math.cos(v)*math.cos(u),
                          center[1]+radii[1]*math.cos(v)*math.sin(u),
                          center[2]+radii[2]*math.sin(v)))
    verts.append((center[0],center[1],center[2]+radii[2]))
    faces=[(0,1+(i+1)%seg,1+i) for i in range(seg)]
    for j in range(rings-2):
        for i in range(seg):
            a=1+j*seg+i;b=1+j*seg+(i+1)%seg
            faces.append((a,b,b+seg,a+seg))
    top=len(verts)-1; start=1+(rings-2)*seg
    faces += [(start+i,start+(i+1)%seg,top) for i in range(seg)]
    return mesh(name,verts,faces,mat)


def tube(name, points, radius, mat, sides=8):
    pts=[Vector(p) for p in points]; verts=[]
    for j,p in enumerate(pts):
        direction=pts[min(j+1,len(pts)-1)]-pts[max(0,j-1)]
        q=direction.to_track_quat('Z','Y')
        r=radius[j] if isinstance(radius,list) else radius
        verts += [p+q@Vector((r*math.cos(i*math.tau/sides),r*math.sin(i*math.tau/sides),0)) for i in range(sides)]
    faces=[]
    for j in range(len(pts)-1):
        for i in range(sides):
            a=j*sides+i;b=j*sides+(i+1)%sides
            faces.append((a,b,b+sides,a+sides))
    faces += [tuple(reversed(range(sides))),tuple((len(pts)-1)*sides+i for i in range(sides))]
    return mesh(name,verts,faces,mat)


def box(name, center, size, mat, bevel=.02):
    bpy.ops.mesh.primitive_cube_add(size=1,location=center)
    obj=bpy.context.object;obj.name='GEO-'+name;obj.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod=obj.modifiers.new('Soft tailored edges','BEVEL');mod.width=bevel;mod.segments=3
        bpy.ops.object.modifier_apply(modifier=mod.name)
    # Bake into shared rest coordinates before binding.
    obj.data.transform(obj.matrix_world);obj.matrix_world=Matrix.Identity(4)
    return obj


def join(objects, name):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.join()
    obj=bpy.context.object;obj.name=name
    return obj


def digit(number, center, height, mat, reverse=False):
    """Original seven-segment mesh lettering, no external font dependency."""
    patterns={1:'bc',2:'abged',3:'abgcd',4:'fgbc'}
    coordinates={'a':((-1,1),(1,1)), 'b':((1,1),(1,0)),
                 'c':((1,0),(1,-1)), 'd':((-1,-1),(1,-1)),
                 'e':((-1,-1),(-1,0)), 'f':((-1,0),(-1,1)),
                 'g':((-1,0),(1,0))}
    parts=[]
    for seg in patterns[number]:
        points=[(center[0]+x*height*.25*(-1 if reverse else 1),center[1],center[2]+z*height*.5) for x,z in coordinates[seg]]
        parts.append(tube('badge-'+str(number)+'-'+seg,points,height*.06,mat))
    return parts
