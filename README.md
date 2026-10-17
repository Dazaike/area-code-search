# area-code-search

![version](https://img.shields.io/badge/version-v1.0.0-orange)

A stranger called from 845 and you want to know where that is. Somewhere, a team is billing a client for a React-Redux-microservice-GraphQL stack to answer that question. This is 480 area codes, one map, and zero frameworks.

Type a code, a city, a state, a country, or paste the whole phone number. The site finds the code and draws its zone on a street map. That is the entire product.

## what it covers

- 480 codes: 453 geographic, 27 non-geographic (800, 888 and friends). US, Canada, Caribbean and Atlantic, US Pacific territories.
- Per-code detail: coverage, in-service date, local time per time zone, overlay codes, cities, and a button that copies `+1 xxx`. Yes, a button. We know.
- Map: zone outlines over OpenStreetMap, hover tooltips that list every code stacked on a spot, click to open the details. Drag, scroll, pinch, arrow keys. Works.
- Plain HTML, CSS and JS. No framework, no bundler, no `node_modules` folder the size of a small moon.

## quickstart

We made this idiot-proof because history proves you need it.

```
python -m http.server 8080
```

Open http://localhost:8080/. Or double-click `index.html` and skip the server entirely. `zero-fluff`.

`/` jumps to search. `Esc` clears it or closes the sheet. If that confuses you, the problem is between your chair and your keyboard.

The street layer needs internet. The outlines and the search do not.

## regenerate the data

You need Node 18+ and a connection. You do not need `npm install`, because there is nothing to install.

```
node scripts/build-data.mjs
node --max-old-space-size=4096 scripts/build-map.mjs
```

Run them in that order. The second one reads what the first one wrote.

- `build-data.mjs` pulls the code list from Wikipedia and cities and time zones from Google libphonenumber. It asserts known facts (212 is New York, 416 is Toronto, 346 inherits Houston) and fails loudly if the sources change shape.
- `build-map.mjs` downloads about 100 MB of boundary GeoJSON and simplifies it down to about 1.8 MB. The heap flag is not optional decoration.

## files

| path | what it does |
|---|---|
| `index.html` | the page |
| `assets/search.js` | search and ranking. Pure logic, no DOM |
| `assets/map.js` | canvas map: tiles, zones, pan and zoom, hit testing |
| `assets/app.js` | UI, sheet, theme, keyboard |
| `assets/data.js`, `assets/map-data.js` | generated data. Commit them, the site has no build step to make them |
| `scripts/` | the two data scripts above |

## limitations, stated plainly

- An area code shows where a number was first assigned. People move and keep their numbers. Phones have not worked like landlines since before you owned one.
- Boundaries are from 2015. Codes created since then borrow the outline of the codes they overlay, and the map says so when you select one. 721 (Sint Maarten) has no outline at all.
- City names are a roughly 2013 snapshot.
- The copy button needs a secure context. `localhost` counts. A random `file://` open may not, and the button will say `Copy failed` instead of pretending.
- The map uses the public OpenStreetMap tile server. Fine for personal use. If you put this in front of real traffic, change the tile URL in `assets/map.js` to a provider you have a key for, and do not make the volunteers pay for your launch.

## credits

- Codes, regions, descriptions, dates, overlays: Wikipedia, "List of North American Numbering Plan area codes" (CC BY-SA 4.0).
- Cities and time zones: Google libphonenumber (Apache-2.0).
- Boundaries: UCLA Geoportal "North America Telephone Area Code Boundaries" (2015, public domain) via [1ec5/nanp-boundaries](https://github.com/1ec5/nanp-boundaries). 867 from Natural Earth (public domain).
- Base map: © OpenStreetMap contributors.
- Font: Outfit (SIL OFL).

History lives in [CHANGELOG.md](CHANGELOG.md).
