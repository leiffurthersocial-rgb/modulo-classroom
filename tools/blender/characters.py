"""Modulo: Classroom -- procedural fictional characters (teacher + students) for headless Blender.

    blender -b --factory-startup -P tools/blender/characters.py -- --out public/models/characters

Builds ONE shared humanoid armature (19 bones) plus several stylised-realistic body meshes
(students and teachers, different builds/outfits), hair meshes, glasses and a laptop prop, all
skinned to that armature with hand-authored weights. Animation clips are keyed from a tiny
deterministic pose solver (forward kinematics + two-bone IK, all in plain Python), so the output
is bit-for-bit reproducible. Everything is exported to a single GLB (no textures: material
colours only; the game recolours the 'skin', 'top', 'top2', 'bottom', 'shoes', 'hair' materials).

Coordinates: Blender Z-up, characters face -Y (glTF +Z after the exporter's Y-up conversion).
Left side = +X. Units: metres. Reference height 1.70 m (the game scales per character).
All characters are fictional.
"""

import json
import math
import os
import struct
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

FPS = 30
TAU = math.pi * 2
Z = Vector((0, 0, 1))
X = Vector((1, 0, 0))
Y = Vector((0, 1, 0))

# --------------------------------------------------------------------------------------------
# Rig definition (rest = A-pose). name -> (parent, head, tail)


def _arm_dir(sx, deg):
    a = math.radians(deg)
    return Vector((sx * math.sin(a), 0, -math.cos(a)))


def _build_rig_table():
    t = {}
    t['Hips'] = (None, Vector((0, 0, 0.93)), Vector((0, 0, 1.02)))
    t['Spine'] = ('Hips', Vector((0, 0, 1.02)), Vector((0, 0, 1.20)))
    t['Chest'] = ('Spine', Vector((0, 0, 1.20)), Vector((0, 0, 1.38)))
    t['Neck'] = ('Chest', Vector((0, 0, 1.38)), Vector((0, 0, 1.50)))
    t['Head'] = ('Neck', Vector((0, 0, 1.50)), Vector((0, 0, 1.72)))
    for side, sx in (('L', 1), ('R', -1)):
        sh = Vector((sx * 0.185, 0, 1.365))
        d = _arm_dir(sx, 13)
        t['Shoulder_' + side] = ('Chest', Vector((sx * 0.03, 0, 1.37)), sh)
        elbow = sh + d * 0.29
        wrist = elbow + _arm_dir(sx, 9) * 0.255
        hand_end = wrist + _arm_dir(sx, 7) * 0.175
        t['UpperArm_' + side] = ('Shoulder_' + side, sh, elbow)
        t['Forearm_' + side] = ('UpperArm_' + side, elbow, wrist)
        t['Hand_' + side] = ('Forearm_' + side, wrist, hand_end)
        hip = Vector((sx * 0.09, 0, 0.93))
        knee = Vector((sx * 0.09, 0, 0.50))
        ankle = Vector((sx * 0.09, 0, 0.078))
        t['Thigh_' + side] = ('Hips', hip, knee)
        t['Shin_' + side] = ('Thigh_' + side, knee, ankle)
        t['Foot_' + side] = ('Shin_' + side, ankle, Vector((sx * 0.09, -0.19, 0.035)))
    return t


RIG = _build_rig_table()
BONE_ORDER = list(RIG.keys())  # parents always precede children

# --------------------------------------------------------------------------------------------
# Geometry builder


class MeshBuilder:
    """Accumulates verts/faces with per-vertex bone weights and per-face material names."""

    def __init__(self):
        self.co = []
        self.wt = []
        self.faces = []
        self.fmat = []
        self.fsmooth = []
        self.unskinned = False

    def _vert(self, p, w):
        self.co.append(Vector(p))
        self.wt.append(w(p) if callable(w) else w)
        return len(self.co) - 1

    def _face(self, idx, mat, smooth):
        self.faces.append(tuple(idx))
        self.fmat.append(mat)
        self.fsmooth.append(smooth)

    def tube(
        self,
        path,
        radii,
        U,
        V,
        weight,
        mat='skin',
        seg=12,
        cap0=0.0,
        cap1=0.0,
        keep=None,
        smooth=True,
        sx=1,
        post=None,
    ):
        """Loft elliptical rings (half-extents a along U, b along V) along `path`.

        cap0/cap1 = height of the rounded end cap (0 = open end)."""
        n = len(path)
        tan0 = (path[1] - path[0]).normalized()
        tan1 = (path[-1] - path[-2]).normalized()
        rings = []  # list of (center, a, b, s)
        if cap0 > 0:
            for ph in (60, 30):  # outermost first
                r = math.radians(ph)
                rings.append((path[0] - tan0 * cap0 * math.sin(r), radii[0], math.cos(r), 0.0))
        for i in range(n):
            rings.append((path[i], radii[i], 1.0, i / (n - 1)))
        if cap1 > 0:
            for ph in (30, 60):
                r = math.radians(ph)
                rings.append((path[-1] + tan1 * cap1 * math.sin(r), radii[-1], math.cos(r), 1.0))
        # reorder: for cap rings, radii scale = cos
        verts = []
        for c, ab, k, s in rings:
            a, b = ab
            row = []
            for j in range(seg):
                th = TAU * j / seg
                p = c + U * (a * k * math.cos(th)) + V * (b * k * math.sin(th))
                if post is not None:
                    p = post(p)
                row.append(self._vert(p, weight))
            verts.append(row)
        # winding so normals point outward
        flip = (U.cross(V)).dot(tan0) < 0
        if cap0 > 0:
            # cap0 rings are ordered outer->inner: first ring is nearest the apex? no: (60 first)
            pass
        for i in range(len(rings) - 1):
            for j in range(seg):
                a_, b_ = verts[i][j], verts[i][(j + 1) % seg]
                c_, d_ = verts[i + 1][(j + 1) % seg], verts[i + 1][j]
                cen = (self.co[a_] + self.co[b_] + self.co[c_] + self.co[d_]) * 0.25
                s_mid = (rings[i][3] + rings[i + 1][3]) * 0.5
                m = mat(cen, s_mid) if callable(mat) else mat
                if m is None:
                    continue
                if keep is not None and not keep(cen, s_mid):
                    continue
                self._face((a_, d_, c_, b_) if flip else (a_, b_, c_, d_), m, smooth)
        # apex fans
        for end, cap, ring_i, tn in ((0, cap0, 0, tan0), (1, cap1, len(rings) - 1, tan1)):
            if cap <= 0:
                continue
            c = rings[ring_i][0]
            apex_c = path[0 if end == 0 else -1] + (-tn if end == 0 else tn) * cap
            ap = self._vert(apex_c, weight)
            for j in range(seg):
                a_, b_ = verts[ring_i][j], verts[ring_i][(j + 1) % seg]
                cen = (self.co[a_] + self.co[b_] + self.co[ap]) / 3
                s_ = 0.0 if end == 0 else 1.0
                m = mat(cen, s_) if callable(mat) else mat
                if m is None:
                    continue
                if keep is not None and not keep(cen, s_):
                    continue
                # orientation: same sense as the ring quads, ends differ
                tri_flip = flip ^ (end == 0)
                self._face((a_, ap, b_) if tri_flip else (a_, b_, ap), m, smooth)

    def ellipsoid(self, c, rx, ry, rz, weight, mat='skin', seg=12, rings=7, rot=None, smooth=True):
        c = Vector(c)
        verts = []
        for i in range(1, rings):
            ph = math.pi * i / rings
            row = []
            for j in range(seg):
                th = TAU * j / seg
                p = Vector(
                    (
                        rx * math.sin(ph) * math.cos(th),
                        ry * math.sin(ph) * math.sin(th),
                        rz * math.cos(ph),
                    )
                )
                if rot is not None:
                    p = rot @ p
                row.append(self._vert(c + p, weight))
            verts.append(row)
        top_p = Vector((0, 0, rz))
        bot_p = Vector((0, 0, -rz))
        if rot is not None:
            top_p, bot_p = rot @ top_p, rot @ bot_p
        top = self._vert(c + top_p, weight)
        bot = self._vert(c + bot_p, weight)
        det = (rot.determinant() if rot is not None else 1.0) < 0
        # base winding: theta increasing ccw seen from +Z; outward normal needs (a,b,c,d) order
        # a=(i,j) b=(i,j+1) c=(i+1,j+1) d=(i+1,j): going down the rings.
        for i in range(len(verts) - 1):
            for j in range(seg):
                a_, b_ = verts[i][j], verts[i][(j + 1) % seg]
                c_, d_ = verts[i + 1][(j + 1) % seg], verts[i + 1][j]
                q = (a_, d_, c_, b_)
                self._face(q[::-1] if det else q, mat, smooth)
        for j in range(seg):
            a_, b_ = verts[0][j], verts[0][(j + 1) % seg]
            t = (top, b_, a_)
            self._face(t[::-1] if det else t, mat, smooth)
            a_, b_ = verts[-1][j], verts[-1][(j + 1) % seg]
            t = (bot, a_, b_)
            self._face(t[::-1] if det else t, mat, smooth)

    def box(self, c, hx, hy, hz, weight, mat='skin', rot=None):
        c = Vector(c)
        pts = []
        for sx_ in (-1, 1):
            for sy_ in (-1, 1):
                for sz_ in (-1, 1):
                    p = Vector((sx_ * hx, sy_ * hy, sz_ * hz))
                    if rot is not None:
                        p = rot @ p
                    pts.append(self._vert(c + p, weight))
        # index = sx*4 + sy*2 + sz  (with -1->0, 1->1)
        quads = [
            (0, 1, 3, 2),  # -x
            (4, 6, 7, 5),  # +x
            (0, 4, 5, 1),  # -y
            (2, 3, 7, 6),  # +y
            (0, 2, 6, 4),  # -z
            (1, 5, 7, 3),  # +z
        ]
        det = (rot.determinant() if rot is not None else 1.0) < 0
        for q in quads:
            qq = tuple(pts[i] for i in q)
            self._face(qq[::-1] if det else qq, mat, False)

    def torus(self, c, R, r, weight, mat, axis='Y', seg=18, tseg=6, squash=1.0):
        """Ring in the plane perpendicular to `axis` (glasses rims). squash scales the ring height."""
        c = Vector(c)
        rows = []
        for i in range(seg):
            th = TAU * i / seg
            ca, sa = math.cos(th), math.sin(th)
            row = []
            for j in range(tseg):
                ph = TAU * j / tseg
                rr = R + r * math.cos(ph)
                if axis == 'Y':
                    p = Vector((rr * ca, r * math.sin(ph), rr * sa * squash))
                else:
                    p = Vector((rr * ca, rr * sa * squash, r * math.sin(ph)))
                row.append(self._vert(c + p, weight))
            rows.append(row)
        for i in range(seg):
            for j in range(tseg):
                a_, b_ = rows[i][j], rows[i][(j + 1) % tseg]
                c_, d_ = rows[(i + 1) % seg][(j + 1) % tseg], rows[(i + 1) % seg][j]
                q = (a_, b_, c_, d_) if axis == 'Y' else (a_, d_, c_, b_)
                self._face(q, mat, True)

    def compact(self):
        """Drop unused vertices. Returns (verts, weights, faces)."""
        used = sorted({i for f in self.faces for i in f})
        remap = {o: n for n, o in enumerate(used)}
        verts = [self.co[i] for i in used]
        wts = [self.wt[i] for i in used]
        faces = [tuple(remap[i] for i in f) for f in self.faces]
        return verts, wts, faces

    def to_object(self, name, materials, arm_obj=None, collection=None):
        verts, wts, faces = self.compact()
        used = list(range(len(verts)))
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([tuple(v) for v in verts], [], faces)
        mesh.update()
        mat_names = []
        for m in self.fmat:
            if m not in mat_names:
                mat_names.append(m)
        mat_names.sort(key=lambda m: MATERIAL_ORDER.index(m))
        for m in mat_names:
            mesh.materials.append(materials[m])
        for p, m, sm in zip(mesh.polygons, self.fmat, self.fsmooth):
            p.material_index = mat_names.index(m)
            p.use_smooth = sm
        obj = bpy.data.objects.new(name, mesh)
        (collection or bpy.context.scene.collection).objects.link(obj)
        if arm_obj is not None:
            groups = {}
            for ni, oi in enumerate(used):
                for bn, w in wts[oi].items():
                    if w <= 1e-4:
                        continue
                    g = groups.get(bn)
                    if g is None:
                        g = obj.vertex_groups.new(name=bn)
                        groups[bn] = g
                    g.add([ni], w, 'REPLACE')
            obj.parent = arm_obj
            mod = obj.modifiers.new('Armature', 'ARMATURE')
            mod.object = arm_obj
        return obj

    def tri_count(self):
        return sum(1 if len(f) == 3 else 2 for f in self.faces)


