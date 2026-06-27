TINOS FONT SEED — for #4 title visual-match retest

WHAT: Tinos-Regular.ttf — a metric-compatible Times New Roman equivalent.
WHY:  Canva reports the #4 title font as "Times New Roman". TNR is proprietary
      (Monotype) and must not be embedded in production output. Tinos is the
      licensed open equivalent, so it tests the metadata claim safely.

LICENSE: SIL Open Font License 1.1 (see Tinos-LICENSE.txt). Permits embedding
         and commercial use of rendered output. Provenance: googlefonts/tinos.
         Verified internal family name: "Tinos".

PLACEMENT (unzip at repo root): places exactly
  studio/fonts/Tinos-Regular.ttf
  studio/fonts/Tinos-LICENSE.txt
  studio/fonts/README_TINOS_SEED.txt

This is a PROVIDED file. CC places it; CC does NOT download anything.

LIBRARY ENTRY to add to fontLibrary.json:
  {
    "id": "tinos-400",
    "declared_family": "Tinos",
    "verified_family": "Tinos",        // confirm by reading the name table
    "file": "fonts/Tinos-Regular.ttf",
    "category": "serif",
    "weight": 400,
    "style": "normal",
    "license_ok": true,
    "metadata_alias_for": "Times New Roman"   // licensed equivalent of the metadata name
  }
