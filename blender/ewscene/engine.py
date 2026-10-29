FINAL = {
    "engine": "CYCLES",
    "samples": 256,
    "adaptive_threshold": 0.01,
    "adaptive_min_samples": 0,
    "denoiser": "OPENIMAGEDENOISE",
    "persistent_data": True,
}


def eevee_id(version):
    if tuple(version[:2]) < (4, 2):
        return "BLENDER_EEVEE"
    if tuple(version[:2]) < (5, 0):
        return "BLENDER_EEVEE_NEXT"
    return "BLENDER_EEVEE"


def device(listed):
    gpus = [d for d in listed if d["type"] == "METAL"]
    return ("GPU", [d["name"] for d in gpus]) if gpus else ("CPU", [])