MATERIAL_ORDER = ['skin', 'top', 'top2', 'bottom', 'shoes', 'eye', 'face', 'hair', 'frame', 'prop']
MATERIAL_DEFS = {
    'skin': ((0.72, 0.52, 0.42), 0.62),
    'top': ((0.30, 0.45, 0.70), 0.85),
    'top2': ((0.90, 0.90, 0.92), 0.85),
    'bottom': ((0.18, 0.22, 0.32), 0.85),
    'shoes': ((0.12, 0.12, 0.13), 0.7),
    'eye': ((0.93, 0.93, 0.92), 0.4),
    'face': ((0.10, 0.07, 0.06), 0.6),
    'hair': ((0.10, 0.07, 0.05), 0.7),
    'frame': ((0.05, 0.05, 0.06), 0.35),
    'prop': ((0.55, 0.57, 0.60), 0.45),
}


def make_materials():
    out = {}
    for name, (col, rough) in MATERIAL_DEFS.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = (*col, 1.0)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = 0.0
        out[name] = m
    return out


# --------------------------------------------------------------------------------------------
# Small math helpers


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def table_interp(table, z):
    """Catmull-Rom style interpolation over rows (z, v0, v1, ...) -> tuple of values."""
    if z <= table[0][0]:
        return tuple(table[0][1:])
    if z >= table[-1][0]:
        return tuple(table[-1][1:])
    for i in range(len(table) - 1):
        if table[i][0] <= z <= table[i + 1][0]:
            break
    z0, z1 = table[i][0], table[i + 1][0]
    t = (z - z0) / (z1 - z0)
    p0 = table[max(i - 1, 0)]
    p1, p2 = table[i], table[i + 1]
    p3 = table[min(i + 2, len(table) - 1)]
    out = []
    for k in range(1, len(p1)):
        m1 = (p2[k] - p0[k]) * 0.5 if i > 0 else (p2[k] - p1[k])
        m2 = (p3[k] - p1[k]) * 0.5 if i < len(table) - 2 else (p2[k] - p1[k])
        t2, t3 = t * t, t * t * t
        out.append(
            (2 * t3 - 3 * t2 + 1) * p1[k]
            + (t3 - 2 * t2 + t) * m1
            + (-2 * t3 + 3 * t2) * p2[k]
            + (t3 - t2) * m2
        )
    return tuple(out)


def hash01(*vals):
    h = 2166136261
    for v in vals:
        h ^= int(v * 1000003) & 0xFFFFFFFF
        h = (h * 16777619) & 0xFFFFFFFF
        h ^= h >> 13
    return (h & 0xFFFF) / 65535.0


# --------------------------------------------------------------------------------------------
# Body definitions

# Head profile: (z, rx, ry, cy) ; face toward -Y.
HEAD_TABLE = [
    (1.470, 0.028, 0.036, -0.040),
    (1.490, 0.056, 0.064, -0.026),
    (1.515, 0.073, 0.083, -0.010),
    (1.545, 0.081, 0.095, 0.000),
    (1.575, 0.085, 0.101, 0.004),
    (1.610, 0.086, 0.104, 0.008),
    (1.645, 0.082, 0.102, 0.010),
    (1.675, 0.068, 0.090, 0.012),
    (1.696, 0.044, 0.064, 0.012),
]
HEAD_Z = [HEAD_TABLE[0][0] + (HEAD_TABLE[-1][0] - HEAD_TABLE[0][0]) * i / 15 for i in range(16)]


def head_ring(z, fw=1.0):
    rx, ry, cy = table_interp(HEAD_TABLE, z)
    return rx * fw, ry, cy


def head_surface_y(z, x=0.0, fw=1.0):
    rx, ry, cy = head_ring(z, fw)
    return cy - ry * math.sqrt(max(0.0, 1 - (x / rx) ** 2))


# Build presets: widths are half-extents in metres at the reference height.
BUILDS = {
    'slim': dict(shoulder=0.168, chest=(0.150, 0.100), waist=(0.126, 0.088), hip=(0.150, 0.102), bust=0.0, belly=0.0, leg=0.92, arm=0.90, neck=0.046),
    'avg': dict(shoulder=0.180, chest=(0.160, 0.108), waist=(0.140, 0.095), hip=(0.158, 0.105), bust=0.0, belly=0.004, leg=1.0, arm=1.0, neck=0.050),
    'broad': dict(shoulder=0.200, chest=(0.178, 0.116), waist=(0.158, 0.106), hip=(0.166, 0.110), bust=0.0, belly=0.012, leg=1.08, arm=1.12, neck=0.057),
    'f_slim': dict(shoulder=0.158, chest=(0.138, 0.096), waist=(0.112, 0.082), hip=(0.156, 0.104), bust=0.012, belly=0.0, leg=0.92, arm=0.84, neck=0.041),
    'f_avg': dict(shoulder=0.164, chest=(0.144, 0.100), waist=(0.120, 0.088), hip=(0.166, 0.108), bust=0.016, belly=0.0, leg=1.0, arm=0.9, neck=0.043),
    'a_f': dict(shoulder=0.170, chest=(0.150, 0.104), waist=(0.130, 0.094), hip=(0.172, 0.112), bust=0.016, belly=0.006, leg=1.02, arm=0.94, neck=0.045),
    'a_m': dict(shoulder=0.205, chest=(0.172, 0.114), waist=(0.150, 0.104), hip=(0.164, 0.108), bust=0.0, belly=0.020, leg=1.06, arm=1.1, neck=0.058),
    'a_m_lean': dict(shoulder=0.196, chest=(0.164, 0.106), waist=(0.138, 0.094), hip=(0.156, 0.100), bust=0.0, belly=0.0, leg=1.02, arm=1.02, neck=0.054),
}

OUTFITS = {
    # hem: z below which the torso reads as 'bottom'; sleeve: fraction of the arm covered
    'tee': dict(hem=0.90, flare=0.0, sleeve=(0.50, 0.0), shirt_v=False, hood=False, lapel=False),
    'long': dict(hem=0.89, flare=0.004, sleeve=(1.0, 1.0), shirt_v=False, hood=False, lapel=False),
    'hoodie': dict(hem=0.86, flare=0.010, sleeve=(1.0, 1.0), shirt_v=False, hood=True, lapel=False),
    'blazer': dict(hem=0.80, flare=0.014, sleeve=(1.0, 1.0), shirt_v=True, hood=False, lapel=True),
    'cardigan': dict(hem=0.82, flare=0.010, sleeve=(1.0, 1.0), shirt_v=True, hood=False, lapel=False),
}

# Body mesh variants: id -> (build, outfit, bottom_style, shoe_style, face_width)
BODIES = {
    'stu_slim_tee': ('slim', 'tee', 'pants', 'sneaker', 0.96),
    'stu_avg_long': ('avg', 'long', 'pants', 'sneaker', 1.0),
    'stu_broad_hoodie': ('broad', 'hoodie', 'pants', 'sneaker', 1.04),
    'stu_broad_tee': ('broad', 'tee', 'shorts', 'sneaker', 1.04),
    'stu_f_slim_tee': ('f_slim', 'tee', 'pants', 'sneaker', 0.94),
    'stu_f_avg_hoodie': ('f_avg', 'hoodie', 'pants', 'sneaker', 0.97),
    'stu_f_avg_long': ('f_avg', 'long', 'pants', 'sneaker', 0.97),
    'tch_f_blazer': ('a_f', 'blazer', 'pants', 'dress', 0.98),
    'tch_m_blazer': ('a_m', 'blazer', 'pants', 'dress', 1.04),
    'tch_m_cardigan': ('a_m_lean', 'cardigan', 'pants', 'dress', 1.0),
    'tch_f_cardigan': ('a_f', 'cardigan', 'pants', 'dress', 0.98),
    'tch_u_hoodie': ('a_m_lean', 'hoodie', 'pants', 'sneaker', 1.0),
}

HAIR_STYLES = ['short', 'buzz', 'long', 'bob', 'ponytail', 'bun', 'curly', 'cap', 'wild']


def torso_table(b, o):
    sh = b['shoulder']
    cx, cy_ = b['chest']
    wx, wy = b['waist']
    hx, hy = b['hip']
    fl = o['flare']
    rows = [
        # z, rx, ry, cy (centre y offset; negative = forward)
        (0.80, hx - 0.012 + fl, hy - 0.012 + fl * 0.5, 0.0),
        (0.86, hx + 0.002 + fl, hy + 0.002 + fl * 0.5, 0.0),
        (0.93, hx + fl * 0.6, hy + fl * 0.4, 0.004 + b['belly'] * 0.3),
        (1.02, wx + fl * 0.3, wy + b['belly'], -b['belly'] * 0.5),
        (1.10, lerp(wx, cx, 0.45), lerp(wy, cy_, 0.5) + b['belly'] * 0.5, -b['belly'] * 0.3),
        (1.20, cx, cy_ + b['bust'] * 0.5, -b['bust'] * 0.5),
        (1.27, cx + 0.008, cy_ + b['bust'], -b['bust']),
        (1.33, sh * 0.93, cy_ - 0.014, -0.004),
        (1.37, sh * 0.72, 0.078, 0.0),
        (1.405, 0.074, 0.070, 0.0),
    ]
    return rows


def torso_weight(co):
    z = co.z
    w = {}
    h_s = smoothstep(0.98, 1.10, z)  # hips -> spine
    s_c = smoothstep(1.16, 1.28, z)  # spine -> chest
    hips = 1 - h_s
    spine = h_s * (1 - s_c)
    chest = h_s * s_c
    if hips > 0:
        w['Hips'] = hips
    if spine > 0:
        w['Spine'] = spine
    if chest > 0:
        w['Chest'] = chest
    return w


def neck_weight(co):
    z = co.z
    c = 1 - smoothstep(1.37, 1.43, z)
    h = smoothstep(1.46, 1.52, z)
    n = 1 - c - h
    w = {}
    if c > 0:
        w['Chest'] = c
    if n > 0:
        w['Neck'] = n
    if h > 0:
        w['Head'] = h
    return w


