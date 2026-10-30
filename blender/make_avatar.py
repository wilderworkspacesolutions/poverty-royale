"""
Builds a simple rigged casino patron and exports it as a .glb with four actions:
idle, walk, shoot, die.

Run headless (no Blender UI needed):

    blender -b --factory-startup -P blender/make_avatar.py -- assets/avatar.glb

Units are metres. The figure faces -Y in Blender, which glTF exports as +Z.
Three.js models face -Z, so rotate the loaded model by PI around Y in the game.
"""
import sys

import bmesh
import bpy

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGV[0] if ARGV else "avatar.glb"

# name: (head, tail, parent)
BONES = {
    "root": ((0, 0, 0), (0, 0, 0.05), None),
    "hips": ((0, 0, 0.9), (0, 0, 1.1), "root"),
    "spine": ((0, 0, 1.1), (0, 0, 1.5), "hips"),
    "head": ((0, 0, 1.5), (0, 0, 1.9), "spine"),
    "arm.L": ((0.35, 0, 1.45), (0.35, 0, 0.9), "spine"),
    "arm.R": ((-0.35, 0, 1.45), (-0.35, 0, 0.9), "spine"),
    "leg.L": ((0.15, 0, 0.9), (0.15, 0, 0.0), "hips"),
    "leg.R": ((-0.15, 0, 0.9), (-0.15, 0, 0.0), "hips"),
}

# bone: (centre, size) of the box that represents it
PARTS = {
    "hips": ((0, 0, 1.0), (0.42, 0.26, 0.22)),
    "spine": ((0, 0, 1.3), (0.5, 0.28, 0.4)),
    "head": ((0, 0, 1.72), (0.26, 0.26, 0.28)),
    "arm.L": ((0.35, 0, 1.17), (0.14, 0.14, 0.55)),
    "arm.R": ((-0.35, 0, 1.17), (0.14, 0.14, 0.55)),
    "leg.L": ((0.15, 0, 0.45), (0.18, 0.18, 0.9)),
    "leg.R": ((-0.15, 0, 0.45), (0.18, 0.18, 0.9)),
}


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


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


def box_part(bone, centre, size):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = (
            v.co.x * size[0] + centre[0],
            v.co.y * size[1] + centre[1],
            v.co.z * size[2] + centre[2],
        )
    mesh = bpy.data.meshes.new(bone)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(bone, mesh)
    bpy.context.collection.objects.link(obj)
    # Rigid skin: every vertex follows its bone
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
    return obj


def make_body(arm):
    parts = [box_part(bone, c, s) for bone, (c, s) in PARTS.items()]
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = "Avatar"

    mat = bpy.data.materials.new("Suit")
    mat.diffuse_color = (0.17, 0.17, 0.19, 1.0)
    body.data.materials.append(mat)

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
    arm.animation_data_create()
    arm.animation_data.action = action
    for frame, pose in keys:
        key_pose(arm, frame, pose)
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = max(bpy.context.scene.frame_end, length)
    return action


def build_actions(arm):
    arm.animation_data_create()

    # idle: slow breathing
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

    # shoot: right arm raised forward, then lowered
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

    # leave the armature at rest, with the idle action active
    arm.animation_data.action = bpy.data.actions["idle"]


def main():
    clear_scene()
    arm = make_armature()
    make_body(arm)
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
