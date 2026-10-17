# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [v1.0.0] - 2026-10-16

First release. There is no earlier history, so every entry below is new.

### Added
- Static, build-free website (no framework, no CDN for code or fonts) that searches the North American Numbering Plan: 480 area codes (453 geographic, 27 non-geographic such as 800/888) across the US, Canada, the Caribbean and Atlantic, and the US Pacific territories.
- Search by 3-digit code (prefix match), pasted phone number (`(212) 555-1234`, `+1 416 555 0100`), city, state/province abbreviation or name, or country. Ranked results, region filter chips, matching cities shown under each result.
- Detail sheet per code: coverage description, in-service date, local time for each time zone, overlay codes (clickable), cities, and a "Copy +1 xxx" button.
- Interactive map of area-code zones: search results are outlined and the view fits them, hovering a list row or a zone highlights it, hovering a zone shows every code stacked there, clicking opens the detail sheet. Drag, wheel, pinch, arrow-key and +/- navigation; zoom and fit buttons.
- OpenStreetMap street layer under the zones (dark-inverted in the dark theme). Zone outlines keep working without a network; the street layer needs one.
- Outlines for 452 of 453 geographic codes. 117 codes created after the 2015 boundary data reuse the outline of the codes they overlay (noted on the map when selected). 721 (Sint Maarten) has no outline.
- Prism liquid-glass interface ported to plain CSS, Auto/Light/Dark theme switch, keyboard shortcuts (`/` to search, `Esc` to clear or close), reduced-motion support.
- `scripts/build-data.mjs`: regenerates `assets/data.js` from Wikipedia (codes, regions, descriptions, dates, overlays) and Google libphonenumber (cities, time zones), with assertions on known codes.
- `scripts/build-map.mjs`: regenerates `assets/map-data.js` from the UCLA/NANPA 2015 boundaries (via 1ec5/nanp-boundaries) and Natural Earth for 867 (Yukon, Northwest Territories, Nunavut).