def build_body(name, mats, arm_obj):
    bname, oname, bottom, shoe, fw = BODIES[name]
    b = BUILDS[bname]
    o = OUTFITS[oname]
    mb = MeshBuilder()
    girth_leg = b['leg']
    girth_arm = b['arm']

    # ---- torso (single loft; material split by height / V-region)
    rows = torso_table(b, o)
    rows = sorted(rows + [(o['hem'],) + table_interp(rows, o['hem'])], key=lambda r: r[0])
    path = [Vector((0, r[3], r[0])) for r in rows]
    radii = [(r[1], r[2]) for r in rows]
    hem = o['hem']

    def torso_mat(c, s):
        if c.z < hem:
            return 'bottom'
        if o['shirt_v'] and c.y < -0.03 and 1.10 < c.z < 1.405:
            v = 0.020 + (c.z - 1.10) * (0.20 if oname == 'cardigan' else 0.12)
            if abs(c.x) < v:
                return 'top2'
        if oname in ('blazer', 'cardigan') and c.z > 1.385 and c.y > -0.01:
            return 'top2' if oname == 'cardigan' else 'top'
        return 'top'

    mb.tube(path, radii, X, Y, torso_weight, mat=torso_mat, seg=20, cap0=0.0, cap1=0.0)
    # waist belt (suggested by a darker band for pants styles)
    # ---- neck
    npath = [Vector((0.0, 0.004, z)) for z in (1.385, 1.42, 1.46, 1.50, 1.535)]
    nr = b['neck']
    nrad = [(nr * 1.08, nr), (nr * 1.0, nr * 0.95), (nr * 0.95, nr * 0.92), (nr * 0.92, nr * 0.9), (nr * 0.92, nr * 0.9)]
    mb.tube(npath, nrad, X, Y, neck_weight, mat='skin', seg=14)
    # collar ring (shirt / hoodie neck)
    if oname in ('hoodie', 'long'):
        cp = [Vector((0, 0.004, z)) for z in (1.37, 1.395, 1.425)]
        cr = [(nr * 1.55, nr * 1.5), (nr * 1.32, nr * 1.28), (nr * 1.12, nr * 1.08)]
        mb.tube(cp, cr, X, Y, {'Chest': 1.0}, mat='top', seg=16)
    if o['hood']:
        mb.ellipsoid((0, 0.075, 1.40), 0.105, 0.065, 0.055, {'Chest': 1.0}, mat='top', seg=14, rings=6)
    elif oname == 'tee':
        cp = [Vector((0, 0.002, z)) for z in (1.385, 1.405)]
        mb.tube(cp, [(nr * 1.28, nr * 1.22), (nr * 1.12, nr * 1.08)], X, Y, {'Chest': 1.0}, mat='top2', seg=16)
    elif oname in ('blazer', 'cardigan'):
        cp = [Vector((0, 0.003, z)) for z in (1.375, 1.40, 1.425)]
        mb.tube(cp, [(nr * 1.55, nr * 1.45), (nr * 1.32, nr * 1.22), (nr * 1.14, nr * 1.08)], X, Y, {'Chest': 1.0}, mat='top2', seg=16)

    # ---- head
    hp = [Vector((0, head_ring(z)[2], z)) for z in HEAD_Z]
    hr = [(head_ring(z, fw)[0], head_ring(z)[1]) for z in HEAD_Z]
    mb.tube(hp, hr, X, Y, {'Head': 1.0}, mat='skin', seg=24, cap0=0.012, cap1=0.020)
    add_face(mb, fw)

    # ---- limbs (both sides)
    for side, sx in (('L', 1), ('R', -1)):
        ub, fb, hb = RIG['UpperArm_' + side], RIG['Forearm_' + side], RIG['Hand_' + side]
        sh, el, wr, hend = ub[1], ub[2], fb[2], hb[2]
        # direction frames for arm tubes
        def arm_frame(p0, p1):
            d = (p1 - p0).normalized()
            u = X * sx if abs(d.dot(X)) < 0.9 else Y
            u = (u - d * u.dot(d)).normalized()
            v = d.cross(u).normalized()
            return u, v

        sl_u, sl_f = o['sleeve']
        # upper arm
        u, v = arm_frame(sh, el)
        pth = [sh + (el - sh) * t for t in (0.0, 0.25, 0.6, 1.0)]
        ru = [(0.052 * girth_arm, 0.050 * girth_arm), (0.050 * girth_arm, 0.048 * girth_arm), (0.044 * girth_arm, 0.043 * girth_arm), (0.039 * girth_arm, 0.038 * girth_arm)]
        mb.tube(
            pth, ru, u, v, {'UpperArm_' + side: 1.0},
            mat=lambda c, s: 'top' if s <= sl_u + 0.001 or sl_u >= 1 else 'skin',
            seg=12, cap0=0.045 * girth_arm, cap1=0.036 * girth_arm,
        )
        # forearm
        u, v = arm_frame(el, wr)
        pth = [el + (wr - el) * t for t in (0.0, 0.3, 0.7, 1.0)]
        rf = [(0.039 * girth_arm, 0.038 * girth_arm), (0.040 * girth_arm, 0.037 * girth_arm), (0.034 * girth_arm, 0.030 * girth_arm), (0.029 * girth_arm, 0.025 * girth_arm)]
        mb.tube(
            pth, rf, u, v, {'Forearm_' + side: 1.0},
            mat=lambda c, s: 'top' if (sl_f >= 1 and s < 0.93) else 'skin',
            seg=12, cap0=0.03, cap1=0.0,
        )
        if sl_f >= 1:
            # cuff band
            cp = [wr - (wr - el).normalized() * 0.03, wr + (wr - el).normalized() * 0.002]
            mb.tube(cp, [(0.033 * girth_arm, 0.029 * girth_arm), (0.032 * girth_arm, 0.028 * girth_arm)], u, v, {'Forearm_' + side: 1.0}, mat='top', seg=12)
        # hand: flattened mitten, wide axis = Y (palm normal = X), thumb forward
        hd = (hend - wr).normalized()
        hu = Y
        hv = (hd.cross(hu)).normalized() * -1
        hv = (hv - hd * hv.dot(hd)).normalized()
        L = (hend - wr).length
        pth = [wr + hd * (L * t) for t in (-0.06, 0.12, 0.38, 0.62, 0.84, 1.0)]
        rh = [(0.027, 0.020), (0.036, 0.020), (0.042, 0.019), (0.040, 0.017), (0.034, 0.014), (0.024, 0.011)]
        mb.tube(pth, rh, hu, hv, {'Hand_' + side: 1.0}, mat='skin', seg=10, cap0=0.0, cap1=0.012)
        # thumb
        tp0 = wr + hd * (L * 0.22) + Vector((-sx * 0.012, -0.030, 0.0))
        tdir = (hd * 0.7 + Vector((0, -0.7, 0)) + Vector((-sx * 0.15, 0, 0))).normalized()
        tp = [tp0 + tdir * (0.062 * t) for t in (0.0, 0.5, 1.0)]
        mb.tube(tp, [(0.012, 0.011), (0.011, 0.010), (0.009, 0.008)], X, Z, {'Hand_' + side: 1.0}, mat='skin', seg=7, cap0=0.007, cap1=0.008)

        # legs
        tb, sb, fb2 = RIG['Thigh_' + side], RIG['Shin_' + side], RIG['Foot_' + side]
        hip, knee, ankle = tb[1], tb[2], sb[2]
        rt = [(0.090 * girth_leg, 0.094 * girth_leg), (0.082 * girth_leg, 0.088 * girth_leg), (0.067 * girth_leg, 0.070 * girth_leg), (0.056 * girth_leg, 0.058 * girth_leg)]
        pth = [hip + (knee - hip) * t for t in (0.0, 0.35, 0.8, 1.0)]
        bot_mat = 'bottom'
        mb.tube(pth, rt, X, Y, {'Thigh_' + side: 1.0}, mat=bot_mat, seg=14, cap0=0.05, cap1=0.03)
        pth = [knee + (ankle - knee) * t for t in (0.0, 0.2, 0.55, 0.88, 1.0)]
        rs = [(0.056 * girth_leg, 0.058 * girth_leg), (0.058 * girth_leg, 0.062 * girth_leg), (0.047 * girth_leg, 0.049 * girth_leg), (0.037 * girth_leg, 0.038 * girth_leg), (0.036 * girth_leg, 0.036 * girth_leg)]
        short = bottom == 'shorts'
        mb.tube(
            pth, rs, X, Y, {'Shin_' + side: 1.0},
            mat=(lambda c, s: 'skin' if s > 0.18 else 'bottom') if short else 'bottom',
            seg=14, cap0=0.03, cap1=0.0,
        )
        if short:  # socks
            sp = [ankle + Vector((0, 0, 0.12 * t)) for t in (0.0, 0.5, 1.0)]
            mb.tube(sp, [(0.039, 0.039), (0.040, 0.040), (0.041, 0.041)], X, Y, {'Shin_' + side: 1.0}, mat='top2', seg=12)
        # shoe
        sw = 1.0
        sx0 = ankle.x
        shoe_rows = [
            # y, half-width, half-height, centre z
            (0.068, 0.032, 0.034, 0.040),
            (0.030, 0.040, 0.044, 0.046),
            (-0.030, 0.045, 0.046, 0.046),
            (-0.090, 0.049, 0.040, 0.042),
            (-0.150, 0.049, 0.032, 0.035),
            (-0.200, 0.036, 0.022, 0.026),
        ]
        if shoe == 'dress':
            shoe_rows = [(y, w * 0.94, h * 0.9, c) for (y, w, h, c) in shoe_rows]
        sp = [Vector((sx0, r[0], r[3])) for r in shoe_rows]
        sr = [(r[1] * sw, r[2]) for r in shoe_rows]
        mb.tube(sp, sr, X, Z, {'Foot_' + side: 1.0}, mat='shoes', seg=12, cap0=0.012, cap1=0.012)
        # shoe sole line (light) for sneakers
        if shoe == 'sneaker':
            sp2 = [Vector((sx0, r[0], 0.010)) for r in shoe_rows]
            sr2 = [(r[1] * 1.03, 0.012) for r in shoe_rows]
            mb.tube(sp2, sr2, X, Z, {'Foot_' + side: 1.0}, mat='top2', seg=10, cap0=0.006, cap1=0.006)
    return mb


def add_face(mb, fw):
    """Eyes, brows, nose, mouth, ears on the head (weights: Head)."""
    W = {'Head': 1.0}
    ze = 1.603
    for sx in (1, -1):
        x = sx * 0.036 * fw
        ys = head_surface_y(ze, x, fw)
        # eyeball (white) + iris/pupil (dark)
        mb.ellipsoid((x, ys + 0.0035, ze), 0.0135, 0.0105, 0.0115, W, mat='eye', seg=10, rings=6)
        mb.ellipsoid((x + sx * 0.0005, ys - 0.0042, ze - 0.0005), 0.0078, 0.0045, 0.0082, W, mat='face', seg=10, rings=5)
        # brow: flat slab tilted slightly
        zb = 1.632
        ysb = head_surface_y(zb, x, fw)
        rot = Matrix.Rotation(sx * -0.14, 3, 'Y')
        mb.ellipsoid((x, ysb - 0.001, zb), 0.019, 0.006, 0.0042, W, mat='face', seg=8, rings=5, rot=rot)
        # ear
        ze2 = 1.572
        rx, ry, cy = head_ring(ze2, fw)
        mb.ellipsoid((sx * (rx + 0.002), cy + 0.012, ze2), 0.0085, 0.020, 0.030, W, mat='skin', seg=8, rings=5)
    # nose
    zn = 1.570
    yn = head_surface_y(zn, 0, fw)
    mb.ellipsoid((0, yn - 0.006, zn + 0.004), 0.0095, 0.019, 0.026, W, mat='skin', seg=8, rings=5, rot=Matrix.Rotation(-0.35, 3, 'X'))
    mb.ellipsoid((0, yn - 0.018, zn - 0.014), 0.0135, 0.0105, 0.0105, W, mat='skin', seg=8, rings=5)
    # mouth
    zm = 1.521
    ym = head_surface_y(zm, 0, fw)
    mb.ellipsoid((0, ym - 0.0005, zm), 0.021, 0.0045, 0.0042, W, mat='face', seg=8, rings=5)


# --------------------------------------------------------------------------------------------
# Hair


def hair_shell(mb, mat, scale=(1.07, 1.06), lift=0.004, zmin=1.50, keep=None, seg=48, extra_rings=None):
    post = None
    if keep is not None and hasattr(keep, 'zt'):
        zt = keep.zt
        post = lambda p: Vector((p.x, p.y, max(p.z, zt(p))))
        keep = lambda c, s, zt=zt: c.z > zt(c) + 1e-5
    zs = [zmin + (1.70 - zmin) * i / 30 for i in range(31)]
    path, radii = [], []
    for z in zs:
        rx, ry, cy = head_ring(min(z, 1.696))
        k = 1.0 if z < 1.66 else 1.0
        path.append(Vector((0, cy - 0.002, z + (lift if z > 1.6 else 0))))
        radii.append((rx * scale[0] + 0.003, ry * scale[1] + 0.004))
    mb.tube(path, radii, X, Y, {'Head': 1.0}, mat=mat, seg=seg, cap0=0.0, cap1=0.026, keep=keep, post=post)


def hairline_keep(front, temple, back, side_ear=None):
    """Keep faces above a z-threshold that depends on the angle around the head."""

    def zt(c):
        ang = math.atan2(c.x, -(c.y - 0.01))  # 0 = front, pi = back
        a = abs(ang)
        if a < 0.7:
            return lerp(front, temple, smoothstep(0.0, 0.7, a) * 0.5 + a / 0.7 * 0.5)
        if a < 1.6:
            return lerp(temple, side_ear if side_ear is not None else temple, (a - 0.7) / 0.9)
        return lerp(side_ear if side_ear is not None else temple, back, (a - 1.6) / (math.pi - 1.6))

    def keep(c, s):
        return c.z >= zt(c)

    keep.zt = zt
    return keep


