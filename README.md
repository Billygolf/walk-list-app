# Forests for Oregon Walk Lists

A phone app for door-to-door canvassing that works with paper too.

- **Walk a turf** on your phone: doors in route order, one tap to open the next Google Maps leg, record each door (Talked, Not home, Left lit, Voted, plus a note).
- **Print scan sheets** for any turf. Each page has black corner squares and a page code.
- **Scan filled-in sheets** with the phone camera. The app straightens the photo, reads the page code and the checked boxes, and shows a review screen before saving.
- **Candidates**: add the name and photo of the candidate we support in each Congressional, Oregon House and Oregon Senate district (Lists & export, then Edit candidates, or tap a district on a precinct). They show on precincts, turfs, doors, the district filter and printed sheets. Photos are stored on the phone only, never in this repository. Share sends them to volunteers, and shared turfs carry them too.
- **HQ** (on a computer): progress by district and precinct, send a precinct or a whole district to a volunteer as one file (with its candidates), and drop in the results spreadsheets volunteers send back.
- **Export** all results as a CSV spreadsheet.

Everything is stored on the phone (IndexedDB). Nothing is sent to a server. It keeps working without signal once it has been opened once.

## Walk list files

Voter data is **not** in this repository. Lists are loaded into the app from `.json` files
made from the route sheets with:

```
python3 tools/route_to_json.py "Precinct 303.02 Route.html" [more files...] out-folder/
```

To rebuild the whole county in one file (`All precincts.json.gz`) straight from the voter export:

```
python3 tools/build_all_precincts.py 34_Ex-VotingHistory-<date>.txt "All precincts.json.gz"
```

Add `--districts "District lists"` to also write one file per Congressional, Oregon Senate and Oregon House district. The targeting rules are described at the top of that script. Load the result under **Lists & export**.

## Running it locally

Any static web server works, for example `python3 -m http.server` in this folder, then open http://localhost:8000.
The camera and offline mode need HTTPS when it is not on localhost.

## Files

- `layout.js` page geometry shared by printing and scanning (change both together)
- `sheet.js` printable sheets
- `scan.js` reads a photo of a sheet
- `app.js` screens
- `db.js` on-device storage
- `jsQR.js`, `qrcode.js`: jsQR (Apache-2.0) and qrcode-generator (MIT)
