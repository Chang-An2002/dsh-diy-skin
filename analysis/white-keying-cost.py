"""What it costs to store a picture with its white background keyed out.
    
Evidence for a design decision, not a build step: the plugin ships no Python. The
question was whether to key the background out once and keep the result, or keep the
original and redo the work on every load. Measured on real artwork sitting on a white
box -- the case the user has: +61 per cent per picture, about half a megabyte more for
a full album of eight, which fits comfortably. Recomputing on every load would cost
time on every start instead, which is the thing a skin must not do.

The original measurement was on real artwork that sits
on a white box, like the stickers they add. The transparent region of a white *box*
is a rectangle, so its alpha channel is far cheaper than the fiddly anti-aliased
edges a page of text produces.
"""
import base64
import io
import sys

from PIL import Image, ImageFilter

ART = sys.argv[1]
QUALITY = 80
MAX_EDGE = 1600


def shrink(image):
    scale = min(1.0, MAX_EDGE / max(image.size))
    if scale < 1.0:
        image = image.resize(
            (max(1, int(image.width * scale)), max(1, int(image.height * scale))), Image.LANCZOS
        )
    return image


def webp(image, **kwargs):
    buffer = io.BytesIO()
    image.save(buffer, format="WEBP", quality=QUALITY, method=6, **kwargs)
    return buffer.getvalue()


def key_white(image, tolerance=24):
    width, height = image.size
    pixels = image.load()
    mask = Image.new("L", (width, height), 0)
    mask_pixels = mask.load()
    stack = [(x, 0) for x in range(width)] + [(x, height - 1) for x in range(width)]
    stack += [(0, y) for y in range(height)] + [(width - 1, y) for y in range(height)]
    seen = bytearray(width * height)
    limit = 255 - tolerance
    while stack:
        x, y = stack.pop()
        index = y * width + x
        if seen[index]:
            continue
        seen[index] = 1
        r, g, b = pixels[x, y]
        if r < limit or g < limit or b < limit:
            continue
        mask_pixels[x, y] = 255
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height:
                stack.append((nx, ny))
    # A one-pixel feather, so the cut edge does not read as a staircase.
    mask = mask.filter(ImageFilter.GaussianBlur(0.6))
    rgba = image.convert("RGBA")
    flat = Image.new("RGB", (width, height), (255, 255, 255)).convert("RGBA")
    out = Image.composite(flat, rgba, mask)
    out.putalpha(Image.composite(Image.new("L", (width, height), 0), Image.new("L", (width, height), 255), mask))
    return out, mask


def main():
    raw = open(ART, "r", encoding="utf-8").read().strip()
    payload = raw.split(",", 1)[1]
    art = Image.open(io.BytesIO(base64.b64decode(payload)))
    art.load()
    print("artwork         : " + str(art.size) + "  mode " + art.mode)

    # Put it on a white box, which is the situation being solved.
    box = Image.new("RGBA", art.size, (255, 255, 255, 255))
    box.alpha_composite(art.convert("RGBA"))
    flat = shrink(box.convert("RGB"))
    before = webp(flat)
    keyed, mask = key_white(flat)
    after = webp(keyed, exact=False)
    transparent = mask.histogram()[255] / (mask.width * mask.height)

    print("white box       : " + str(flat.size))
    print("today (no alpha): " + format(len(before), ",") + " bytes")
    print("keyed (alpha)   : " + format(len(after), ",") + " bytes")
    print("change          : %+.1f%%" % ((len(after) / len(before) - 1) * 100))
    print("transparent     : %.0f%%" % (transparent * 100))
    print("stored (base64) : %s vs %s bytes" % (format(int(len(after) * 4 / 3), ","), format(int(len(before) * 4 / 3), ",")))
    print("eight of them   : %s vs %s MB" % (
        format(int(len(after) * 4 / 3) * 8 / 1e6, ".1f"),
        format(int(len(before) * 4 / 3) * 8 / 1e6, ".1f"),
    ))


main()