def build_hair(style, mats, arm_obj):
    mb = MeshBuilder()
    H = {'Head': 1.0}
    if style == 'short':
        hair_shell(mb, 'hair', keep=hairline_keep(1.645, 1.612, 1.545, 1.585))
        # side part fringe
        mb.ellipsoid((0.025, -0.092, 1.655), 0.06, 0.02, 0.02, H, mat='hair', seg=10, rings=5, rot=Matrix.Rotation(0.1, 3, 'Y'))
    elif style == 'buzz':
        hair_shell(mb, 'hair', scale=(1.025, 1.025), lift=0.0, keep=hairline_keep(1.652, 1.62, 1.56, 1.6))
    elif style == 'long':
        hair_shell(mb, 'hair', keep=hairline_keep(1.64, 1.58, 1.50, 1.50))
        long_curtain(mb, 1.30, 0.092)
    elif style == 'bob':
        hair_shell(mb, 'hair', keep=hairline_keep(1.636, 1.57, 1.47, 1.47))
        long_curtain(mb, 1.46, 0.088, front_cut=1.50)
    elif style == 'ponytail':
        hair_shell(mb, 'hair', keep=hairline_keep(1.645, 1.605, 1.53, 1.58))
        tail = [Vector((0, 0.118, 1.63)), Vector((0, 0.150, 1.60)), Vector((0, 0.172, 1.52)), Vector((0, 0.170, 1.43)), Vector((0, 0.155, 1.36))]
        mb.tube(tail, [(0.030, 0.030), (0.036, 0.036), (0.040, 0.034), (0.034, 0.028), (0.020, 0.018)], X, Y, H, mat='hair', seg=10, cap0=0.02, cap1=0.03)
        mb.ellipsoid((0, 0.122, 1.625), 0.026, 0.016, 0.026, H, mat='top2', seg=8, rings=5)  # hair tie
    elif style == 'bun':
        hair_shell(mb, 'hair', keep=hairline_keep(1.642, 1.60, 1.52, 1.56))
        mb.ellipsoid((0, 0.075, 1.715), 0.052, 0.052, 0.046, H, mat='hair', seg=12, rings=7)
    elif style == 'curly':
        curly_cap(mb, 1.14)
    elif style == 'wild':
        curly_cap(mb, 1.26, wild=True)
    elif style == 'cap':
        hair_shell(mb, 'hair', keep=hairline_keep(1.60, 1.57, 1.52, 1.56))
        # cap dome (top2) + brim
        hair_shell(mb, 'top2', scale=(1.10, 1.10), lift=0.010, zmin=1.612, keep=None, seg=24)
        brim = [Vector((0, -0.10, 1.638)), Vector((0, -0.155, 1.633)), Vector((0, -0.205, 1.622))]
        mb.tube(brim, [(0.082, 0.004), (0.080, 0.003), (0.062, 0.003)], X, Y, H, mat='top2', seg=14, cap1=0.0, smooth=False)
    return mb


def long_curtain(mb, z_end, rx_end, front_cut=1.545):
    zs = [1.60, 1.52, 1.44, 1.38, z_end] if z_end < 1.38 else [1.60, 1.53, 1.48, z_end]
    zs = sorted(set(zs), reverse=True)
    path, radii = [], []
    for z in zs:
        t = (1.60 - z) / (1.60 - z_end)
        cy = lerp(0.012, 0.125, t**0.9)
        path.append(Vector((0, cy, z)))
        rx = lerp(0.096, rx_end + 0.012, t)
        ry = lerp(0.108, 0.046, t)
        radii.append((rx, ry))

    def keep(c, s):
        return not (c.y < 0.035 and c.z < front_cut)

    mb.tube(path, radii, X, Y, {'Head': 1.0}, mat='hair', seg=22, cap0=0.0, cap1=0.03, keep=keep)


def curly_cap(mb, scale, wild=False):
    seg, rings = 22, 11
    ring_verts = []
    cx, cy, cz = 0.0, 0.012, 1.636
    rx, ry, rz = 0.092 * scale, 0.106 * scale, 0.100 * scale * (1.0 if not wild else 1.05)
    top = None
    for i in range(1, rings + 1):
        ph = (math.pi * 0.5) * i / rings  # from top down to the equator
        row = []
        for j in range(seg):
            th = TAU * j / seg
            n = hash01(i, j, scale * 100)
            bump = 1.0 + 0.07 * math.sin(th * 5 + i * 1.7) * math.sin(ph * 4 + 1.3) + (n - 0.5) * 0.05
            p = Vector(
                (
                    rx * bump * math.sin(ph) * math.cos(th),
                    cy + ry * bump * math.sin(ph) * math.sin(th),
                    cz + rz * bump * math.cos(ph) * (1.0 if ph < 1.3 else 1.0) - 0.012,
                )
            )
            row.append(mb._vert(p, {'Head': 1.0}))
        ring_verts.append(row)
    top_i = mb._vert(Vector((0, cy, cz + rz * 1.02 - 0.012)), {'Head': 1.0})
    face_clear = 1.655

    def okc(c):
        ang = math.atan2(c.x, -(c.y - 0.01))
        return not (abs(ang) < 1.05 and c.z < face_clear and c.y < 0.0)

    for j in range(seg):
        a_, b_ = ring_verts[0][j], ring_verts[0][(j + 1) % seg]
        mb._face((top_i, a_, b_), 'hair', True)
    for i in range(rings - 1):
        for j in range(seg):
            a_, b_ = ring_verts[i][j], ring_verts[i][(j + 1) % seg]
            c_, d_ = ring_verts[i + 1][(j + 1) % seg], ring_verts[i + 1][j]
            cen = (mb.co[a_] + mb.co[b_] + mb.co[c_] + mb.co[d_]) * 0.25
            if not okc(cen):
                continue
            mb._face((a_, d_, c_, b_), 'hair', True)


def build_glasses(mats):
    mb = MeshBuilder()
    W = {'Head': 1.0}
    ze = 1.603
    for sx in (1, -1):
        x = sx * 0.036
        ys = head_surface_y(ze, x) - 0.012
        mb.torus((x, ys, ze), 0.0185, 0.0020, W, 'frame', axis='Y', seg=20, tseg=5, squash=0.85)
        # temple arm
        rx, ry, cy = head_ring(ze)
        arm = [Vector((x + sx * 0.018, ys + 0.002, ze + 0.003)), Vector((sx * (rx + 0.003), cy - 0.04, ze + 0.004)), Vector((sx * (rx + 0.004), cy + 0.03, ze + 0.0))]
        mb.tube(arm, [(0.0018, 0.0018)] * 3, X, Z, W, mat='frame', seg=5, smooth=True)
    mb.tube([Vector((-0.017, head_surface_y(ze, 0) - 0.012, ze + 0.004)), Vector((0.017, head_surface_y(ze, 0) - 0.012, ze + 0.004))], [(0.0016, 0.0016)] * 2, Y, Z, W, mat='frame', seg=5)
    return mb


def build_laptop(mats):
    """A small laptop prop in character space: lid open on the table in front of a seated person."""
    mb = MeshBuilder()
    W = {'Hips': 1.0}
    mb.unskinned = True
    # base on the table (z=0.72) in front of the seat centre; lid tilted back
    mb.box((0, -0.47, 0.7275), 0.16, 0.115, 0.0075, W, mat='prop')
    mb.box((0, -0.585, 0.835), 0.16, 0.005, 0.105, W, mat='prop', rot=Matrix.Rotation(math.radians(-12), 3, 'X'))
    return mb


# --------------------------------------------------------------------------------------------
# Rig object


def make_armature():
    arm = bpy.data.armatures.new('Armature')
    obj = bpy.data.objects.new('Armature', arm)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    ebs = {}
    for name in BONE_ORDER:
        parent, head, tail = RIG[name]
        eb = arm.edit_bones.new(name)
        eb.head = head
        eb.tail = tail
        ebs[name] = eb
        if parent:
            eb.parent = ebs[parent]
        eb.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    return obj


# --------------------------------------------------------------------------------------------
# Pose solver (armature space, pure Python)


def _unit_arc(a, b):
    return a.normalized().rotation_difference(b.normalized())


class Rest:
    """Rest data read back from the real armature (bone rest rotation in armature space)."""

    def __init__(self, arm_obj):
        self.R = {}
        for pb in arm_obj.pose.bones:
            self.R[pb.name] = pb.bone.matrix_local.to_3x3().copy()
        self.head = {n: RIG[n][1].copy() for n in RIG}
        self.tail = {n: RIG[n][2].copy() for n in RIG}
        self.parent = {n: RIG[n][0] for n in RIG}
        self.dir = {n: (RIG[n][2] - RIG[n][1]).normalized() for n in RIG}
        self.len = {n: (RIG[n][2] - RIG[n][1]).length for n in RIG}
        self.side = {
            'Hand_L': Vector((-1, 0, 0)),
            'Hand_R': Vector((1, 0, 0)),
        }


class Pose:
    def __init__(self, rest):
        self.r = rest
        self.D = {}
        self.root = Vector((0, 0, 0))

    def delta(self, b):
        if b in self.D:
            return self.D[b]
        p = self.r.parent[b]
        return self.delta(p) if p else Quaternion()

    def head(self, b):
        p = self.r.parent[b]
        if p is None:
            return self.r.head[b] + self.root
        return self.head(p) + self.delta(p) @ (self.r.head[b] - self.r.head[p])

    def tail(self, b):
        return self.head(b) + self.delta(b) @ (self.r.tail[b] - self.r.head[b])

    def point(self, b, rest_pt):
        """World position of a point rigidly attached to bone b (given in rest coordinates)."""
        return self.head(b) + self.delta(b) @ (Vector(rest_pt) - self.r.head[b])

    # --- setters (call top-down)
    def rel(self, b, q):
        """Rotate bone b by q (about world axes through its head) on top of its parent's pose."""
        p = self.r.parent[b]
        self.D[b] = q @ (self.delta(p) if p else Quaternion())

    def rel_euler(self, b, x=0.0, y=0.0, z=0.0):
        """Degrees about world X (lean fwd +), Y, Z (turn left +), applied in Z,Y,X order."""
        q = (
            Quaternion(Z, math.radians(z))
            @ Quaternion(Y, math.radians(y))
            @ Quaternion(X, math.radians(x))
        )
        self.rel(b, q)

    def aim(self, b, d, twist=0.0):
        q = _unit_arc(self.r.dir[b], d)
        if twist:
            q = Quaternion(d.normalized(), math.radians(twist)) @ q
        self.D[b] = q

    def orient(self, b, fwd, side):
        f0 = self.r.dir[b]
        s0 = self.r.side[b]
        s0 = (s0 - f0 * s0.dot(f0)).normalized()
        f1 = fwd.normalized()
        s1 = (side - f1 * side.dot(f1)).normalized()
        m0 = Matrix((f0, s0, f0.cross(s0))).transposed()
        m1 = Matrix((f1, s1, f1.cross(s1))).transposed()
        self.D[b] = (m1 @ m0.inverted()).to_quaternion()

    def ik(self, upper, lower, target, pole):
        S = self.head(upper)
        l1, l2 = self.r.len[upper], self.r.len[lower]
        v = target - S
        d = v.length
        d = max(abs(l1 - l2) + 1e-4, min(l1 + l2 - 1e-4, d))
        dv = v.normalized()
        a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
        h = math.sqrt(max(l1 * l1 - a * a, 0.0))
        perp = pole - dv * pole.dot(dv)
        if perp.length < 1e-5:
            perp = Vector((0, -1, 0)) - dv * Vector((0, -1, 0)).dot(dv)
        perp.normalize()
        elbow = S + dv * a + perp * h
        end = S + dv * d
        self.aim(upper, elbow - S)
        self.aim(lower, end - elbow)

    def local(self, b):
        """Pose-bone local quaternion for bone b."""
        R = self.r.R[b].to_quaternion()
        p = self.r.parent[b]
        dp = self.delta(p) if p else Quaternion()
        q = R.inverted() @ dp.inverted() @ self.delta(b) @ R
        return q

    def node_q(self, b):
        """Rotation of the glTF bone node (identity rest rotation, armature axes)."""
        p = self.r.parent[b]
        dp = self.delta(p) if p else Quaternion()
        return dp.inverted() @ self.delta(b)

    def local_root_loc(self):
        return self.r.R['Hips'].inverted() @ self.root


