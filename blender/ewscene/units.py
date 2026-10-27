INCH_M = 0.0254


def in_to_m(inches):
    return inches * INCH_M


def m_to_in(meters):
    return meters / INCH_M


def feet_inches(inches):
    return "%d ft %d in" % divmod(int(inches), 12)
