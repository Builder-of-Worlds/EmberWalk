"""Lap siding: boards stacked up a wall, each thick at its lower edge and tucked flat at its top, so the sun throws a shadow line under every board."""

BOARD_IN = 6.5
PROUD_IN = 0.9
TUCK_IN = 0.05
SINK_IN = 0.03
MIN_BOARD_IN = 0.05
APEX_GAP_IN = 0.5
MIN_GABLE_ROW_IN = 1.0
EPS = 1e-6


def wanted(spec):
    """Lap boards belong on a lap sided house wearing the photo look; stucco and metal walls stay flat."""
    return bool(spec["look"].get("photoscans")) and spec["house"]["siding"] == "fiber cement lap"


def pitch(wall_in):
    return wall_in / max(1, round(wall_in / BOARD_IN))


def _out(z, top, step):
    return TUCK_IN + (PROUD_IN - TUCK_IN) * (top - z) / step


def _board(z0, z1, top, step):
    return {"z0": z0, "z1": z1, "out0": _out(z0, top, step), "out1": _out(z1, top, step)}


def boards(z0, z1, wall_in):
    """The boards of one wall panel between heights z0 and z1: the lines of the whole wall, cut where the panel ends."""
    step = pitch(wall_in)
    first = int((z0 + EPS) // step)
    out = []
    k = first
    while k * step < z1 - EPS:
        lo, hi = max(k * step, z0), min((k + 1) * step, z1)
        if hi - lo >= MIN_BOARD_IN:
            out.append(_board(lo, hi, (k + 1) * step, step))
        k += 1
    return out


def gable_boards(base, apex, s0, s1):
    """The board rows of a triangular gable end from its base to just under its apex, each with the span it covers at its foot and at its top."""
    step = pitch(base)
    mid, half = (s0 + s1) / 2.0, (s1 - s0) / 2.0

    def reach(z):
        return half * (apex - z) / (apex - base)

    out = []
    z = base
    while z < apex - APEX_GAP_IN:
        top = min(z + step, apex - APEX_GAP_IN)
        if top - z >= MIN_GABLE_ROW_IN:
            row = _board(z, top, z + step, step)
            row.update(a0=mid - reach(z), a1=mid + reach(z), a0_top=mid - reach(top), a1_top=mid + reach(top))
            out.append(row)
        z += step
    return out