def sx_of(side):
    return 1 if side == 'L' else -1


# --------------------------------------------------------------------------------------------
# Animation clips. Each builder returns a function pose(t01) -> Pose for t01 in [0,1)

SEAT_Z = 0.555  # hip joint height when seated on the 0.46 chair (seat top 0.475)
SEAT_DY = 0.04  # pelvis sits slightly behind the seat centre (+Y = back)
HIP_DROP = SEAT_Z - 0.93


def v3(x, y, z):
    return Vector((x, y, z))


def breathe(p, t, amp=1.0, T=1.0, phase=0.0):
    s = math.sin(TAU * (t / T) + phase)
    p.rel_euler('Chest', x=0.7 * amp * s)
    return s


def legs_stand(P, stance=0.18, shift=0.0):
    """Both feet flat on the floor, hips centred (small weight shift)."""
    for side in ('L', 'R'):
        sx = sx_of(side)
        ank = v3(sx * (0.095 + stance * 0.2), 0.0, 0.078)
        # IK from the (possibly moved) hip to a fixed ankle on the floor
        P.ik('Thigh_' + side, 'Shin_' + side, ank, v3(sx * 0.2, -1, 0))
        P.D['Foot_' + side] = Quaternion()


def foot_flat(P, side, pos, toe=0.0):
    P.ik('Thigh_' + side, 'Shin_' + side, pos, v3(sx_of(side) * 0.15, -1, 0))
    P.D['Foot_' + side] = Quaternion(X, math.radians(toe))


def seat_base(P, lean=8.0, twist=0.0, tilt=0.0, hip_y=SEAT_DY, knees_apart=0.0, u=0.0):
    """Seated: pelvis on the seat, thighs forward, feet on the floor. Upper body not yet posed."""
    ph = TAU * u
    P.root = v3(0.007 * math.sin(ph), hip_y + 0.004 * math.sin(ph * 2), HIP_DROP)
    P.rel_euler('Hips', x=-2.0, z=1.5 * math.sin(ph), y=1.2 * math.sin(ph))
    for side in ('L', 'R'):
        sx = sx_of(side)
        foot = v3(sx * (0.115 + knees_apart), -0.44, 0.078)
        # knees: IK with pole pointing forward and a little outward
        P.ik('Thigh_' + side, 'Shin_' + side, foot, v3(sx * 0.25, -1, 0.2))
        P.D['Foot_' + side] = Quaternion()
    P.rel_euler('Spine', x=lean * 0.55, y=tilt * 0.5, z=twist * 0.4)
    P.rel_euler('Chest', x=lean * 0.45, y=tilt * 0.5, z=twist * 0.6)


def head_pose(P, pitch=0.0, yaw=0.0, roll=0.0, neck_share=0.45):
    """pitch + = look down. Spread over Neck/Head."""
    P.rel_euler('Neck', x=pitch * neck_share, y=roll * 0.4, z=yaw * neck_share)
    P.rel_euler('Head', x=pitch * (1 - neck_share), y=roll * 0.6, z=yaw * (1 - neck_share))


def arm_to(P, side, wrist, pole=None, palm='down', fwd=None, hand_roll=None):
    sx = sx_of(side)
    P.rel_euler('Shoulder_' + side, z=0)  # follow chest
    pole = pole or v3(sx * 0.7, 0.2, -0.7)
    P.ik('UpperArm_' + side, 'Forearm_' + side, wrist, pole)
    hn = 'Hand_' + side
    if fwd is None:
        fwd = (wrist - P.tail('Forearm_' + side) + (P.tail('Forearm_' + side) - P.head('Forearm_' + side)))
        fwd = (P.tail('Forearm_' + side) - P.head('Forearm_' + side)).normalized()
    normal = {'down': v3(0, 0, -1), 'in': v3(-sx, 0, 0), 'up': v3(0, 0, 1), 'out': v3(sx, 0, 0), 'fwd': v3(0, -1, 0)}[palm] if isinstance(palm, str) else palm
    P.orient(hn, fwd, normal)


def arm_hang(P, side, swing=0.0, bend=0.06, out=0.10):
    """Relaxed arm hanging at the side; swing = forward/back angle (rad) of the upper arm."""
    sx = sx_of(side)
    d = v3(sx * out, -math.sin(swing), -math.cos(swing)).normalized()
    P.aim('UpperArm_' + side, d)
    fd = v3(sx * out * 0.6, -math.sin(swing) - bend - max(0, -swing) * 0.6, -math.cos(swing)).normalized()
    P.aim('Forearm_' + side, fd)
    P.orient('Hand_' + side, fd + v3(0, -0.04, 0), v3(-sx, 0, 0))


def rest_hands_table(P, t, lh=(0.14, -0.50), rh=(-0.14, -0.50), z=0.745):
    arm_to(P, 'L', v3(lh[0], lh[1], z), palm='down', fwd=v3(0, -1, -0.1))
    arm_to(P, 'R', v3(rh[0], rh[1], z), palm='down', fwd=v3(0, -1, -0.1))


# ---- shared helpers for clips ---------------------------------------------------------------


def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def env(u, a, b, c, d):
    """Trapezoid envelope: 0 before a, ramps to 1 by b, holds to c, back to 0 by d."""
    if u <= a or u >= d:
        return 0.0
    if u < b:
        return ease((u - a) / (b - a))
    if u <= c:
        return 1.0
    return ease((d - u) / (d - c))


def lerp3(a, b, t):
    return a + (b - a) * t


def stand_base(P, u, T=4.0, stance=0.0, bob=0.0, sway=1.0, lean=0.0):
    """Relaxed standing: feet flat, slight weight shift, breathing."""
    phi = TAU * u
    shift = math.sin(phi) * 0.008 * sway
    P.root = v3(shift, 0.0, -0.010 - 0.002 * math.sin(phi * 2) + bob)
    P.rel_euler('Hips', y=-1.5 * math.sin(phi) * sway, z=1.2 * math.sin(phi) * sway)
    for side in ('L', 'R'):
        sx = sx_of(side)
        foot = v3(sx * (0.100 + stance), 0.0, 0.078)
        P.ik('Thigh_' + side, 'Shin_' + side, foot, v3(sx * 0.1, -1, 0))
        P.D['Foot_' + side] = Quaternion(Z, math.radians(sx * 6))
    P.rel_euler('Spine', x=lean * 0.5 + 0.4 * math.sin(phi * 2), y=1.0 * math.sin(phi) * sway)
    P.rel_euler('Chest', x=lean * 0.5 + 0.8 * math.sin(phi * 2), y=-0.8 * math.sin(phi) * sway)


def finish_stand_arms(P):
    for side in ('L', 'R'):
        arm_hang(P, side)


def idle_stand(P, u):
    stand_base(P, u)
    phi = TAU * u
    head_pose(P, pitch=-1.0 * math.sin(phi * 2), yaw=2.0 * math.sin(phi), roll=1.0 * math.sin(phi))
    P.rel_euler('Shoulder_L')
    P.rel_euler('Shoulder_R')
    for side in ('L', 'R'):
        arm_hang(P, side, swing=0.03 * math.sin(phi * 2), bend=0.08)


def foot_path(p, S, lift=0.085):
    """Foot position (y, z, toe angle deg) for gait phase p in [0,1)."""
    z0 = 0.078
    if p < 0.6:
        s = p / 0.6
        y = lerp(-S, S, s)
        heel = smoothstep(0.78, 1.0, s)
        toe = lerp(-9.0, 0.0, smoothstep(0.0, 0.25, s)) + 28.0 * heel
        z = z0 + 0.032 * heel
    else:
        s = (p - 0.6) / 0.4
        y = lerp(S, -S, ease(s))
        z = z0 + 0.030 * (1 - s) + lift * math.sin(math.pi * min(1.0, s * 1.05)) ** 0.9
        toe = lerp(28.0, -9.0, ease(s * 1.2))
    return y, z, toe


def walk(P, u):
    phi = TAU * u
    S = 0.37
    P.root = v3(0.014 * math.cos(TAU * (u - 0.3)), 0.0, -0.030 + 0.018 * math.cos(TAU * 2 * (u - 0.3)))
    P.rel_euler('Hips', x=1.0, y=2.0 * math.cos(TAU * (u - 0.3)), z=-5.0 * math.cos(phi))
    for side, off in (('L', 0.0), ('R', 0.5)):
        sx = sx_of(side)
        y, z, toe = foot_path((u + off) % 1.0, S)
        P.ik('Thigh_' + side, 'Shin_' + side, v3(sx * 0.092, y, z), v3(sx * 0.12, -1, 0))
        P.D['Foot_' + side] = Quaternion(X, math.radians(toe)) @ Quaternion(Z, math.radians(sx * 5))
    P.rel_euler('Spine', x=3.0, y=-1.5 * math.cos(TAU * (u - 0.3)), z=5.0 * math.cos(phi))
    P.rel_euler('Chest', x=2.0, z=3.0 * math.cos(phi))
    head_pose(P, pitch=-2.0, yaw=-6.0 * math.cos(phi) * 0.5, roll=1.0 * math.cos(TAU * (u - 0.3)))
    for side, sgn in (('L', -1), ('R', 1)):
        arm_hang(P, side, swing=sgn * 0.38 * math.cos(phi), bend=0.12 + 0.18 * max(0, sgn * math.cos(phi)), out=0.07)


def seated_arms_table(P, t=0.0, y=-0.31, x=0.10, z=0.757):
    # forearms lie on the tabletop, elbows hang down just behind the table edge
    arm_to(P, 'L', v3(x, y, z), palm='down', fwd=v3(-0.35, -1, -0.02), pole=v3(0.4, 0.9, -1.0))
    arm_to(P, 'R', v3(-x, y, z), palm='down', fwd=v3(0.35, -1, -0.02), pole=v3(-0.4, 0.9, -1.0))


def sit_idle(P, u):
    phi = TAU * u
    seat_base(P, lean=7.0 + 1.0 * math.sin(phi), twist=1.5 * math.sin(phi + 1.0), u=u)
    breathe(P, u, 1.0, 1 / 2.0)
    head_pose(P, pitch=2.0 + 1.5 * math.sin(phi * 2), yaw=0.0, roll=1.2 * math.sin(phi))
    seated_arms_table(P)


def sit_write(P, u):
    phi = TAU * u
    seat_base(P, lean=19.0 + 1.0 * math.sin(phi), twist=-4.0 + 1.5 * math.sin(phi * 2), u=u)
    head_pose(P, pitch=28.0 + 2.0 * math.sin(phi), yaw=0.0, roll=-3.0)
    wob = TAU * u * 3
    rx = -0.10 + 0.03 * math.sin(wob) + 0.02 * math.sin(phi)
    ry = -0.38 + 0.025 * math.sin(wob * 1.3 + 1.0) - 0.03 * math.sin(phi)
    arm_to(P, 'R', v3(rx, ry, 0.762), palm='down', fwd=v3(0.25, -1, -0.3), pole=v3(-0.4, 0.9, -1.0))
    arm_to(P, 'L', v3(0.15, -0.36, 0.757), palm='down', fwd=v3(-0.25, -1, -0.02), pole=v3(0.4, 0.9, -1.0))


def sit_type(P, u):
    phi = TAU * u
    seat_base(P, lean=11.0, twist=0.0, u=u)
    breathe(P, u, 1.0, 1.0)
    head_pose(P, pitch=14.0 + 1.5 * math.sin(phi), yaw=0.0, roll=0)
    for side in ('L', 'R'):
        sx = sx_of(side)
        k = math.sin(phi * 3 + (0 if side == 'L' else 1.7))
        arm_to(
            P,
            side,
            v3(sx * 0.085 + 0.01 * k, -0.40 + 0.014 * k, 0.776 + 0.005 * max(0, k)),
            palm='down',
            fwd=v3(-sx * 0.05, -1, -0.25),
            pole=v3(sx * 0.4, 0.9, -1.0),
        )


