#!/usr/bin/env python3
"""Regenerates src/server/care/coverage-areas.json from the ABS ASGS Edition 3 (2021) correspondence files.

Usage: python3 scripts/coverage-data/build-coverage-areas.py <dir-with-extracted-xlsx> <asgs2021correspondences.zip> <retrieved-date YYYY-MM-DD>
Needs: openpyxl. The two inputs are CG_POA_2021_GCCSA_2021.xlsx and CG_POA_2021_LGA_2022.xlsx.

Nothing is typed by hand: every postcode in the output comes from those files and the rule below.
Rule (see docs/contracts/service-coverage.md): include a postcode when
  gccsa_greater_adelaide >= 0.5   OR   (lga_adelaide_hills + lga_mount_barker) >= 0.5
where each ratio is the ABS population-weighted share of the postal area (POA) in that region.
"""
import hashlib, json, sys
from collections import defaultdict
import openpyxl

THRESHOLD = 0.5
GADE = "4GADE"
HILLS_LGAS = {40120: "adelaide_hills", 44550: "mount_barker"}  # LGA_CODE_2022

def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def rows(path):
    return list(openpyxl.load_workbook(path, read_only=True).active.iter_rows(values_only=True))[1:]

def postcode(value):
    return None if value is None else str(value).strip().zfill(4)

def main(base, zip_path, retrieved):
    gccsa_file, lga_file = f"{base}/CG_POA_2021_GCCSA_2021.xlsx", f"{base}/CG_POA_2021_LGA_2022.xlsx"
    gade, hills = defaultdict(float), defaultdict(lambda: defaultdict(float))
    for poa, _name, code, _gname, ratio, *_ in rows(gccsa_file):
        if postcode(poa) and str(code) == GADE:
            gade[postcode(poa)] += ratio
    for poa, code, _name, ratio, *_ in rows(lga_file):
        if postcode(poa) and code in HILLS_LGAS:
            hills[postcode(poa)][HILLS_LGAS[code]] += ratio
    candidates = []
    for code in sorted(set(gade) | set(hills)):
        g = round(gade.get(code, 0.0), 7)
        ah, mb = round(hills[code].get("adelaide_hills", 0.0), 7), round(hills[code].get("mount_barker", 0.0), 7)
        included = g >= THRESHOLD or (ah + mb) >= THRESHOLD
        candidates.append({"postcode": code, "gccsa_greater_adelaide": g, "lga_adelaide_hills": ah, "lga_mount_barker": mb, "included": included})
    out = {
        "version": retrieved,
        "areaId": "adelaide-metro-and-hills",
        "decision": "Marcel: launch coverage is Adelaide metro plus Adelaide Hills",
        "source": {
            "publisher": "Australian Bureau of Statistics (ABS)",
            "title": "ASGS Edition 3 (2021) Correspondence Files",
            "datasetUrl": "https://data.gov.au/data/dataset/asgs-edition-3-2021-correspondences",
            "downloadUrl": "https://data.gov.au/data/dataset/2c79581f-600e-4560-80a8-98adb1922dfc/resource/33d822ba-138e-47ae-a15f-460279c3acc3/download/asgs2021correspondences.zip",
            "absPageUrl": "https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs/edition-3-july-2021-june-2026/access-and-downloads/correspondences",
            "licence": "CC BY 4.0",
            "retrievedOn": retrieved,
            "zipSha256": sha(zip_path),
            "files": {"CG_POA_2021_GCCSA_2021.xlsx": sha(gccsa_file), "CG_POA_2021_LGA_2022.xlsx": sha(lga_file)},
        },
        "rule": {
            "threshold": THRESHOLD,
            "text": "Include a postal area (POA 2021, used as the postcode) when its ABS population-weighted share in GCCSA 4GADE Greater Adelaide is >= threshold, or its combined share in LGA 40120 Adelaide Hills and LGA 44550 Mount Barker is >= threshold.",
        },
        "services": {"repair": [ "adelaide-metro-and-hills" ], "cleaning": ["adelaide-metro-and-hills"]},
        "candidates": candidates,
    }
    json.dump(out, sys.stdout, indent=1)
    sys.stdout.write("\n")

if __name__ == "__main__":
    main(*sys.argv[1:4])
