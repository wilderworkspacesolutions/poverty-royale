"""
Builds a rigged goblin patron and exports it as a .glb with four actions:
idle, walk, shoot, die.

Run headless (no Blender UI needed):

    blender -b --factory-startup -P blender/make_avatar.py -- assets/avatar.glb

Units are metres. The figure faces -Y in Blender, which glTF exports as +Z.
Three.js models face -Z, so the game turns the loaded model by PI around Y.

Materials are named "Suit", "Skin" and "Metal". The game tints "Suit" per
goblin archetype and per cash level, so keep that name.
"""
import sys

import bmesh
import bpy

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGV[0] if ARGV else "avatar.glb"

# name: (head, tail, parent)
BONES = {
    "root": ((0, 0, 0), (0, 0, 0.05), None),
    "hips": ((0, 0, 0.8), (0, 0, 0.95), "root"),
    "spine": ((0, 0, 0.95), (0, 0, 1.3), "hips"),
    "head": ((0, 0, 1.3), (0, 0, 1.7), "spine"),
    "arm.L": ((0.3, 0, 1.25), (0.3, 0, 0.75), "spine"),
    "arm.R": ((-0.3, 0, 1.25), (-0.3, 0, 0.75), "spine"),
    "leg.L": ((0.14, 0, 0.8), (0.14, 0, 0.0), "hips"),
    "leg.R": ((-0.14, 0, 0.8), (-0.14, 0, 0.0), "hips"),
}

# (bone, centre, size, material)
# Goblin proportions: big head, long arms, stubby legs, pointed ears.
PARTS = [
    ("hips", (0, 0, 0.78), (0.42, 0.26, 0.2), "Suit"),
    ("spine", (0, 0.02, 1.08), (0.46, 0.28, 0.42), "Suit"),
    ("head", (0, 0, 1.5), (0.36, 0.34, 0.34), "Skin"),
    ("head", (0.24, 0, 1.56), (0.2, 0.05, 0.07), "Skin"),   # left ear
    ("head", (-0.24, 0, 1.56), (0.2, 0.05, 0.07), "Skin"),  # right ear
    ("arm.L", (0.3, 0, 1.0), (0.13, 0.13, 0.5), "Suit"),
    ("arm.L", (0.3, 0, 0.7), (0.12, 0.12, 0.12), "Skin"),   # left hand
    ("arm.R", (-0.3, 0, 1.0), (0.13, 0.13, 0.5), "Suit"),
    ("arm.R", (-0.3, 0, 0.7), (0.12, 0.12, 0.12), "Skin"),  # right hand
    ("arm.R", (-0.3, -0.3, 0.74), (0.1, 0.5, 0.12), "Metal"),  # tommy gun, held forward
    ("leg.L", (0.14, 0, 0.4), (0.16, 0.16, 0.8), "Suit"),
    ("leg.R", (-0.14, 0, 0.4), (0.16, 0.16, 0.8), "Suit"),
]


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def make_materials():
    colours = {
        "Suit": (0.17, 0.17, 0.19, 1.0),
        "Skin": (0.35, 0.62, 0.2, 1.0),
        "Metal": (0.25, 0.25, 0.28, 1.0),
    }
    return {name: _material(name, col) for name, col in colours.items()}


def _material(name, colour):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = colour
    return mat


def make_armature():
    data = bpy.data.armatures.new("Rig")
    arm = bpy.data.objects.new("Rig", data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (head, tail, parent) in BONES.items():
        b = data.edit_bones.new(name)
        b.head = head
        b.tail = tail
        if parent:
            b.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def box_part(bone, centre, size, mat):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = (
            v.co.x * size[0] + centre[0],
            v.co.y * size[1] + centre[1],
            v.co.z * size[2] + centre[2],
        )
    mesh = bpy.data.meshes.new(f"{bone}_{mat.name}")
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(mesh.name, mesh)
    bpy.context.collection.objects.link(obj)
    # Rigid skin: every vertex follows its bone
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
    return obj


def make_body(arm, mats):
    parts = [box_part(bone, c, s, mats[m]) for bone, c, s, m in PARTS]
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = "Goblin"
    body.parent = arm
    mod = body.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    return body


def key_pose(arm, frame, pose):
    """Keyframe every bone; bones not in `pose` rest at zero."""
    for name in BONES:
        pb = arm.pose.bones[name]
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = pose.get(name, (0.0, 0.0, 0.0))
        pb.keyframe_insert("rotation_euler", frame=frame)


def make_action(arm, name, keys, length):
    action = bpy.data.actions.new(name)
    arm.animation_data.action = action
    for frame, pose in keys:
        key_pose(arm, frame, pose)
    bpy.context.scene.frame_end = max(bpy.context.scene.frame_end, length)
    return action


def build_actions(arm):
    arm.animation_data_create()

    # idle: slow breathing and a little ear wiggle
    make_action(arm, "idle", [
        (1, {}),
        (24, {"spine": (-0.03, 0, 0), "arm.L": (0.05, 0, 0), "arm.R": (0.05, 0, 0)}),
        (48, {}),
    ], 48)

    # walk: opposite arm and leg swing
    make_action(arm, "walk", [
        (1, {"leg.L": (0.5, 0, 0), "leg.R": (-0.5, 0, 0), "arm.L": (-0.4, 0, 0), "arm.R": (0.4, 0, 0)}),
        (13, {"leg.L": (-0.5, 0, 0), "leg.R": (0.5, 0, 0), "arm.L": (0.4, 0, 0), "arm.R": (-0.4, 0, 0)}),
        (25, {"leg.L": (0.5, 0, 0), "leg.R": (-0.5, 0, 0), "arm.L": (-0.4, 0, 0), "arm.R": (0.4, 0, 0)}),
    ], 25)

    # shoot: gun arm raised forward, then lowered
    make_action(arm, "shoot", [
        (1, {}),
        (3, {"arm.R": (-1.5, 0, 0), "spine": (0.05, 0, 0)}),
        (12, {"arm.R": (-1.5, 0, 0), "spine": (0.05, 0, 0)}),
        (18, {}),
    ], 18)

    # die: topple forward and stay there
    make_action(arm, "die", [
        (1, {}),
        (30, {"hips": (-1.5, 0, 0), "spine": (-0.2, 0, 0), "head": (0.3, 0, 0)}),
    ], 30)

    arm.animation_data.action = bpy.data.actions["idle"]


def main():
    clear_scene()
    mats = make_materials()
    arm = make_armature()
    arm.animation_data_create()
    make_body(arm, mats)
    build_actions(arm)

    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        use_selection=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_apply=False,
    )
    print(f"Exported {OUT}")


main()
