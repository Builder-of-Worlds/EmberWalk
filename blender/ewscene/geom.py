import math


def matmul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def transpose(a):
    return [[a[j][i] for j in range(3)] for i in range(3)]


def apply(m, v):
    return tuple(sum(m[i][k] * v[k] for k in range(3)) for i in range(3))


def rot_x(rad):
    c, s = math.cos(rad), math.sin(rad)
    return [[1, 0, 0], [0, c, -s], [0, s, c]]


def rot_z(rad):
    c, s = math.cos(rad), math.sin(rad)
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]]


def camera_rotation(heading_deg, tilt_deg, roll_deg):
    return matmul(
        matmul(rot_z(math.radians(-heading_deg)), rot_x(math.radians(90.0 - tilt_deg))),
        rot_z(math.radians(-roll_deg)),
    )


def fov_deg(camera):
    w = camera["sensor_width_mm"]
    h = w * camera["height_px"] / camera["width_px"]
    f = camera["focal_mm"]
    return 2 * math.degrees(math.atan(w / 2 / f)), 2 * math.degrees(math.atan(h / 2 / f))


def project(point, pose, camera):
    r = camera_rotation(pose["heading_deg"], pose["tilt_deg"], pose["roll_deg"])
    rel = [point[i] - pose["pos_in"][i] for i in range(3)]
    x, y, z = apply(transpose(r), rel)
    if z >= 0:
        return None
    f_px = camera["focal_mm"] / camera["sensor_width_mm"] * camera["width_px"]
    return camera["width_px"] / 2 + f_px * x / -z, camera["height_px"] / 2 - f_px * y / -z


def in_frame(uv, camera):
    return uv is not None and 0 <= uv[0] <= camera["width_px"] and 0 <= uv[1] <= camera["height_px"]
