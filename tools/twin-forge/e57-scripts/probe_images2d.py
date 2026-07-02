"""Probe cloud_0.e57 for embedded photographic images (Image2D records).

The panoramas/ JPGs were built from per-point lidar RGB (extract_all.py) —
black glass, black zenith. If Matterport embedded the real photos, they live
in the E57 root's images2D vector. This prints what exists and extracts the
first image blob to disk for visual judgment.
"""
import pye57

E57_PATH = r"F:\E57\cloud_0.e57"

e57 = pye57.E57(E57_PATH)
imf = e57.image_file
root = imf.root()

print("root children:", [root[i].elementName() for i in range(root.childCount())])

if not root.isDefined("images2D"):
    print("NO images2D section — the E57 carries no embedded photos.")
    raise SystemExit(0)

images = root["images2D"]
print("images2D count:", images.childCount())

img0 = images[0]
names = [img0[i].elementName() for i in range(img0.childCount())]
print("image[0] children:", names)

for rep in ("sphericalRepresentation", "pinholeRepresentation", "cylindricalRepresentation", "visualReferenceRepresentation"):
    if img0.isDefined(rep):
        r = img0[rep]
        rnames = [r[i].elementName() for i in range(r.childCount())]
        print(f"representation: {rep} -> {rnames}")
        for blobname in ("jpegImage", "pngImage"):
            if r.isDefined(blobname):
                blob = r[blobname]
                size = blob.byteCount()
                print(f"{blobname} bytes: {size}")
                buf = bytearray(size)
                blob.read(buf, 0, size)
                out = r"F:\E57\image2d_probe_000." + ("jpg" if blobname == "jpegImage" else "png")
                with open(out, "wb") as f:
                    f.write(bytes(buf))
                print("wrote", out)
        if r.isDefined("imageWidth"):
            print("imageWidth:", r["imageWidth"].value(), "imageHeight:", r["imageHeight"].value())
        break

if img0.isDefined("pose"):
    print("image[0] has pose: yes")
if img0.isDefined("associatedData3DGuid"):
    print("associatedData3DGuid:", img0["associatedData3DGuid"].value())