def sit_phone(P, u):
    phi = TAU * u
    seat_base(P, lean=20.0 + 1.5 * math.sin(phi), twist=-2.0, u=u)
    breathe(P, u, 1.0, 1.0)
    head_pose(P, pitch=38.0 + 2.0 * math.sin(phi * 2), yaw=0.0, roll=-3.0)
    P.rel_euler('Shoulder_L', y=-4.0)
    P.rel_euler('Shoulder_R', y=4.0)
    th = 0.004 * math.sin(phi * 4)
    arm_to(P, 'R', v3(-0.065, -0.265 + th, 0.700), palm=v3(0.35, 0.15, 0.9), fwd=v3(0.45, -0.85, 0.25), pole=v3(-0.4, 0.5, -1.0))
    arm_to(P, 'L', v3(0.065, -0.265, 0.695), palm=v3(-0.35, 0.15, 0.9), fwd=v3(-0.45, -0.85, 0.25), pole=v3(0.4, 0.5, -1.0))


def mouth_point(P, off=(0, -0.0, -0.075)):
    return P.point('Head', (off[0], -0.12 + off[1], 1.52 + off[2]))


def sit_yawn(P, u):
    phi = TAU * u
    e = env(u, 0.0, 0.25, 0.78, 1.0)
    seat_base(P, lean=lerp(7.0, 1.0, e), twist=0.0)
    breathe(P, u, 0.5, 1.0)
    P.rel_euler('Chest', x=-5.0 * e)
    head_pose(P, pitch=lerp(2.0, -22.0, e) + 1.5 * math.sin(phi * 6) * e, yaw=0.0, roll=-3.0 * e)
    # right hand rises to the mouth
    hold = mouth_point(P, (-0.02, 0.0, -0.065))
    rest = v3(-0.10, -0.31, 0.757)
    tgt = lerp3(rest, hold, e)
    arm_to(P, 'R', tgt, palm=lerp3(v3(0, 0, -1), v3(0.2, 0.9, 0.2), e), fwd=lerp3(v3(0.05, -1, -0.08), v3(0.25, -0.25, 1.0), e), pole=v3(-0.4, 0.9, -1.0))
    arm_to(P, 'L', v3(0.10, -0.31, 0.757), palm='down', fwd=v3(-0.05, -1, -0.08), pole=v3(0.8, 0.5, -0.4))


def sit_cough(P, u):
    phi = TAU * u
    e = env(u, 0.0, 0.12, 0.85, 1.0)
    bumps = max(0.0, math.sin(TAU * u * 3.0 + 0.4)) ** 2 * e
    seat_base(P, lean=lerp(7.0, 18.0, e) + 6.0 * bumps, twist=0.0)
    head_pose(P, pitch=lerp(2.0, 20.0, e) + 8.0 * bumps, yaw=0.0, roll=0.0)
    hold = mouth_point(P, (-0.01, 0.0, -0.05))
    rest = v3(-0.10, -0.31, 0.757)
    tgt = lerp3(rest, hold, e)
    arm_to(P, 'R', tgt, palm=lerp3(v3(0, 0, -1), v3(0.2, 0.9, 0.3), e), fwd=lerp3(v3(0.05, -1, -0.08), v3(0.2, -0.2, 1.0), e), pole=v3(-0.4, 0.9, -1.0))
    arm_to(P, 'L', v3(0.10, -0.31, 0.757), palm='down', fwd=v3(-0.05, -1, -0.08), pole=v3(0.8, 0.5, -0.4))


def sit_look(P, u):
    phi = TAU * u
    seat_base(P, lean=6.0, twist=10.0 * math.sin(phi), tilt=-3.0 * math.sin(phi))
    breathe(P, u, 1.0, 0.5)
    head_pose(P, pitch=0.0, yaw=0.0, roll=3.0 * math.sin(phi))
    seated_arms_table(P)


def raise_arm(P, side, sx, e, sway):
    P.rel_euler('Shoulder_' + side, y=sx * -10.0 * e)
    rest = v3(sx * 0.15, -0.33, 0.757)
    up = v3(sx * 0.17 + 0.02 * sway, -0.06, 1.50 + 0.012 * sway)
    arm_to(P, side, lerp3(rest, up, e), palm=lerp3(v3(0, 0, -1), v3(0, -1, 0), e), fwd=lerp3(v3(0, -1, -0.08), v3(0.05 * sway, -0.12, 1), e), pole=v3(sx * 0.8, 0.9, -0.1))


def sit_raise(P, u):
    phi = TAU * u
    seat_base(P, lean=3.0, twist=2.0)
    breathe(P, u, 1.0, 1.0)
    head_pose(P, pitch=-2.0, yaw=0, roll=2.0 * math.sin(phi))
    raise_arm(P, 'R', -1, 1.0, math.sin(phi * 2))
    arm_to(P, 'L', v3(0.10, -0.31, 0.757), palm='down', fwd=v3(-0.05, -1, -0.08), pole=v3(0.4, 0.9, -1.0))


def sit_whisper(P, u, side):
    phi = TAU * u
    sx = sx_of(side)
    e = env(u, 0.0, 0.2, 0.85, 1.0) * 0.0 + 1.0
    seat_base(P, lean=10.0, twist=sx * 8.0, tilt=sx * 13.0)
    breathe(P, u, 1.0, 1.0)
    head_pose(P, pitch=2.0, yaw=0.0, roll=sx * 9.0 + 2.0 * math.sin(phi * 2))
    # cupped hand beside the mouth on the side we lean towards
    hs = 'L' if sx > 0 else 'R'
    ho = 'R' if sx > 0 else 'L'
    mp = mouth_point(P, (sx * 0.075, 0.015, -0.035))
    arm_to(P, hs, mp + v3(0, 0, 0.0), palm=v3(-sx * 0.4, 0.9, 0.2), fwd=v3(-sx * 0.35, -0.55, 0.9), pole=v3(sx * 0.8, 0.9, -0.2))
    arm_to(P, ho, v3(-sx * 0.17, -0.36, 0.745), palm='down', fwd=v3(sx * 0.05, -1, -0.02), pole=v3(-sx * 0.4, 0.9, -1.0))


def sit_stretch(P, u):
    phi = TAU * u
    e = env(u, 0.05, 0.35, 0.72, 0.97)
    seat_base(P, lean=lerp(7.0, -8.0, e), twist=0.0)
    breathe(P, u, 0.4, 1.0)
    head_pose(P, pitch=lerp(2.0, -14.0, e), yaw=0, roll=2.0 * math.sin(phi * 2) * e)
    for side in ('L', 'R'):
        sx = sx_of(side)
        P.rel_euler('Shoulder_' + side, y=sx * -12.0 * e)
        rest = v3(sx * 0.15, -0.33, 0.757)
        up = v3(sx * 0.15, 0.06 + 0.01 * math.sin(phi * 3), 1.62)
        arm_to(P, side, lerp3(rest, up, e), palm=lerp3(v3(0, 0, -1), v3(-sx, 0, 0.3), e), fwd=lerp3(v3(0, -1, -0.08), v3(-sx * 0.2, 0.1, 1.0), e), pole=v3(sx * 0.8, 0.3, 0.0))


def throw_arm(P, e_wind, e_rel, follow, seated):
    """Right-handed overhand/underhand-ish toss. Returns nothing; sets the right arm."""
    base = v3(-0.30, -0.02, 1.38 if not seated else 1.00)
    back = base + v3(-0.06, 0.34, 0.20)
    front = base + v3(0.06, -0.60, 0.10)
    rest = v3(-0.20, -0.30, 0.74) if seated else v3(-0.24, -0.02, 0.80)
    if e_wind < 1:
        tgt = lerp3(rest, back, e_wind)
    else:
        tgt = lerp3(back, front, e_rel)
    if follow > 0:
        tgt = lerp3(tgt, v3(0.05, -0.50, 0.55 if seated else 0.95), follow)
    arm_to(P, 'R', tgt, palm='in', fwd=(front - back).normalized() if e_rel > 0.01 else v3(0, -0.4, -0.9), pole=v3(-1, 0.4, 0.4))


def stand_throw(P, u, seated=False):
    # 0..0.35 wind-up, 0.35..0.5 release, 0.5..1 follow-through and recover
    if u < 0.35:
        ew, er, fo = ease(u / 0.35), 0.0, 0.0
    elif u < 0.5:
        ew, er, fo = 1.0, ease((u - 0.35) / 0.15), 0.0
    else:
        ew, er, fo = 1.0, 1.0, 0.0
    rec = ease((u - 0.62) / 0.38) if u > 0.62 else 0.0
    twist = lerp(0.0, 1.0, ease(u / 0.35)) if u < 0.35 else (1 - ease((u - 0.35) / 0.2)) if u < 0.55 else 0.0
    if seated:
        seat_base(P, lean=lerp(7.0, 3.0, ease(u / 0.35)) if u < 0.4 else 12.0, twist=-14.0 * twist + 12.0 * (ease((u - 0.35) / 0.2) if 0.35 <= u < 0.6 else 0))
    else:
        stand_base(P, 0.0, stance=0.03)
        P.rel_euler('Spine', x=6.0 * er * (1 - rec), z=-16.0 * twist + 14.0 * er * (1 - rec))
        P.rel_euler('Chest', x=4.0 * er * (1 - rec), z=-10.0 * twist + 12.0 * er * (1 - rec))
    head_pose(P, pitch=-3.0, yaw=0, roll=0)
    if rec > 0:
        # blend the arm back to the resting pose
        if seated:
            rest = v3(-0.10, -0.31, 0.757)
        else:
            rest = None
        throw_arm(P, 1.0, 1.0, 0.0, seated) if rec < 1 else None
    throw_arm(P, ew, er, ease((u - 0.5) / 0.12) if u > 0.5 else 0.0, seated)
    if seated:
        arm_to(P, 'L', v3(0.10, -0.31, 0.757), palm='down', fwd=v3(-0.05, -1, -0.08), pole=v3(0.4, 0.9, -1.0))
    else:
        arm_hang(P, 'L', bend=0.1)


def seated_throw(P, u):
    stand_throw(P, u, True)


def point_pose(P, u):
    phi = TAU * u
    stand_base(P, u, stance=0.02, sway=0.6)
    P.rel_euler('Spine', z=-6.0)
    P.rel_euler('Chest', z=-6.0 + 2.0 * math.sin(phi))
    head_pose(P, pitch=-3.0, yaw=0.0, roll=0.0)
    P.rel_euler('Shoulder_R', y=6.0)
    tgt = v3(-0.17 + 0.015 * math.sin(phi * 2), -0.50, 1.43 + 0.02 * math.sin(phi))
    arm_to(P, 'R', tgt, palm=v3(-0.3, 0.0, -1.0), fwd=(v3(-0.14, -1.0, 0.18)), pole=v3(-0.8, 0.5, -0.6))
    arm_hang(P, 'L', bend=0.14, out=0.12)


def write_board(P, u):
    phi = TAU * u
    stand_base(P, u, stance=0.02, sway=0.4, lean=3.0)
    P.rel_euler('Chest', x=2.0)
    head_pose(P, pitch=-4.0, yaw=0.0, roll=1.0)
    w = TAU * u * 2.0
    tgt = v3(-0.115 + 0.060 * math.sin(w) * (0.6 + 0.4 * math.sin(phi)), -0.50, 1.43 + 0.028 * math.sin(w * 2.0 + 0.8) - 0.03 * math.sin(phi))
    P.rel_euler('Shoulder_R', y=5.0)
    arm_to(P, 'R', tgt, palm=v3(0.0, 0.1, -1.0), fwd=v3(-0.05, -1.0, 0.22), pole=v3(-0.8, 0.5, -0.7))
    # left hand on hip
    arm_to(P, 'L', v3(0.28, -0.03, 0.96), palm='in', fwd=v3(-0.2, -0.3, -0.8), pole=v3(1, 0.4, 0))


def hands_on_hips(P, u):
    phi = TAU * u
    stand_base(P, u, stance=0.045, sway=0.8)
    P.rel_euler('Chest', x=-2.5 - 0.6 * math.sin(phi * 2))
    head_pose(P, pitch=-1.0, yaw=0.0, roll=2.0 * math.sin(phi * 0.5))
    for side in ('L', 'R'):
        sx = sx_of(side)
        arm_to(P, side, v3(sx * 0.255, -0.03, 0.965), palm='in', fwd=v3(-sx * 0.25, -0.45, -0.8), pole=v3(sx * 1.0, 0.6, 0.0))


