"""Modulo: Classroom furniture, modelled procedurally in headless Blender.

    blender -b --factory-startup -P tools/blender/furniture.py -- --out public/models/furniture
    (optional) --preview /tmp/x.png --only chair,table     contact-sheet render (Cycles CPU)

Blender's glTF exporter needs numpy. If your Blender's Python lacks it, point PYTHONPATH at a
folder with a numpy wheel for that Python (e.g. `pip install --target /tmp/pylib numpy`).

Output: ONE GLB, `classroom-furniture.glb`, with one top-level node per item (see ITEMS). The
runtime (src/classroom/render/furniture.ts) picks nodes by name, instances them and sets pbr slots.

Conventions (all items)
  * metric, 1 unit = 1 m, glTF +Y up. Everything is modelled in THREE.JS axes (x right, y up,
    z toward the viewer) and converted to Blender's Z-up on creation, so what you read here is
    what the game sees.
  * Floor items (chair, table, desk, bin, backpack): origin on the floor at the plan centre;
    the "front" (the way a chair faces / the user side of a desk) is -Z.
  * Wall items (whiteboard, clock, poster, pinboard, sharpener, sink, window, door, radiator):
    origin on the wall plane, the item grows toward +Z (into the room). Centred on the origin
    except door (origin = hinge edge, floor), radiator (centred along x, floor) and sink
    (origin = basin rim centre).
  * Items on a desk (doccam, laptop): origin = centre of the footprint on the desk surface.
  * Ceiling projector: origin = body centre; the drop rod goes up 0.25 m to a ceiling plate.
  * Pivot nodes the game animates: `doccam-head` (head centre), `hand-h` / `hand-m` (clock centre,
    pointing up = 12:00), `leaf` (door leaf, pivot on the hinge edge at the floor).
  * Material names: `pbr:<slot>[:label]` = tag for the triplanar PBR swap (slot from
    src/config/materials.json); every other name keeps its own colour.
  * Deterministic: no randomness anywhere.
"""

import argparse
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

# three (x, y, z) -> Blender (x, -z, y); a proper rotation (det +1), so winding is preserved.
M3B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


# ---------------------------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------------------------
def lin(h):
    """sRGB hex -> linear rgba."""
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*c, 1.0)


# name: (hex, roughness, metallic, alpha)
MATS = {
    'pbr:plywood': (0xA9662B, 0.42, 0.0, 1),
    'pbr:table': (0xEAE8E3, 0.45, 0.0, 1),
    'pbr:metal:chrome': (0x9DA3A8, 0.22, 0.95, 1),
    'pbr:metal:alu': (0xB4B8BC, 0.35, 0.85, 1),
    'pbr:door': (0x8E3B2A, 0.6, 0.0, 1),
    'pbr:tile': (0xD9C9A3, 0.4, 0.0, 1),
    'black_plastic': (0x1E2024, 0.5, 0.0, 1),
    'desk_black': (0x2B2D30, 0.55, 0.3, 1),
    'white_plastic': (0xEFEFEC, 0.4, 0.0, 1),
    'white_paint': (0xF2F2EF, 0.5, 0.0, 1),
    'ceramic': (0xF4F4F1, 0.15, 0.0, 1),
    'rubber': (0x151515, 0.9, 0.0, 1),
    'steel': (0x9A9FA4, 0.35, 0.85, 1),
    'board_white': (0xF6F8F8, 0.25, 0.0, 1),
    'pin_yellow': (0xE3CF72, 1.0, 0.0, 1),
    'paper': (0xF1EEE4, 0.8, 0.0, 1),
    'note_pink': (0xE9B9C2, 0.85, 0.0, 1),
    'note_blue': (0xB7D2E8, 0.85, 0.0, 1),
    'pin_red': (0xC0392B, 0.4, 0.0, 1),
    'pin_blue': (0x2E6FB8, 0.4, 0.0, 1),
    'poster_paper': (0xC75B4A, 0.7, 0.0, 1),
    'poster_light': (0xF2EFE6, 0.7, 0.0, 1),
    'poster_dark': (0x2B2B2B, 0.7, 0.0, 1),
    'frame_black': (0x1B1B1D, 0.45, 0.0, 1),
    'clock_face': (0xFAFAF8, 0.5, 0.0, 1),
    'clock_hand': (0x1A1A1A, 0.5, 0.0, 1),
    'screen_dark': (0x0D1117, 0.25, 0.0, 1),
    'lens_glass': (0x0A0F18, 0.05, 0.3, 1),
    'door_recess': (0x24201E, 0.9, 0.0, 1),
    'radiator_dark': (0x1C1B1A, 0.9, 0.0, 1),
    'radiator_body': (0xD8D8D4, 0.5, 0.0, 1),
    'bin_grey': (0x5C6266, 0.7, 0.0, 1),
    'blind_grey': (0x9A9C9E, 0.6, 0.0, 1),
    'cabinet_white': (0xE9E8E1, 0.5, 0.0, 1),
    'cabinet_plinth': (0x1A1A1B, 0.7, 0.0, 1),
    'bin_clear': (0xC9D2D6, 0.25, 0.0, 1),
    'bin_lid': (0x6F6870, 0.45, 0.0, 1),
    'fan_white': (0xF3F4F4, 0.35, 0.0, 1),
    'fan_grey': (0xA9A59F, 0.4, 0.0, 1),
    'bp_fabric': (0x3C6E9E, 0.85, 0.0, 1),
    'bp_accent': (0x222428, 0.8, 0.0, 1),
}
_mat_cache = {}


def mat(name):
    if name in _mat_cache:
        return _mat_cache[name]
    hexv, rough, metal, alpha = MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = lin(hexv)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    m.diffuse_color = lin(hexv)
    _mat_cache[name] = m
    return m


# ---------------------------------------------------------------------------------------------
# Geometry helpers (three.js axes, bmesh)
# ---------------------------------------------------------------------------------------------
def rot_x(deg):
    return Matrix.Rotation(math.radians(deg), 3, 'X')


def rot_y(deg):
    return Matrix.Rotation(math.radians(deg), 3, 'Y')


def rot_z(deg):
    return Matrix.Rotation(math.radians(deg), 3, 'Z')


def _xf(bm, pos=(0, 0, 0), rot=None, scale=(1, 1, 1)):
    m = Matrix.Translation(Vector(pos)) @ (rot.to_4x4() if rot is not None else Matrix.Identity(4))
    m = m @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return bm


