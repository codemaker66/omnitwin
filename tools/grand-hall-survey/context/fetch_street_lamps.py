"""Glasgow City Council's open street-lighting positions round Trades Hall.

Source: Glasgow City Council, "Lighting Columns" (map service OPEN_DATA/Lighting_Columns, layer 0;
ArcGIS Online item 4d4122803b304cd3a80684a08d0a9143), published under the Open Government Licence v3.0
(the item's licence statement; the Spatial Hub record "Street Furniture - Glasgow City" is uk-ogl). The
layer holds OBJECTID, ITEM_TYPE (always "COLUMN", whether the lamp stands on a column or a wall bracket)
and a point on the British National Grid (EPSG:27700). This keeps only OBJECTID and the point.

The council's other lighting layer (Pub_Lighting_Columns, behind its fault-reporting map) carries
heights, bracket and lantern types, but states no licence, so nothing from it is used or stored here.

Usage:
  python fetch_street_lamps.py <out-json> [--from <saved-response.json>] [--retrieved YYYY-MM-DD]

Without --from it sends the query below (300 m round the hall floor centre, E259332 N665191) and keeps
the raw response's SHA-256. With --from it reads a response saved earlier from the same layer (for any
radius of at least 300 m) and keeps the lamps within 300 m. Either way the output lists every lamp by
OBJECTID with its easting and northing to the centimetre, sorted by OBJECTID, plus the source, query,
retrieval date, the response's hash and the licence.
"""
import argparse
import datetime
import hashlib
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

SERVICE = "https://www.mapping.glasgow.gov.uk/arcgis_web/rest/services/OPEN_DATA/Lighting_Columns/MapServer/0"
ITEM = "https://www.arcgis.com/home/item.html?id=4d4122803b304cd3a80684a08d0a9143"
CATALOGUE = "https://data.spatialhub.scot/dataset/street_furniture-gc"
CENTRE_E, CENTRE_N = 259332.0, 665191.0   # the planner's origin: the Grand Hall's floor centre
RADIUS_M = 300.0
LICENCE = {
    "licence": "Open Government Licence v3.0",
    "url": "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
    "attribution": ("Contains public sector information licensed under the Open Government Licence v3.0. "
                    "Street lighting: Glasgow City Council. Contains OS data © Crown copyright and database right 2026."),
    "note": ("The OS clause is precautionary: the Spatial Hub record says the council digitised its street furniture "
             "against Ordnance Survey data."),
}
QUERY = {
    "where": "1=1",
    "geometry": json.dumps({"x": CENTRE_E, "y": CENTRE_N}, separators=(",", ":")),
    "geometryType": "esriGeometryPoint",
    "inSR": "27700",
    "spatialRel": "esriSpatialRelIntersects",
    "distance": str(int(RADIUS_M)),
    "units": "esriSRUnit_Meter",
    "outFields": "OBJECTID,ITEM_TYPE",
    "returnGeometry": "true",
    "outSR": "27700",
    "orderByFields": "OBJECTID",
    "f": "json",
}


def parse_args():
    ap = argparse.ArgumentParser(description="Glasgow City Council open street-lighting positions round Trades Hall.")
    ap.add_argument("out", type=Path, help="the JSON to write")
    ap.add_argument("--from", dest="saved", type=Path, help="a response saved earlier from the same layer")
    ap.add_argument("--retrieved", help="the date the response was retrieved, YYYY-MM-DD (default today)")
    return ap.parse_args()


def main():
    args = parse_args()
    url = f"{SERVICE}/query?{urllib.parse.urlencode(QUERY)}"
    if args.saved is not None:
        raw = args.saved.read_bytes()
        how = f"read from a response saved on retrieval ({args.saved.name}), then cut to {RADIUS_M:.0f} m here"
    else:
        with urllib.request.urlopen(url, timeout=60) as response:   # noqa: S310 (a fixed https URL)
            raw = response.read()
        how = "this query's own response"
    retrieved = datetime.date.fromisoformat(args.retrieved).isoformat() if args.retrieved else datetime.date.today().isoformat()
    doc = json.loads(raw)
    if doc.get("exceededTransferLimit"):
        raise SystemExit("the response was cut at the service's record limit: query a smaller area")
    sr = (doc.get("spatialReference") or {}).get("wkid")
    if sr != 27700:
        raise SystemExit(f"expected British National Grid (27700), got {sr}")
    lamps = []
    kinds = set()
    for feature in doc["features"]:
        attributes, point = feature["attributes"], feature["geometry"]
        e, n = float(point["x"]), float(point["y"])
        if not (math.isfinite(e) and math.isfinite(n)):
            raise SystemExit(f"OBJECTID {attributes['OBJECTID']}: no point")
        if math.hypot(e - CENTRE_E, n - CENTRE_N) > RADIUS_M:
            continue
        kinds.add(attributes.get("ITEM_TYPE"))
        lamps.append({"objectid": int(attributes["OBJECTID"]), "e": round(e, 2), "n": round(n, 2)})
    lamps.sort(key=lambda lamp: lamp["objectid"])
    ids = [lamp["objectid"] for lamp in lamps]
    if len(set(ids)) != len(ids):
        raise SystemExit("duplicate OBJECTIDs in the response")
    if kinds != {"COLUMN"}:
        raise SystemExit(f"unexpected ITEM_TYPE values {sorted(map(str, kinds))}")
    out = {
        "schema": "venviewer.street-lamps-ogl.v1",
        "title": "Street lighting positions within 300 m of the Grand Hall, Trades Hall, Glasgow",
        "source": {
            "dataset": "Glasgow City Council, Lighting Columns (Open Data)",
            "service": SERVICE,
            "item": ITEM,
            "catalogue": CATALOGUE,
            "query": url,
            "retrieved": retrieved,
            "response_sha256": hashlib.sha256(raw).hexdigest(),
            "response": how,
            "fields_kept": "OBJECTID and the point (ITEM_TYPE is 'COLUMN' for every record, bracket or column)",
        },
        "licence": LICENCE,
        "frame": {"crs": "EPSG:27700 (British National Grid), metres", "centre": [CENTRE_E, CENTRE_N], "radius_m": RADIUS_M},
        "count": len(lamps),
        "lamps": lamps,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes((json.dumps(out, indent=1) + "\n").encode("utf-8"))
    print(f"{len(lamps)} lamps within {RADIUS_M:.0f} m -> {args.out}")


if __name__ == "__main__":
    main()
