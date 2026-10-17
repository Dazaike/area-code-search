# Area Code Search

![version](https://img.shields.io/badge/version-v1.0.0-orange)

Search every North American (+1) area code by number, pasted phone number, city, state/province or country, and see each code's zone on a map.

- 480 codes: US, Canada, Caribbean and Atlantic, US Pacific territories, plus non-geographic codes (800, 888, ...).
- Map with street detail (OpenStreetMap), zone outlines, hover tooltips, click-to-open detail sheet.
- Detail sheet: coverage, in-service date, local time per time zone, overlay codes, cities, copy `+1 xxx`.
- Plain HTML/CSS/JS. No framework, no build step for the site itself. Works from any static host and from `file://`.

## Run it

```
python -m http.server 8080
```

Open http://localhost:8080/ (or open `index.html` directly). The street layer on the map needs an internet connection; the zone outlines and search do not.

Keyboard: `/` focuses search, `Esc` clears search or closes the sheet.

## Regenerate the data

Node 18+ and an internet connection. No dependencies.

```
node scripts/build-data.mjs                              # assets/data.js
node --max-old-space-size=4096 scripts/build-map.mjs     # assets/map-data.js (run after build-data)
```

`build-data.mjs` reads Wikipedia's area code list and Google libphonenumber. `build-map.mjs` downloads about 100 MB of boundary GeoJSON and simplifies it into about 1.8 MB.

## Files

| Path | Purpose |
|---|---|
| `index.html` | Page |
| `assets/search.js` | Search and ranking (pure, no DOM) |
| `assets/map.js` | Canvas map: tiles, zones, pan/zoom, hit testing |
| `assets/app.js` | UI, sheet, theme, keyboard |
| `assets/data.js`, `assets/map-data.js` | Generated data |
| `scripts/` | Data build scripts |

## Limitations

- Area codes show where a number was originally assigned, not necessarily where it is now.
- Boundaries are from 2015. Codes created since reuse the outline of the codes they overlay. 721 (Sint Maarten) has no outline.
- City names are a ~2013 snapshot.
- The map uses the public OpenStreetMap tile server, which is fine for personal use. For a busy public deployment, point the tile URL in `assets/map.js` at a provider you have a key for.

## Credits

- Codes, regions, descriptions, dates, overlays: Wikipedia, "List of North American Numbering Plan area codes" (CC BY-SA 4.0).
- Cities and time zones: Google libphonenumber (Apache-2.0).
- Boundaries: UCLA Geoportal "North America Telephone Area Code Boundaries" (2015, public domain) via [1ec5/nanp-boundaries](https://github.com/1ec5/nanp-boundaries); 867 from Natural Earth (public domain).
- Base map: © OpenStreetMap contributors.
- Font: Outfit (SIL OFL).

See [CHANGELOG.md](CHANGELOG.md).