def box(size, pos=(0, 0, 0), rot=None, vround=None):
    """Axis box. vround=(offset, segments) rounds the vertical (Y) edges first (plan corners)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    _xf(bm, scale=size)
    if vround:
        edges = [e for e in bm.edges if abs(e.verts[0].co.y - e.verts[1].co.y) > 1e-6]
        bmesh.ops.bevel(bm, geom=edges, offset=vround[0], segments=vround[1], affect='EDGES')
    _xf(bm, pos, rot)
    return bm


def align(direction):
    """Rotation taking +Z onto `direction`."""
    return Vector((0, 0, 1)).rotation_difference(Vector(direction).normalized()).to_matrix()


def tube(p0, p1, r0, r1=None, seg=12, caps=True):
    """Truncated cone from p0 (radius r0) to p1 (radius r1)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r0,
        radius2=r0 if r1 is None else r1, depth=d.length,
    )
    _xf(bm, (p0 + p1) / 2, align(d))
    return bm


def lathe(profile, seg=24, pos=(0, 0, 0), rot=None, scale=(1, 1, 1)):
    """Surface of revolution about +Y. profile = [(radius, y), ...]; radius 0 closes on the axis."""
    bm = bmesh.new()
    rings = []
    for r, y in profile:
        if r < 1e-6:
            rings.append([bm.verts.new((0, y, 0))])
        else:
            rings.append([
                bm.verts.new((r * math.cos(a), y, r * math.sin(a)))
                for a in (2 * math.pi * k / seg for k in range(seg))
            ])
    for a, b in zip(rings, rings[1:]):
        for k in range(seg):
            k2 = (k + 1) % seg
            quad = [a[k % len(a)], a[k2 % len(a)], b[k2 % len(b)], b[k % len(b)]]
            face = []
            for v in quad:
                if v not in face:
                    face.append(v)
            if len(face) >= 3:
                bm.faces.new(face)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    _xf(bm, pos, rot, scale)
    return bm