def stand_type(P, u):
    phi = TAU * u
    stand_base(P, u, stance=0.01, sway=0.3, lean=7.0)
    head_pose(P, pitch=22.0, yaw=0.0, roll=0.0)
    for side in ('L', 'R'):
        sx = sx_of(side)
        k = math.sin(phi * 4 + (0 if side == 'L' else 1.9))
        arm_to(P, side, v3(sx * 0.10 + 0.008 * k, -0.40 + 0.01 * k, 1.085 + 0.006 * max(0, k)), palm='down', fwd=v3(-sx * 0.05, -1, -0.3), pole=v3(sx * 0.8, 0.5, -0.4))


def talk(P, u):
    phi = TAU * u
    stand_base(P, u, stance=0.025, sway=0.8)
    head_pose(P, pitch=0.0 + 1.5 * math.sin(phi * 2), yaw=2.5 * math.sin(phi), roll=2.0 * math.sin(phi * 2 + 1))
    g = 0.5 + 0.5 * math.sin(phi * 2)
    tgt = v3(-0.22 - 0.05 * g, -0.30 - 0.08 * g, 1.10 + 0.10 * math.sin(phi * 2 + 0.5))
    arm_to(P, 'R', tgt, palm=v3(0.4, 0.0, 0.9), fwd=v3(0.15, -1, 0.05), pole=v3(-0.9, 0.4, -0.5))
    k = 0.5 + 0.5 * math.sin(phi + 2.2)
    tl = v3(0.24 + 0.03 * k, -0.22 - 0.08 * k, 1.02 + 0.07 * k)
    arm_to(P, 'L', tl, palm=v3(-0.3, 0.0, 0.9), fwd=v3(-0.1, -1, 0.0), pole=v3(0.9, 0.4, -0.5))


def stand_raise(P, u):
    phi = TAU * u
    stand_base(P, u, stance=0.01, sway=0.5)
    head_pose(P, pitch=-2.0, yaw=0.0, roll=2.0 * math.sin(phi))
    P.rel_euler('Shoulder_R', y=10.0)
    tgt = v3(-0.20 + 0.02 * math.sin(phi * 2), -0.05, 1.86 + 0.01 * math.sin(phi))
    arm_to(P, 'R', tgt, palm=v3(0, -1, 0), fwd=v3(0.03 * math.sin(phi * 2), -0.1, 1), pole=v3(-0.8, 0.9, -0.1))
    arm_hang(P, 'L', bend=0.08)



# ---- reaction / action clips (hit reactions, laughs, drumming, napping, ...) -------------------


def teacher_flinch(P, u):
    """Hit from behind: the body jerks forward, the head snaps, shoulders hunch, then recover."""
    e = env(u, 0.0, 0.18, 0.42, 1.0)
    stand_base(P, 0.0, stance=0.03, sway=0.2)
    P.rel_euler('Spine', x=9.0 * e)
    P.rel_euler('Chest', x=7.0 * e, z=-5.0 * e)
    head_pose(P, pitch=14.0 * e, yaw=-10.0 * e, roll=5.0 * e)
    P.rel_euler('Shoulder_L', y=6.0 * e)
    P.rel_euler('Shoulder_R', y=-6.0 * e)
    for side in ('L', 'R'):
        arm_hang(P, side, swing=0.30 * e, bend=0.08 + 0.3 * e, out=0.10 + 0.08 * e)


def teacher_rub_head(P, u):
    phi = TAU * u
    stand_base(P, u, stance=0.03, sway=0.3)
    P.rel_euler('Chest', x=3.0)
    head_pose(P, pitch=6.0, yaw=0.0, roll=-4.0 + 1.5 * math.sin(phi * 4))
    P.rel_euler('Shoulder_R', y=-8.0)
    tgt = v3(-0.07 + 0.02 * math.sin(phi * 4), 0.13, 1.55)
    arm_to(P, 'R', tgt, palm=v3(0, -1, 0.1), fwd=v3(0.2, -0.3, 1.0), pole=v3(-1.0, 0.4, 0.3))
    arm_hang(P, 'L', bend=0.12)


def teacher_angry(P, u):
    """Furious: fists on hips, chest out, a little head shake, restless shifting."""
    phi = TAU * u
    stand_base(P, u, stance=0.06, sway=1.2)
    P.rel_euler('Chest', x=-4.0 - 1.0 * math.sin(phi * 3), z=3.0 * math.sin(phi))
    head_pose(P, pitch=4.0, yaw=5.0 * math.sin(phi * 2), roll=3.0 * math.sin(phi * 3))
    for side in ('L', 'R'):
        sx = sx_of(side)
        arm_to(P, side, v3(sx * 0.27, -0.03, 0.97), palm='in', fwd=v3(-sx * 0.25, -0.45, -0.8), pole=v3(sx * 1.0, 0.6, 0.0))


def teacher_accuse(P, u):
    """Arm out, finger jabbing: 'Was it you?'"""
    phi = TAU * u
    stand_base(P, u, stance=0.04, sway=0.5, lean=4.0)
    P.rel_euler('Chest', x=3.0, z=-6.0)
    head_pose(P, pitch=4.0, yaw=0.0, roll=2.0)
    P.rel_euler('Shoulder_R', y=6.0)
    jab = max(0.0, math.sin(phi * 2.0)) ** 2
    tgt = v3(-0.20, -0.52 - 0.12 * jab, 1.36 + 0.03 * math.sin(phi * 2.0))
    arm_to(P, 'R', tgt, palm=v3(-0.3, 0.0, -1.0), fwd=v3(-0.12, -1.0, 0.05), pole=v3(-0.8, 0.5, -0.6))
    arm_to(P, 'L', v3(0.27, -0.03, 0.97), palm='in', fwd=v3(-0.25, -0.45, -0.8), pole=v3(1.0, 0.6, 0.0))


def sit_laugh(P, u):
    phi = TAU * u
    k = math.sin(phi * 7.0)
    seat_base(P, lean=lerp(7.0, -2.0, 0.8) + 2.0 * k, twist=0.0, u=u)
    P.rel_euler('Chest', x=-4.0 + 3.0 * k)
    head_pose(P, pitch=-12.0 + 4.0 * k, yaw=0.0, roll=4.0 * math.sin(phi))
    hold = mouth_point(P, (-0.01, 0.0, -0.06))
    arm_to(P, 'R', hold, palm=v3(0.2, 0.9, 0.3), fwd=v3(0.2, -0.2, 1.0), pole=v3(-0.4, 0.9, -1.0))
    arm_to(P, 'L', v3(0.12, -0.28 + 0.01 * k, 0.757), palm='down', fwd=v3(-0.05, -1, -0.08), pole=v3(0.8, 0.5, -0.4))


def sit_gasp(P, u):
    e = env(u, 0.0, 0.15, 0.8, 1.0)
    seat_base(P, lean=lerp(7.0, -6.0, e), twist=0.0, u=u)
    head_pose(P, pitch=lerp(2.0, -8.0, e), yaw=0.0, roll=0.0)
    for side in ('L', 'R'):
        sx = sx_of(side)
        rest = v3(sx * 0.12, -0.31, 0.757)
        hold = mouth_point(P, (sx * 0.03, 0.0, -0.07))
        arm_to(P, side, lerp3(rest, hold, e), palm=lerp3(v3(0, 0, -1), v3(-sx * 0.3, 0.9, 0.2), e), fwd=lerp3(v3(0, -1, -0.08), v3(-sx * 0.15, -0.2, 1.0), e), pole=v3(sx * 0.4, 0.9, -1.0))


def sit_glare(P, u):
    phi = TAU * u
    seat_base(P, lean=0.0, twist=1.5 * math.sin(phi), u=u)
    breathe(P, u, 1.0, 1.0)
    head_pose(P, pitch=-2.0, yaw=0.0, roll=-4.0 + 1.0 * math.sin(phi * 2))
    arm_to(P, 'L', mouth_point(P, (-0.13, -0.02, -0.30)), palm='down', fwd=v3(-1.0, -0.2, 0.0), pole=v3(0.8, 0.8, -0.3))
    arm_to(P, 'R', mouth_point(P, (0.13, 0.0, -0.33)), palm='down', fwd=v3(1.0, -0.2, 0.0), pole=v3(-0.8, 0.8, -0.3))


def sit_point(P, u):
    phi = TAU * u
    e = env(u, 0.0, 0.2, 0.95, 1.0) if False else 1.0
    seat_base(P, lean=6.0, twist=-4.0, u=u)
    breathe(P, u, 1.0, 1.0)
    head_pose(P, pitch=-1.0, yaw=0.0, roll=1.0)
    P.rel_euler('Shoulder_R', y=-6.0)
    tgt = v3(-0.22, -0.60 - 0.03 * max(0.0, math.sin(phi * 2.0)), 1.20)
    arm_to(P, 'R', tgt, palm=v3(-0.3, 0.0, -1.0), fwd=v3(-0.1, -1.0, 0.1), pole=v3(-0.9, 0.5, -0.3))
    arm_to(P, 'L', v3(0.10, -0.31, 0.757), palm='down', fwd=v3(-0.05, -1, -0.08), pole=v3(0.4, 0.9, -1.0))


def sit_drum(P, u):
    phi = TAU * u
    seat_base(P, lean=12.0, twist=0.0, u=u)
    head_pose(P, pitch=10.0 + 3.0 * math.sin(phi * 4), yaw=0.0, roll=3.0 * math.sin(phi * 2))
    for side, off in (('L', 0.0), ('R', 0.5)):
        sx = sx_of(side)
        k = max(0.0, math.sin(TAU * (u * 2.0 + off))) ** 2
        arm_to(P, side, v3(sx * 0.13, -0.36, 0.757 + 0.07 * k), palm='down', fwd=v3(-sx * 0.1, -1, -0.2), pole=v3(sx * 0.4, 0.9, -1.0))


def sit_hum(P, u):
    phi = TAU * u
    seat_base(P, lean=6.0, twist=6.0 * math.sin(phi), tilt=3.0 * math.sin(phi), u=u)
    breathe(P, u, 1.0, 1.0)
    head_pose(P, pitch=-2.0 + 2.0 * math.sin(phi * 2), yaw=3.0 * math.sin(phi), roll=7.0 * math.sin(phi))
    seated_arms_table(P)


def sit_sleep(P, u):
    phi = TAU * u
    seat_base(P, lean=48.0 + 1.0 * math.sin(phi), twist=0.0, u=u)
    breathe(P, u, 1.5, 1.0)
    head_pose(P, pitch=30.0, yaw=0.0, roll=-8.0)
    for side in ('L', 'R'):
        sx = sx_of(side)
        arm_to(P, side, v3(sx * 0.10, -0.42, 0.765), palm='down', fwd=v3(-sx * 0.5, -1, -0.02), pole=v3(sx * 0.4, 0.9, -1.0))


def sit_lean_back(P, u):
    phi = TAU * u
    seat_base(P, lean=-16.0 + 1.5 * math.sin(phi * 2), twist=0.0, u=u)
    head_pose(P, pitch=-4.0, yaw=0.0, roll=2.0 * math.sin(phi))
    for side in ('L', 'R'):
        sx = sx_of(side)
        arm_to(P, side, mouth_point(P, (sx * 0.09, 0.17, 0.0)), palm=v3(-sx * 0.3, -0.8, 0.0), fwd=v3(-sx * 0.2, 0.6, 0.6), pole=v3(sx * 1.0, 0.2, 0.2))