def taper_box(p0, p1, w0, h0, w1, h1, up=(0, 1, 0)):
    """Box from p0 to p1 whose cross-section (w across, h tall) tapers from end 0 to end 1."""
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0).normalized()
    side = d.cross(Vector(up)).normalized()
    top = side.cross(d).normalized()
    bm = bmesh.new()
    ring = []
    for p, w, h in ((p0, w0, h0), (p1, w1, h1)):
        ring.append([bm.verts.new(p + side * sx * w / 2 + top * sy * h / 2)
                     for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    a, b = ring
    for k in range(4):
        bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def sphere(r, pos=(0, 0, 0), scale=(1, 1, 1), seg=12):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(4, seg // 2), radius=r)
    _xf(bm, pos, None, scale)
    return bm


def grid_surface(rows):
    """Quad surface through a list of rows of 3D points (rows x cols)."""
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in row] for row in rows]
    for j in range(len(vs) - 1):
        for i in range(len(vs[0]) - 1):
            bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
    return bm


def realize(bm, bevel, solid):
    """Apply Solidify / Bevel modifiers to a bmesh and return a baked mesh datablock."""
    me = bpy.data.meshes.new('tmp')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('tmp', me)
    bpy.context.scene.collection.objects.link(ob)
    if solid:
        m = ob.modifiers.new('solid', 'SOLIDIFY')
        m.thickness, m.offset = solid
        m.use_even_offset = True
    if bevel:
        m = ob.modifiers.new('bevel', 'BEVEL')
        m.width, m.segments = bevel[0], bevel[1]
        m.limit_method = 'ANGLE'
        m.angle_limit = math.radians(bevel[2] if len(bevel) > 2 else 35)
        m.use_clamp_overlap = True
    bpy.context.view_layer.update()
    out = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return out


class Item:
    """A top-level glTF node: optional pivot groups (empties) holding one mesh per material."""

    def __init__(self, name):
        self.name = name
        self.groups = {}
        self.acc = {}

    def group(self, name, pivot):
        self.groups[name] = Vector(pivot)

    def add(self, bm, material, group=None, bevel=None, solid=None):
        if group:
            bmesh.ops.translate(bm, vec=-self.groups[group], verts=bm.verts)
        me = realize(bm, bevel, solid)
        acc = self.acc.setdefault((group, material), bmesh.new())
        acc.from_mesh(me)
        bpy.data.meshes.remove(me)

    def build(self):
        coll = bpy.context.scene.collection
        root = bpy.data.objects.new(self.name, None)
        coll.objects.link(root)
        parents = {None: root}
        for g, piv in self.groups.items():
            e = bpy.data.objects.new(g, None)
            coll.objects.link(e)
            e.parent = root
            e.location = M3B @ piv
            parents[g] = e
        for (g, material), bm in self.acc.items():
            bmesh.ops.transform(bm, matrix=M3B, verts=bm.verts)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
            me = bpy.data.meshes.new(f'{self.name}.{g or "root"}.{material}')
            bm.to_mesh(me)
            bm.free()
            for p in me.polygons:
                p.use_smooth = True
            if hasattr(me, 'use_auto_smooth'):  # Blender <= 4.0
                me.use_auto_smooth = True
                me.auto_smooth_angle = math.radians(35)
            me.materials.append(mat(material))
            ob = bpy.data.objects.new(me.name, me)
            coll.objects.link(ob)
            ob.parent = parents[g]
        return root


def tri_count(root):
    n = 0
    for ob in [root, *root.children_recursive]:
        if ob.type == 'MESH':
            n += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    return n


# ---------------------------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------------------------
def make_chair():
    """Moulded plywood swivel chair: one bent shell (seat + back), gas lift, 5-star base."""
    it = Item('chair')
    ZS = 0.045  # shift so the seat pan is centred on the column
    seat_y, R, lean = 0.46, 0.11, 78.0

    # Centre line of the shell in the (z, y) plane, as (z, y, s) plus the tangent for the normal.
    path = []
    for z in (-0.24, -0.225, -0.19, -0.13, -0.05, 0.04, 0.15):
        y = seat_y - 0.012 * max(0.0, (-0.19 - z) / 0.05) ** 2 + 0.006 * (1 - ((z + 0.03) / 0.21) ** 2)
        path.append([z, y])
    NB = 10  # rows through the bend (dense, so the waist notch stays smooth)
    for k in range(1, NB + 1):
        a = math.radians(lean * k / NB)
        path.append([0.15 + R * math.sin(a), seat_y + R * (1 - math.cos(a))])
    a = math.radians(lean)
    tz, ty = math.cos(a), math.sin(a)
    z1, y1 = path[-1]
    for k in range(1, 7):
        t = 0.27 * k / 6
        path.append([z1 + tz * t, y1 + ty * t])
    s = [0.0]
    for p, q in zip(path, path[1:]):
        s.append(s[-1] + math.hypot(q[0] - p[0], q[1] - p[1]))
    total = s[-1]
    arc0, arc1 = s[6], s[6 + NB]

    def smooth(x):
        x = min(max(x, 0.0), 1.0)
        return x * x * (3 - 2 * x)

    cols = [-math.cos(math.pi * k / 10) for k in range(11)]
    rows = []
    for j, (z, y) in enumerate(path):
        pj = path[min(j + 1, len(path) - 1)]
        pi = path[max(j - 1, 0)]
        dz, dy = pj[0] - pi[0], pj[1] - pi[1]
        ln = math.hypot(dz, dy)
        nz, ny = -dy / ln, dz / ln  # normal toward the sitter
        bf = min(max((s[j] - arc0) / (arc1 - arc0), 0.0), 1.0)
        # half width: wide seat -> narrow neck (the waist cut-out) -> a paddle back
        if s[j] <= arc0:
            hw = 0.225
        elif s[j] <= arc1:
            hw = 0.225 + (0.075 - 0.225) * smooth(bf / 0.55) if bf < 0.55 else 0.075
        else:
            hw = 0.075 + (0.195 - 0.075) * smooth((s[j] - arc1) / 0.10)
        f = min(s[j] / 0.07, 1.0)
        hw *= 0.3 + 0.7 * math.sqrt(1 - (1 - f) ** 2)
        g = min((total - s[j]) / 0.08, 1.0)
        hw *= 0.55 + 0.45 * math.sqrt(1 - (1 - g) ** 2)
        curl = 0.010 + 0.035 * bf
        row = []
        for u in cols:
            off = curl * u * u
            row.append((u * hw, y + ny * off, z + ZS + nz * off))
        rows.append(row)
    bm = grid_surface(rows)
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    if bm.faces[len(cols) * 2].normal.y < 0:  # make the seat normal point up
        for f_ in bm.faces:
            f_.normal_flip()
    it.add(bm, 'pbr:plywood', solid=(0.014, -1.0))

    # Mounting plate + tilt mechanism, gas lift, base.
    it.add(box((0.22, 0.016, 0.21), (0, 0.436, 0)), 'black_plastic', bevel=(0.004, 1))
    it.add(box((0.12, 0.05, 0.14), (0, 0.403, 0)), 'black_plastic', bevel=(0.006, 1))
    it.add(tube((0, 0.12, 0), (0, 0.38, 0), 0.0215, seg=16), 'pbr:metal:chrome')
    it.add(tube((0, 0.255, 0), (0, 0.385, 0), 0.033, 0.029, seg=16), 'black_plastic', bevel=(0.003, 1))
    for yy in (0.28, 0.31, 0.34):  # bellows ridges
        it.add(tube((0, yy - 0.006, 0), (0, yy + 0.006, 0), 0.037, seg=16), 'black_plastic')
    it.add(tube((0, 0.088, 0), (0, 0.15, 0), 0.05, 0.034, seg=16), 'pbr:metal:chrome', bevel=(0.004, 1))
    for k in range(5):
        a = math.radians(72 * k + 18)
        d = Vector((math.sin(a), 0, math.cos(a)))
        p0, p1 = d * 0.03 + Vector((0, 0.115, 0)), d * 0.295 + Vector((0, 0.078, 0))
        it.add(taper_box(p0, p1, 0.052, 0.03, 0.036, 0.022), 'pbr:metal:chrome', bevel=(0.006, 2))
        g = d * 0.285
        it.add(tube((g.x, 0.0, g.z), (g.x, 0.07, g.z), 0.02, seg=12), 'rubber', bevel=(0.004, 1))
    return it.build()


def make_table():
    """Light laminate table 1.3 x 0.65 x 0.72: thick square-edged top on a chrome rectangular steel
    frame (square-tube legs at the corners + an apron rail right under the top on all four sides)."""
    it = Item('table')
    L, D, H, T = 1.3, 0.65, 0.72, 0.035
    it.add(box((L, T, D), (0, H - T / 2, 0)), 'pbr:table', bevel=(0.0015, 1))
    lx, lz = L / 2 - 0.045, D / 2 - 0.045
    ft = 0.04  # leg tube section
    ay, ah, at = H - T - 0.03, 0.06, 0.02  # apron rail centre y, height, thickness
    for sx in (-1, 1):
        for sz in (-1, 1):
            it.add(box((ft, H - T, ft), (sx * lx, (H - T) / 2, sz * lz)), 'pbr:metal:chrome',
                   bevel=(0.0025, 1))
            it.add(box((ft + 0.004, 0.012, ft + 0.004), (sx * lx, 0.006, sz * lz)), 'rubber')
    for sz in (-1, 1):
        it.add(box((2 * lx, ah, at), (0, ay, sz * (lz + ft / 2 - at / 2))), 'pbr:metal:chrome',
               bevel=(0.0025, 1))
    for sx in (-1, 1):
        it.add(box((at, ah, 2 * lz), (sx * (lx + ft / 2 - at / 2), ay, 0)), 'pbr:metal:chrome',
               bevel=(0.0025, 1))
    return it.build()


def make_desk():
    """Electric sit/stand desk: black T-legs with long feet, white top, control box and cable."""
    it = Item('desk')
    W, D, TOP = 1.0, 0.6, 1.065
    it.add(box((W, 0.03, D), (0, TOP - 0.015, 0), vround=(0.02, 3)), 'pbr:table', bevel=(0.004, 2))
    for sx in (-1, 1):
        x = sx * (W / 2 - 0.12)
        it.add(box((0.06, 0.04, D - 0.04), (x, 0.02, 0)), 'desk_black', bevel=(0.008, 2))
        for sz in (-1, 1):
            it.add(box((0.07, 0.02, 0.05), (x, 0.0, sz * (D / 2 - 0.045))), 'rubber')
        it.add(box((0.08, 0.56, 0.06), (x, 0.32, 0)), 'desk_black', bevel=(0.006, 1))
        it.add(box((0.065, 0.5, 0.046), (x, 0.8, 0)), 'desk_black', bevel=(0.005, 1))
        it.add(box((0.1, 0.012, 0.2), (x, TOP - 0.036, 0)), 'desk_black')
    it.add(box((W - 0.24, 0.06, 0.04), (0, TOP - 0.065, -0.07)), 'desk_black', bevel=(0.006, 1))
    it.add(box((W - 0.12, 0.05, 0.03), (0, TOP - 0.06, 0.2)), 'desk_black', bevel=(0.005, 1))
    # control box + hand set + cable spine
    it.add(box((0.22, 0.06, 0.13), (0.14, TOP - 0.06, 0.07)), 'black_plastic', bevel=(0.008, 2))
    it.add(box((0.12, 0.018, 0.045), (0.3, TOP - 0.04, -0.27), rot_x(-8)), 'black_plastic', bevel=(0.005, 1))
    it.add(box((0.02, 0.006, 0.014), (0.28, TOP - 0.049, -0.27)), 'pbr:metal:alu')
    it.add(box((0.02, 0.006, 0.014), (0.325, TOP - 0.049, -0.27)), 'pbr:metal:alu')
    cab = [(0.2, TOP - 0.07, 0.16), (0.3, TOP - 0.2, 0.22), (0.36, 0.5, 0.25), (0.34, 0.05, 0.25),
           (0.18, 0.012, 0.16)]
    for p, q in zip(cab, cab[1:]):
        it.add(tube(p, q, 0.009, seg=8), 'black_plastic')
    it.add(box((0.1, 0.035, 0.05), (0.18, 0.0175, 0.16)), 'black_plastic', bevel=(0.005, 1))
    return it.build()


def make_doccam():
    """Document camera: white base, two-segment arm and a head that the game can flip."""
    it = Item('doccam')
    it.group('doccam-head', (0, 0.34, -0.13))
    it.add(box((0.25, 0.022, 0.3), (0, 0.011, 0), vround=(0.02, 3)), 'white_plastic', bevel=(0.004, 2))
    it.add(box((0.17, 0.004, 0.1), (0, 0.023, -0.06)), 'black_plastic')  # lit pad
    it.add(tube((0, 0.022, 0.11), (0, 0.3, 0.07), 0.013, 0.011, seg=12), 'white_plastic')
    it.add(tube((-0.02, 0.3, 0.07), (0.02, 0.3, 0.07), 0.022, seg=16), 'white_plastic', bevel=(0.003, 1))
    it.add(tube((0, 0.3, 0.07), (0, 0.34, -0.04), 0.011, seg=12), 'white_plastic')
    # head (relative to the pivot node)
    it.add(box((0.06, 0.045, 0.19), (0, 0.34, -0.13), vround=(0.008, 2)), 'white_plastic', group='doccam-head',
           bevel=(0.005, 2))
    it.add(sphere(0.02, (0, 0.34, -0.04), seg=12), 'white_plastic', group='doccam-head')
    it.add(tube((0, 0.318, -0.185), (0, 0.3, -0.185), 0.022, seg=16), 'black_plastic', group='doccam-head',
           bevel=(0.002, 1))
    it.add(tube((0, 0.3, -0.185), (0, 0.298, -0.185), 0.015, seg=16), 'lens_glass', group='doccam-head')
    it.add(box((0.04, 0.004, 0.03), (0, 0.363, -0.09)), 'black_plastic', group='doccam-head')
    return it.build()


def make_laptop():
    """Closed-lid-style dark laptop, screen facing -Z (toward the teacher)."""
    it = Item('laptop')
    W, D = 0.32, 0.22
    it.add(box((W, 0.016, D), (0, 0.008, 0), vround=(0.012, 3)), 'desk_black', bevel=(0.0025, 1))
    it.add(box((W - 0.03, 0.002, 0.1), (0, 0.0165, 0.025)), 'black_plastic')
    for row in range(4):
        for k in range(11):
            it.add(box((0.021, 0.004, 0.019), (-0.11 + k * 0.022, 0.018, -0.002 + row * 0.022 - 0.014)),
                   'steel')
    it.add(box((0.1, 0.002, 0.06), (0, 0.0165, -0.075)), 'steel')
    lean = 14.0  # degrees back from vertical; rot_x(+lean) turns +Y toward +Z
    d = Vector((0, math.cos(math.radians(lean)), math.sin(math.radians(lean))))
    n = Vector((0, -math.sin(math.radians(lean)), math.cos(math.radians(lean))))  # lid normal (+Z side)
    hinge = Vector((0, 0.016, 0.105))
    c = hinge + d * 0.104
    it.add(box((W, 0.208, 0.008), c, rot_x(lean), vround=(0.008, 2)), 'desk_black', bevel=(0.002, 1))
    it.add(box((W - 0.02, 0.188, 0.002), c - n * 0.0045, rot_x(lean)), 'screen_dark')
    return it.build()


def make_projector():
    """Ceiling projector on a drop rod. Origin = body centre; lens toward -Z."""
    it = Item('projector')
    it.add(box((0.4, 0.14, 0.32), (0, 0, 0), vround=(0.03, 3)), 'white_plastic', bevel=(0.008, 2))
    it.add(box((0.36, 0.012, 0.28), (0, -0.07, 0)), 'white_paint')
    it.add(tube((0.08, 0.0, -0.16), (0.08, 0.0, -0.215), 0.055, 0.048, seg=20), 'black_plastic', bevel=(0.003, 1))
    it.add(tube((0.08, 0.0, -0.215), (0.08, 0.0, -0.218), 0.04, seg=20), 'lens_glass')
    for k in range(7):
        it.add(box((0.004, 0.09, 0.003), (-0.15 + k * 0.018, 0.0, -0.1605)), 'black_plastic')
    for sx in (-1, 1):
        for k in range(5):
            it.add(box((0.002, 0.07, 0.007), (sx * 0.2, 0.0, 0.0 - 0.07 + k * 0.035)), 'black_plastic')
    it.add(box((0.1, 0.03, 0.1), (0, 0.085, 0.0), vround=(0.01, 2)), 'white_paint', bevel=(0.004, 1))
    it.add(tube((0, 0.1, 0), (0, 0.24, 0), 0.012, seg=12), 'pbr:metal:chrome')
    it.add(box((0.14, 0.014, 0.14), (0, 0.247, 0)), 'white_paint', bevel=(0.003, 1))
    return it.build()


def make_whiteboard():
    """Whiteboard 3.6 x 1.2 with aluminium frame and pen tray. Origin = centre on the wall."""
    it = Item('whiteboard')
    W, H, F, Dp = 3.6, 1.2, 0.03, 0.034
    it.add(box((W, H, 0.012), (0, 0, 0.012)), 'board_white')
    it.add(box((W + 2 * F, F, Dp), (0, H / 2 + F / 2, Dp / 2)), 'pbr:metal:alu', bevel=(0.004, 1))
    it.add(box((W + 2 * F, F, Dp), (0, -H / 2 - F / 2, Dp / 2)), 'pbr:metal:alu', bevel=(0.004, 1))
    for sx in (-1, 1):
        it.add(box((F, H, Dp), (sx * (W / 2 + F / 2), 0, Dp / 2)), 'pbr:metal:alu', bevel=(0.004, 1))
    ty = -H / 2 - F - 0.012
    it.add(box((3.0, 0.012, 0.09), (0, ty, 0.045)), 'pbr:metal:alu', bevel=(0.003, 1))
    it.add(box((3.0, 0.03, 0.012), (0, ty + 0.012, 0.09)), 'pbr:metal:alu', bevel=(0.003, 1))
    for sx in (-1, 1):
        it.add(box((0.012, 0.03, 0.09), (sx * 1.506, ty + 0.012, 0.045)), 'pbr:metal:alu')
    # markers and a duster resting on the tray
    it.add(tube((-0.4, ty + 0.017, 0.045), (-0.25, ty + 0.017, 0.055), 0.008, seg=8), 'pin_blue')
    it.add(tube((0.3, ty + 0.017, 0.04), (0.44, ty + 0.017, 0.05), 0.008, seg=8), 'pin_red')
    it.add(box((0.12, 0.04, 0.05), (1.0, ty + 0.032, 0.045), vround=(0.01, 2)), 'black_plastic')
    return it.build()


def make_clock():
    """Wall clock, diameter 0.32. Hands are separate pivot nodes at the centre, pointing up."""
    it = Item('clock')
    it.group('hand-h', (0, 0, 0.034))
    it.group('hand-m', (0, 0, 0.040))
    R = 0.16
    rim = [(R - 0.003, 0.0), (R, 0.004), (R, 0.032), (R - 0.006, 0.04), (R - 0.016, 0.036),
           (R - 0.016, 0.012)]
    it.add(lathe(rim, 48, rot=rot_x(90)), 'pbr:metal:alu')
    it.add(lathe([(0.0, 0.016), (R - 0.016, 0.016)], 48, rot=rot_x(90)), 'clock_face')
    for k in range(12):
        big = k % 3 == 0
        a = math.radians(30 * k)
        r = R - 0.03
        it.add(box((0.008 if big else 0.005, 0.022 if big else 0.012, 0.003),
                   (math.sin(a) * r, math.cos(a) * r, 0.0175), rot_z(-30 * k)), 'clock_hand')
    it.add(taper_box((0, -0.025, 0), (0, 0.082, 0), 0.016, 0.004, 0.004, 0.004, up=(0, 0, 1)), 'clock_hand',
           group='hand-h')
    it.add(taper_box((0, -0.03, 0), (0, 0.122, 0), 0.011, 0.004, 0.003, 0.004, up=(0, 0, 1)), 'clock_hand',
           group='hand-m')
    it.add(tube((0, 0, 0.026), (0, 0, 0.046), 0.011, seg=16), 'pbr:metal:alu', bevel=(0.002, 1))
    return it.build()


def make_door():
    """Painted steel-framed door. Origin = hinge edge on the floor; `leaf` pivots about that edge."""
    it = Item('door')
    it.group('leaf', (0, 0, 0))
    W, H, FT = 1.0, 2.1, 0.045
    it.add(box((W, H, 0.01), (W / 2, H / 2, 0.005)), 'door_recess')
    it.add(box((FT, H + FT, 0.06), (-FT / 2, (H + FT) / 2, 0.03)), 'pbr:metal:alu', bevel=(0.004, 1))
    it.add(box((FT, H + FT, 0.06), (W + FT / 2, (H + FT) / 2, 0.03)), 'pbr:metal:alu', bevel=(0.004, 1))
    it.add(box((W, FT, 0.06), (W / 2, H + FT / 2, 0.03)), 'pbr:metal:alu', bevel=(0.004, 1))
    # leaf (relative to the hinge pivot): slab, kick plate, hinges, lever handle
    it.add(box((W - 0.01, H - 0.012, 0.04), (W / 2, (H - 0.012) / 2 + 0.006, 0.034), vround=(0.004, 1)),
           'pbr:door', group='leaf', bevel=(0.004, 1))
    it.add(box((W - 0.12, 0.25, 0.004), (W / 2, 0.14, 0.056)), 'pbr:metal:alu', group='leaf')
    for y in (0.3, 1.05, 1.8):
        it.add(tube((0.0, y - 0.05, 0.034), (0.0, y + 0.05, 0.034), 0.009, seg=10), 'steel', group='leaf')
    for zface, sgn in ((0.054, 1), (0.014, -1)):
        hx, hy = W - 0.07, 1.0
        it.add(tube((hx, hy, zface), (hx, hy, zface + sgn * 0.01), 0.028, seg=20), 'pbr:metal:alu', group='leaf',
               bevel=(0.002, 1))
        it.add(tube((hx, hy, zface + sgn * 0.01), (hx, hy, zface + sgn * 0.045), 0.009, seg=12), 'pbr:metal:alu',
               group='leaf')
        it.add(box((0.13, 0.022, 0.014), (hx - 0.05, hy, zface + sgn * 0.045), vround=(0.006, 2)),
               'pbr:metal:alu', group='leaf', bevel=(0.002, 1))
    it.add(tube((W - 0.07, 0.8, 0.054), (W - 0.07, 0.8, 0.062), 0.012, seg=16), 'steel', group='leaf')
    return it.build()


def make_window():
    """Window 2.7 x 1.75: white PVC frame, four tall casement sashes (slim mullions, white lever
    handles), a roller-blind box with a few slats showing at the head, inner board."""
    it = Item('window')
    W, H, F, Dp = 2.7, 1.75, 0.07, 0.09
    it.add(box((W, F, Dp), (0, H / 2 - F / 2, 0)), 'white_paint', bevel=(0.004, 1))
    it.add(box((W, F, Dp), (0, -H / 2 + F / 2, 0)), 'white_paint', bevel=(0.004, 1))
    for sx in (-1, 1):
        it.add(box((F, H - 2 * F, Dp), (sx * (W / 2 - F / 2), 0, 0)), 'white_paint', bevel=(0.004, 1))
    iw, ih = W - 2 * F, H - 2 * F
    mw = 0.05  # mullion between two sashes (two overlapping sash stiles)
    sw = (iw - 3 * mw) / 4
    sb = 0.048  # sash border
    for k in range(4):
        cx = -iw / 2 + mw / 2 * 0 + k * (sw + mw) + sw / 2 + (0 if k == 0 else 0)
        cx = -iw / 2 + k * (sw + mw) + sw / 2
        it.add(box((sw, sb, 0.06), (cx, ih / 2 - sb / 2, 0.012)), 'white_paint', bevel=(0.003, 1))
        it.add(box((sw, sb, 0.06), (cx, -ih / 2 + sb / 2, 0.012)), 'white_paint', bevel=(0.003, 1))
        for ex in (-1, 1):
            it.add(box((sb, ih - 2 * sb, 0.06), (cx + ex * (sw / 2 - sb / 2), 0, 0.012)), 'white_paint',
                   bevel=(0.003, 1))
        if k < 3:
            it.add(box((mw, ih, 0.075), (cx + sw / 2 + mw / 2, 0, 0.006)), 'white_paint', bevel=(0.003, 1))
        # lever handle on the free stile, mid height (alternate sides as in the photo)
        hx = cx + (sw / 2 - sb / 2) * (1 if k % 2 == 0 else -1)
        it.add(box((0.032, 0.032, 0.012), (hx, -0.02, 0.05)), 'white_plastic', bevel=(0.003, 1))
        it.add(box((0.018, 0.11, 0.014), (hx, -0.075, 0.062), vround=(0.006, 2)), 'white_plastic',
               bevel=(0.002, 1))
    # roller blind: box over the head, slats peeking into the glass area
    it.add(box((W - 0.04, 0.2, 0.12), (0, H / 2 + 0.1, 0.04)), 'white_paint', bevel=(0.004, 1))
    it.add(box((W - 2 * F - 0.02, 0.12, 0.012), (0, H / 2 - F - 0.06, -0.03)), 'blind_grey')
    for yy in (0.0, -0.03, -0.06, -0.09):
        it.add(box((W - 2 * F - 0.02, 0.006, 0.016), (0, H / 2 - F - 0.015 + yy, -0.026)), 'white_paint')
    it.add(box((W + 0.1, 0.022, 0.11), (0, -H / 2 + 0.006, 0.085), vround=(0.006, 2)), 'white_paint',
           bevel=(0.003, 1))
    return it.build()


def make_radiator():
    """Deep white cantilevered sill ledge along the window wall (the old radiator item; the node
    keeps its name). Origin = floor, centred along x, wall at z=0. Segments leave gaps at +-0.3 (the
    concrete column) and a stop at +2.45 (the sink). A slim radiator grille sits in the ledge top."""
    it = Item('radiator')
    DP, TOPY, TH = 0.28, 0.80, 0.045
    for a, b in ((-3.2, -0.3), (0.3, 2.45)):
        w, cx = b - a, (a + b) / 2
        it.add(box((w, TH, DP), (cx, TOPY - TH / 2, DP / 2)), 'white_paint', bevel=(0.003, 1))
        it.add(box((w, 0.115, 0.02), (cx, TOPY - TH - 0.0575 + 0.0, DP - 0.01)), 'white_paint',
               bevel=(0.003, 1))  # front fascia
        # radiator grille set into the top, close to the glass
        it.add(box((w - 0.4, 0.004, 0.07), (cx, TOPY + 0.0015, 0.08)), 'radiator_dark')
        n = int((w - 0.5) / 0.03)
        for k in range(n):
            it.add(box((0.012, 0.006, 0.062), (cx - (w - 0.5) / 2 + (k + 0.5) * (w - 0.5) / n, TOPY + 0.003, 0.08)),
                   'white_paint')
        # steel brackets under the ledge
        for bx in (a + 0.25, cx, b - 0.25):
            it.add(box((0.02, 0.07, 0.14), (bx, TOPY - TH - 0.035, 0.07)), 'cabinet_plinth')
    return it.build()


def make_drawers():
    """Small white two-drawer unit hung under the ledge. Origin = floor, back at z=0 (wall), centred."""
    it = Item('drawers')
    W, Hh, Dp, y0 = 0.5, 0.5, 0.36, 0.25
    it.add(box((W, Hh, Dp), (0, y0 + Hh / 2, Dp / 2)), 'cabinet_white', bevel=(0.003, 1))
    for k in range(2):
        yc = y0 + Hh * (0.27 + 0.46 * k)
        it.add(box((W - 0.03, Hh / 2 - 0.03, 0.02), (0, yc, Dp + 0.005)), 'cabinet_white', bevel=(0.003, 1))
        it.add(box((0.05, 0.012, 0.012), (0, yc + 0.07, Dp + 0.022)), 'pbr:metal:alu')
        it.add(box((0.012, 0.012, 0.022), (-0.025, yc + 0.07, Dp + 0.012)), 'pbr:metal:alu')
        it.add(box((0.012, 0.012, 0.022), (0.025, yc + 0.07, Dp + 0.012)), 'pbr:metal:alu')
    return it.build()


def make_cabinet():
    """Tall white metal storage cabinet with a lock and a black plinth. Origin = floor, back at z=0."""
    it = Item('cabinet')
    W, Hh, Dp, PL = 0.8, 1.95, 0.42, 0.06
    it.add(box((W, PL, Dp - 0.03), (0, PL / 2, Dp / 2)), 'cabinet_plinth')
    it.add(box((W, Hh - PL, Dp), (0, PL + (Hh - PL) / 2, Dp / 2)), 'cabinet_white', bevel=(0.004, 1))
    it.add(box((W - 0.05, Hh - PL - 0.05, 0.012), (0, PL + (Hh - PL) / 2, Dp + 0.004)), 'cabinet_white')
    it.add(tube((W / 2 - 0.07, 1.0, Dp + 0.01), (W / 2 - 0.07, 1.0, Dp + 0.02), 0.012, seg=12), 'pbr:metal:alu')
    it.add(tube((W / 2 - 0.07, 0.9, Dp + 0.01), (W / 2 - 0.07, 0.9, Dp + 0.017), 0.009, seg=10), 'pbr:metal:alu')
    return it.build()


def make_storagebox():
    """Translucent plastic storage box with a grey lid. Origin = floor centre, long side along x."""
    it = Item('storagebox')
    L, W, Hh = 0.6, 0.4, 0.3
    it.add(box((L, Hh - 0.03, W), (0, 0.02 + (Hh - 0.03) / 2, 0), vround=(0.02, 2)), 'bin_clear',
           bevel=(0.004, 1))
    it.add(box((L + 0.03, 0.035, W + 0.03), (0, Hh - 0.0075, 0), vround=(0.025, 2)), 'bin_lid',
           bevel=(0.004, 1))
    for k in range(6):
        it.add(box((L - 0.1, 0.008, 0.016), (0, Hh + 0.012, -0.12 + k * 0.048)), 'bin_lid')
    it.add(box((L - 0.04, 0.02, W - 0.04), (0, 0.01, 0)), 'bin_clear')
    return it.build()


def make_fan():
    """White pedestal fan: round head, single pole, round base. Origin = floor centre, front = -Z."""
    it = Item('fan')
    it.add(lathe([(0, 0.0), (0.2, 0.0), (0.21, 0.012), (0.2, 0.03), (0.07, 0.04), (0.0, 0.04)], 28), 'fan_white')
    it.add(tube((0, 0.04, 0), (0, 0.78, 0), 0.02, seg=14), 'fan_white')
    # head: a sphere shell with the grille disc on the front, a carry handle on top
    it.add(sphere(0.17, (0, 0.95, 0.0), (1, 1, 0.8), seg=18), 'fan_white')
    it.add(lathe([(0.0, 0.0), (0.145, 0.0), (0.15, 0.01), (0.15, 0.02)], 24, (0, 0.95, -0.12),
                 rot_x(-90)), 'fan_white')
    for k in range(6):
        it.add(box((0.29, 0.01, 0.008), (0.0, 0.95, -0.142), rot_z(30 * k)), 'fan_white')
    it.add(tube((0, 0.95, -0.14), (0, 0.95, -0.146), 0.03, seg=14), 'fan_grey')
    it.add(box((0.2, 0.012, 0.03), (0, 1.14, 0.0), vround=(0.004, 1)), 'fan_grey')
    return it.build()


def make_sink():
    """Small wall basin with mixer tap and a mosaic splashback. Origin = rim centre at the wall."""
    it = Item('sink')
    it.add(lathe([(0, -0.14), (0.5, -0.14), (0.9, -0.1), (1.0, -0.02), (1.0, 0.0), (0.93, 0.0),
                  (0.86, -0.03), (0.5, -0.09), (0, -0.09)], 32, (0, 0, 0.2), None, (0.3, 1, 0.2)), 'ceramic')
    it.add(box((0.6, 0.12, 0.05), (0, -0.06, 0.025), vround=(0.01, 2)), 'ceramic', bevel=(0.004, 1))
    it.add(box((0.62, 0.52, 0.016), (0, 0.27, 0.008)), 'pbr:tile')
    it.add(tube((0, 0.0, 0.07), (0, 0.075, 0.07), 0.018, 0.014, seg=14), 'pbr:metal:chrome')
    it.add(tube((0, 0.075, 0.07), (0, 0.15, 0.1), 0.012, seg=12), 'pbr:metal:chrome')
    it.add(box((0.012, 0.012, 0.075), (0, 0.15, 0.1 - 0.0)), 'pbr:metal:chrome')
    it.add(tube((0.032, 0.1, 0.07), (0.07, 0.115, 0.07), 0.007, seg=8), 'pbr:metal:chrome')
    it.add(sphere(0.012, (0.07, 0.115, 0.07), seg=8), 'pbr:metal:chrome')
    it.add(tube((0, -0.14, 0.2), (0, -0.2, 0.2), 0.022, seg=12), 'pbr:metal:chrome')
    return it.build()


def make_bin():
    """Grey waste bin, 0.4 high, tapered, rolled rim. Origin = floor centre."""
    it = Item('bin')
    prof = [(0, 0.0), (0.125, 0.0), (0.14, 0.012), (0.158, 0.39), (0.166, 0.395), (0.166, 0.405),
            (0.152, 0.405), (0.15, 0.39), (0.135, 0.03), (0.0, 0.03)]
    it.add(lathe(prof, 28), 'bin_grey')
    return it.build()


def make_pinboard():
    """Pinboard 2.2 x 1.2: yellow felt, aluminium frame, a few notes and pins. Origin = centre."""
    it = Item('pinboard')
    W, H, F, Dp = 2.2, 1.2, 0.03, 0.03
    it.add(box((W, H, 0.014), (0, 0, 0.007)), 'pin_yellow')
    it.add(box((W + 2 * F, F, Dp), (0, H / 2 + F / 2, Dp / 2)), 'pbr:metal:alu', bevel=(0.004, 1))
    it.add(box((W + 2 * F, F, Dp), (0, -H / 2 - F / 2, Dp / 2)), 'pbr:metal:alu', bevel=(0.004, 1))
    for sx in (-1, 1):
        it.add(box((F, H, Dp), (sx * (W / 2 + F / 2), 0, Dp / 2)), 'pbr:metal:alu', bevel=(0.004, 1))
    notes = [(-0.85, 0.3, 0.3, 0.21, 'paper', 4), (-0.45, 0.35, 0.21, 0.3, 'note_pink', -6),
             (0.0, 0.25, 0.4, 0.28, 'paper', 2), (0.55, 0.3, 0.21, 0.21, 'note_blue', 8),
             (0.85, 0.0, 0.3, 0.4, 'paper', -3), (-0.7, -0.2, 0.4, 0.28, 'paper', -2),
             (-0.2, -0.25, 0.21, 0.21, 'note_pink', 10), (0.3, -0.3, 0.3, 0.42, 'paper', 3),
             (-0.9, -0.45, 0.2, 0.2, 'note_blue', -9)]
    for i, (x, y, w, h, m, ang) in enumerate(notes):
        it.add(box((w, h, 0.003), (x, y, 0.0155), rot_z(ang)), m)
        it.add(tube((x, y + h / 2 - 0.025, 0.017), (x, y + h / 2 - 0.025, 0.023), 0.007, seg=8),
               'pin_red' if i % 2 else 'pin_blue')
    return it.build()


def make_poster():
    """Framed poster 0.6 x 0.8 (paper colour is swapped per poster at runtime)."""
    it = Item('poster')
    W, H, F = 0.6, 0.8, 0.02
    it.add(box((W, F, 0.02), (0, H / 2 - F / 2, 0.01)), 'frame_black', bevel=(0.003, 1))
    it.add(box((W, F, 0.02), (0, -H / 2 + F / 2, 0.01)), 'frame_black', bevel=(0.003, 1))
    for sx in (-1, 1):
        it.add(box((F, H - 2 * F, 0.02), (sx * (W / 2 - F / 2), 0, 0.01)), 'frame_black', bevel=(0.003, 1))
    it.add(box((W - 2 * F, H - 2 * F, 0.004), (0, 0, 0.005)), 'poster_light')
    it.add(box((W - 0.1, H - 0.1, 0.003), (0, 0, 0.0075)), 'poster_paper')
    it.add(lathe([(0, 0), (0.1, 0)], 28, (0.0, 0.14, 0.0094), rot_x(90)), 'poster_light')
    it.add(box((W - 0.1, 0.22, 0.002), (0, -0.2, 0.0094)), 'poster_dark')
    it.add(box((0.3, 0.022, 0.002), (0, -0.2, 0.0105)), 'poster_light')
    return it.build()


def make_sharpener():
    """Wall-mounted pencil sharpener with a crank. Origin = centre on the wall."""
    it = Item('sharpener')
    it.add(box((0.12, 0.09, 0.06), (0, 0, 0.03), vround=(0.012, 2)), 'steel', bevel=(0.005, 2))
    it.add(box((0.12, 0.012, 0.01), (0, -0.045, 0.01)), 'black_plastic')
    it.add(tube((0, 0.005, 0.06), (0, 0.005, 0.066), 0.02, seg=16), 'black_plastic')
    it.add(tube((0, 0.005, 0.066), (0, 0.005, 0.068), 0.01, seg=12), 'rubber')
    it.add(box((0.022, 0.02, 0.075), (0.066, 0.0, 0.03)), 'steel', bevel=(0.003, 1))
    it.add(box((0.012, 0.06, 0.008), (0.074, -0.0, 0.07), rot_x(0)), 'steel', bevel=(0.002, 1))
    it.add(tube((0.074, -0.03, 0.065), (0.074, -0.03, 0.09), 0.009, seg=10), 'black_plastic')
    return it.build()


def make_backpack():
    """Original stylised backpack (colour set at runtime). Origin = floor centre, front = -Z."""
    it = Item('backpack')
    it.add(box((0.3, 0.42, 0.17), (0, 0.215, 0), vround=(0.05, 3)), 'bp_fabric', bevel=(0.03, 3, 80))
    it.add(box((0.26, 0.2, 0.07), (0, 0.13, -0.115), vround=(0.03, 3)), 'bp_fabric', bevel=(0.018, 2, 80))
    it.add(box((0.27, 0.025, 0.085), (0, 0.235, -0.115), vround=(0.01, 2)), 'bp_accent', bevel=(0.006, 1))
    it.add(box((0.2, 0.008, 0.02), (0, 0.38, -0.085)), 'bp_accent')
    it.add(box((0.012, 0.012, 0.02), (0, 0.375, -0.1)), 'steel')
    it.add(box((0.1, 0.26, 0.05), (0.2, 0.15, -0.005), vround=(0.025, 2)), 'bp_fabric', bevel=(0.01, 1, 80))
    it.add(box((0.28, 0.006, 0.1), (0, 0.42, -0.015)), 'bp_accent')
    for sx in (-1, 1):
        it.add(box((0.045, 0.3, 0.012), (sx * 0.08, 0.2, 0.09)), 'bp_accent', bevel=(0.003, 1))
        it.add(box((0.04, 0.04, 0.014), (sx * 0.08, 0.04, 0.09)), 'steel')
    it.add(box((0.06, 0.018, 0.02), (0, 0.435, 0.0)), 'bp_accent', bevel=(0.005, 1))
    for sx in (-1, 1):
        it.add(box((0.012, 0.024, 0.02), (sx * 0.026, 0.425, 0.0)), 'bp_accent')
    return it.build()


ITEMS = [make_chair, make_table, make_desk, make_doccam, make_laptop, make_projector, make_whiteboard,
         make_clock, make_door, make_window, make_radiator, make_drawers, make_cabinet,
         make_storagebox, make_fan, make_sink, make_bin, make_pinboard,
         make_poster, make_sharpener, make_backpack]


# ---------------------------------------------------------------------------------------------
def preview(path, names):
    """Contact-sheet render of the named items in a row (Cycles, CPU, tiny sample count)."""
    sc = bpy.context.scene
    roots = [o for o in sc.objects if o.parent is None and o.type == 'EMPTY' and (not names or o.name in names)]
    x = 0.0
    for r in roots:
        dims = max((c.dimensions.x for c in r.children_recursive if c.type == 'MESH'), default=0.5)
        r.location.x = x + dims / 2
        x += dims + 0.35
    for o in sc.objects:
        if o.parent is None and o.type == 'EMPTY' and o not in roots:
            for c in [o, *o.children_recursive]:
                c.hide_render = True
    mid = x / 2
    bpy.ops.mesh.primitive_plane_add(size=40, location=(mid, 0, -0.001))
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.0
    so = bpy.data.objects.new('sun', sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.7, 0.75, 0.8, 1)
    sc.world = w
    cam = bpy.data.cameras.new('cam')
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    span = max(x, 1.2)
    co.location = (mid + span * 0.1, -span * 0.75 - 0.6, 0.7 + span * 0.1)
    tgt = Vector((mid, 0, 0.35))
    co.rotation_euler = (tgt - co.location).to_track_quat('-Z', 'Y').to_euler()
    cam.lens = 35
    sc.camera = co
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 24
    sc.cycles.device = 'CPU'
    sc.cycles.use_denoising = False
    sc.render.resolution_x, sc.render.resolution_y = 1600, 700
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='public/models/furniture')
    ap.add_argument('--preview')
    ap.add_argument('--only', default='')
    a = ap.parse_args(argv)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    total = 0
    for fn in ITEMS:
        root = fn()
        n = tri_count(root)
        total += n
        print(f'TRIS {root.name:<11} {n}')
    print(f'TRIS total(one of each) {total}')
    os.makedirs(a.out, exist_ok=True)
    path = os.path.abspath(os.path.join(a.out, 'classroom-furniture.glb'))
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_yup=True, export_apply=True,
        export_materials='EXPORT', export_cameras=False, export_lights=False,
        export_extras=False, export_texcoords=False, export_normals=True,
    )
    print('WROTE', path, os.path.getsize(path), 'bytes')
    if a.preview:
        preview(os.path.abspath(a.preview), [s for s in a.only.split(',') if s])


main()