CLIPS = [
    # name, duration s, loop, builder
    ('idle_stand', 4.0, True, idle_stand),
    ('walk', 1.1, True, walk),
    ('talk', 3.2, True, talk),
    ('sit_idle', 5.0, True, sit_idle),
    ('sit_write', 2.4, True, sit_write),
    ('sit_type', 2.0, True, sit_type),
    ('sit_phone', 3.0, True, sit_phone),
    ('yawn', 2.6, False, sit_yawn),
    ('cough', 1.3, False, sit_cough),
    ('look_around', 4.0, True, sit_look),
    ('raise_hand_sit', 3.0, True, sit_raise),
    ('raise_hand_stand', 3.0, True, stand_raise),
    ('whisper_L', 3.0, True, lambda P, u: sit_whisper(P, u, 'L')),
    ('whisper_R', 3.0, True, lambda P, u: sit_whisper(P, u, 'R')),
    ('throw', 1.2, False, stand_throw),
    ('sit_throw', 1.2, False, seated_throw),
    ('stretch', 3.2, False, sit_stretch),
    ('teacher_point', 3.0, True, point_pose),
    ('teacher_write_board', 3.0, True, write_board),
    ('teacher_hands_on_hips', 4.0, True, hands_on_hips),
    ('teacher_type', 2.0, True, stand_type),
    ('teacher_flinch', 1.1, False, teacher_flinch),
    ('teacher_rub_head', 1.8, True, teacher_rub_head),
    ('teacher_angry', 3.0, True, teacher_angry),
    ('teacher_accuse', 2.4, True, teacher_accuse),
    ('sit_laugh', 1.6, True, sit_laugh),
    ('sit_gasp', 1.3, False, sit_gasp),
    ('sit_glare', 3.0, True, sit_glare),
    ('sit_point', 2.0, True, sit_point),
    ('sit_drum', 1.0, True, sit_drum),
    ('sit_hum', 2.4, True, sit_hum),
    ('sit_sleep', 4.0, True, sit_sleep),
    ('sit_lean_back', 3.0, True, sit_lean_back),
]


def key_clip(arm_obj, rest, name, dur, loop, fn):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm_obj.animation_data_create()
    arm_obj.animation_data.action = act
    n = int(round(dur * FPS))
    last = {}
    frames = n if loop else n + 1
    for f in range(frames):
        u = f / n
        P = Pose(rest)
        fn(P, u)
        for b in BONE_ORDER:
            pb = arm_obj.pose.bones[b]
            pb.rotation_mode = 'QUATERNION'
            q = P.local(b)
            if b in last and last[b].dot(q) < 0:
                q.negate()
            last[b] = q
            pb.rotation_quaternion = q
            pb.keyframe_insert('rotation_quaternion', frame=f + 1)
            if b == 'Hips':
                pb.location = P.local_root_loc()
                pb.keyframe_insert('location', frame=f + 1)
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    act.use_frame_range = True
    act.frame_start = 1
    act.frame_end = frames
    arm_obj.animation_data.action = None
    return act


# --------------------------------------------------------------------------------------------
# Scene build + export


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def build(out_dir=None, keyframe_blender=False):
    """Build everything. Blender objects/armature are created for inspection (--blend) and
    previews; the GLB is written by the pure-Python writer below."""
    reset_scene()
    mats = make_materials()
    arm_obj = make_armature()
    builders = []
    objs = []
    for bid in BODIES:
        builders.append((bid, build_body(bid, mats, arm_obj)))
    for style in HAIR_STYLES:
        builders.append(('hair_' + style, build_hair(style, mats, arm_obj)))
    builders.append(('glasses', build_glasses(mats)))
    builders.append(('laptop', build_laptop(mats)))
    for name, mb in builders:
        objs.append(mb.to_object(name, mats, arm_obj))
    bpy.context.view_layer.update()
    rest = Rest(arm_obj)
    if keyframe_blender:
        for name, dur, loop, fn in CLIPS:
            key_clip(arm_obj, rest, name, dur, loop, fn)
    bpy.context.scene.render.fps = FPS
    stats = {}
    if out_dir:
        stats = write_glb(os.path.join(out_dir, 'characters.glb'), builders, rest, CLIPS)
    return dict(arm=arm_obj, rest=rest, objs=objs, stats=stats, mats=mats, builders=builders)


# ---- minimal glTF 2.0 (GLB) writer: pure Python, no numpy / Blender exporter needed --------------


def _c(v):
    """Blender (Z up, -Y forward) -> glTF (Y up, +Z forward)."""
    return (v[0], v[2], -v[1])


def _cq(q):
    return (q.x, q.z, -q.y, q.w)


class GltfWriter:
    def __init__(self):
        self.bin = bytearray()
        self.views = []
        self.accessors = []

    def _view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        self.views.append({'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data), **({'target': target} if target else {})})
        self.bin += data
        return len(self.views) - 1

    def accessor(self, fmt, ctype, atype, values, target=None, minmax=False, count=None):
        flat = [x for v in values for x in (v if isinstance(v, (tuple, list)) else (v,))]
        data = struct.pack('<%d%s' % (len(flat), fmt), *flat)
        view = self._view(data, target)
        n = count if count is not None else len(values)
        acc = {'bufferView': view, 'componentType': ctype, 'count': n, 'type': atype}
        if minmax:
            ncomp = len(values[0])
            acc['min'] = [min(v[k] for v in values) for k in range(ncomp)]
            acc['max'] = [max(v[k] for v in values) for k in range(ncomp)]
        self.accessors.append(acc)
        return len(self.accessors) - 1


def gltf_primitives(w, mb, mat_index):
    verts, wts, faces = mb.compact()
    n = len(verts)
    acc = [Vector((0, 0, 0)) for _ in range(n)]
    fnorm = []
    for f, sm in zip(faces, mb.fsmooth):
        a, b, c = verts[f[0]], verts[f[1]], verts[f[2]]
        nrm = (b - a).cross(c - a)
        if len(f) == 4:
            nrm = nrm + (verts[f[2]] - verts[f[0]]).cross(verts[f[3]] - verts[f[0]])
        fnorm.append(nrm)
        if sm:
            for i in f:
                acc[i] += nrm
    bone_index = {b: i for i, b in enumerate(BONE_ORDER)}
    prims = {}
    for fi, f in enumerate(faces):
        m = mb.fmat[fi]
        d = prims.setdefault(m, {'pos': [], 'nrm': [], 'jnt': [], 'wgt': [], 'idx': [], 'map': {}})
        loc = []
        for vi in f:
            key = vi if mb.fsmooth[fi] else (vi, fi)
            j = d['map'].get(key)
            if j is None:
                j = len(d['pos'])
                d['map'][key] = j
                nv = acc[vi] if mb.fsmooth[fi] else fnorm[fi]
                nv = nv.normalized() if nv.length > 1e-12 else Vector((0, 0, 1))
                d['pos'].append(_c(verts[vi]))
                d['nrm'].append(_c(nv))
                ws = sorted(wts[vi].items(), key=lambda kv: -kv[1])[:4]
                tot = sum(x for _, x in ws) or 1.0
                ws = [(bone_index[b], x / tot) for b, x in ws]
                while len(ws) < 4:
                    ws.append((0, 0.0))
                d['jnt'].append(tuple(x[0] for x in ws))
                d['wgt'].append(tuple(x[1] for x in ws))
            loc.append(j)
        d['idx'] += [loc[0], loc[1], loc[2]]
        if len(f) == 4:
            d['idx'] += [loc[0], loc[2], loc[3]]
    out = []
    for m in MATERIAL_ORDER:
        d = prims.get(m)
        if not d:
            continue
        out.append(
            {
                'attributes': {
                    'POSITION': w.accessor('f', 5126, 'VEC3', d['pos'], 34962, True),
                    'NORMAL': w.accessor('f', 5126, 'VEC3', d['nrm'], 34962),
                    **(
                        {}
                        if mb.unskinned
                        else {
                            'JOINTS_0': w.accessor('B', 5121, 'VEC4', d['jnt'], 34962),
                            'WEIGHTS_0': w.accessor('f', 5126, 'VEC4', d['wgt'], 34962),
                        }
                    ),
                },
                'indices': w.accessor('I', 5125, 'SCALAR', d['idx'], 34963),
                'material': mat_index[m],
            }
        )
    return out, sum(len(d['idx']) // 3 for d in prims.values())


def write_glb(path, builders, rest, clips):
    """builders: list of (name, MeshBuilder). clips: list of (name, duration, loop, fn)."""
    w = GltfWriter()
    mat_index = {m: i for i, m in enumerate(MATERIAL_ORDER)}
    materials = [
        {
            'name': m,
            'pbrMetallicRoughness': {'baseColorFactor': [*MATERIAL_DEFS[m][0], 1.0], 'metallicFactor': 0.0, 'roughnessFactor': MATERIAL_DEFS[m][1]},
        }
        for m in MATERIAL_ORDER
    ]
    nodes = []
    bone_node = {}
    for b in BONE_ORDER:
        parent, head, tail = RIG[b]
        t = _c(head - RIG[parent][1]) if parent else _c(head)
        bone_node[b] = len(nodes)
        nodes.append({'name': b, 'translation': [round(x, 6) for x in t]})
    for b in BONE_ORDER:
        parent = RIG[b][0]
        if parent:
            nodes[bone_node[parent]].setdefault('children', []).append(bone_node[b])
    ibm = []
    for b in BONE_ORDER:
        h = _c(RIG[b][1])
        ibm.append((1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -h[0], -h[1], -h[2], 1))
    ibm_acc = w.accessor('f', 5126, 'MAT4', ibm)
    skin = {'joints': [bone_node[b] for b in BONE_ORDER], 'inverseBindMatrices': ibm_acc, 'skeleton': bone_node['Hips']}
    meshes = []
    scene_nodes = [bone_node['Hips']]
    stats = {}
    for name, mb in builders:
        prims, tris = gltf_primitives(w, mb, mat_index)
        stats[name] = tris
        meshes.append({'name': name, 'primitives': prims})
        nodes.append({'name': name, 'mesh': len(meshes) - 1, **({} if mb.unskinned else {'skin': 0})})
        scene_nodes.append(len(nodes) - 1)
    animations = []
    for cname, dur, loop, fn in clips:
        n = int(round(dur * FPS))
        step = 1 if cname in ('walk', 'cough', 'throw', 'sit_throw') else 2
        n -= n % step
        frames = (n if loop else n + 1)
        fl = list(range(0, frames, step)) if loop else list(range(0, n + 1, step))
        times = [f / FPS for f in fl]
        tq = {b: [] for b in BONE_ORDER}
        hips_t = []
        for f in fl:
            P = Pose(rest)
            fn(P, f / n)
            for b in BONE_ORDER:
                q = P.node_q(b)
                if tq[b] and sum(a * c for a, c in zip(tq[b][-1], _cq(q))) < 0:
                    q = Quaternion((-q.w, -q.x, -q.y, -q.z))
                tq[b].append(_cq(q))
            hips_t.append(_c(RIG['Hips'][1] + P.root))
        t_acc = w.accessor('f', 5126, 'SCALAR', times, None, False)
        w.accessors[t_acc]['min'] = [times[0]]
        w.accessors[t_acc]['max'] = [times[-1]]
        samplers, channels = [], []
        for b in BONE_ORDER:
            if all(abs(q[3]) > 0.99999 for q in tq[b]):
                continue  # never moves in this clip
            o = w.accessor('f', 5126, 'VEC4', tq[b])
            samplers.append({'input': t_acc, 'output': o, 'interpolation': 'LINEAR'})
            channels.append({'sampler': len(samplers) - 1, 'target': {'node': bone_node[b], 'path': 'rotation'}})
        # hips translation is stored absolute (rest head + offset), in the Hips node's parent space
        o = w.accessor('f', 5126, 'VEC3', hips_t)
        samplers.append({'input': t_acc, 'output': o, 'interpolation': 'LINEAR'})
        channels.append({'sampler': len(samplers) - 1, 'target': {'node': bone_node['Hips'], 'path': 'translation'}})
        animations.append({'name': cname, 'samplers': samplers, 'channels': channels})
    gltf = {
        'asset': {'version': '2.0', 'generator': 'modulo characters.py'},
        'scene': 0,
        'scenes': [{'nodes': scene_nodes}],
        'nodes': nodes,
        'meshes': meshes,
        'skins': [skin],
        'materials': materials,
        'animations': animations,
        'accessors': w.accessors,
        'bufferViews': w.views,
        'buffers': [{'byteLength': len(w.bin)}],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    binb = bytes(w.bin) + b'\0' * (-len(w.bin) % 4)
    total = 12 + 8 + len(js) + 8 + len(binb)
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'wb') as fh:
        fh.write(struct.pack('<III', 0x46546C67, 2, total))
        fh.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        fh.write(struct.pack('<II', len(binb), 0x004E4942) + binb)
    print('wrote', path, total, 'bytes')
    return stats


def main():
    argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
    out = 'public/models/characters'
    if '--out' in argv:
        out = argv[argv.index('--out') + 1]
    state = build(out, keyframe_blender='--blend' in argv)
    for k, v in state['stats'].items():
        print(f'{k:22s} {v:6d} tris')
    if '--blend' in argv:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'characters.blend'))


if __name__ == '__main__':
    main()
