# SPHEREx observation diagnostics

The existing map, rectangle selection and comparison viewer are retained. Timeout
limits remain 90 seconds in the Node archive requests and decoder, and 105 seconds
in browser network requests.

## Reading failures

The terminal logs `[Planet X archive]` JSON events. The browser console logs
`[Planet X observations]` events. A request ID links search and image events.
Logs include public request URLs (credential-like query parameters are redacted),
HTTP status when a response exists, elapsed time, returned record count, upstream
FITS bytes, image dimensions/extensions, and exceptions. A timeout with status
`null` means that no HTTP response arrived before the limit.

Browser events distinguish FITS decoding, image registration, and the subsequent
visible render frame. Pixel probes can be null in uncovered parts of a rectangle;
registration alone is not proof that a scientifically useful image is visible.

## Controlled center-point test

Start/restart the existing server with `npm start`, then open:

    http://localhost:8000/?observationTest=point

Draw a rectangle using the existing tool. In this diagnostic mode its center is
queried with the documented `spherex.artifact` / `spherex.plane` TAP join and
`CONTAINS(POINT(...), p.poly)`. Cutouts are 0.05 degrees wide, so this mode does NOT
provide full-rectangle coverage. The existing status message identifies it.

Use the normal URL to retain the full-rectangle polygon-overlap workflow:

    http://localhost:8000/

That workflow reports each exposure's footprint coverage as full or partial/unknown.
Black regions are not filled with unrelated data. Searches are capped at 200 rows;
"newest two UTC dates" refers to the returned rows, not a proven global latest date.
Both modes keep detector D4 for this controlled first comparison. Its wavelength
varies across the detector, so appearance changes alone are not evidence of motion.

## Search and ONE download without a browser

No additional packages are needed:

    node scripts/check-spherex.cjs --ra 269.4520769586 --dec 4.6933649666 --mode point --download 1 --out /private/tmp/planetx-barnard-check

`--download 0` tests only the search. `--download 1` downloads one image after the
search succeeds. `--download 2` downloads both serially. Downloads in the website
are also serial while diagnosing. There is no automatic retry or timeout increase.

Output includes the search result, original multi-extension FITS, an IMAGE-only
FITS for display, and an extension/pixel summary. The IMAGE-only FITS preserves
all science-array bytes, spatial WCS and units. It removes unrelated image arrays
and calibration tables from the viewer input, not from the source archive file.
This avoids depending on HDU-selection APIs absent from pinned Aladin Lite 3.8.2.

Run checks with:

    node --test test/sky-region.test.mjs

## Live investigation: 2026-11-14

- User-reported failure: IRSA observation search timed out after 90 seconds.
- Static SPHEREx survey properties: HTTP 200 in 0.46 seconds.
- TAP point search at the tutorial's M101 location, D4, GET: no HTTP response in
  90.00 seconds. An independent POST of the tutorial's original D2 query also
  returned no HTTP response within 90.00 seconds. TCP/TLS completed promptly.
- A previously identified, real QR3 D4 exposure downloaded as a 0.05-degree cutout:
  HTTP 200 in 6.56 seconds; 3,962,880 bytes. The IMAGE extension is 29 x 29 float32
  pixels, 839 finite values, with TAN-SIP celestial WCS. Repackaged display file:
  28,800 bytes; science pixel bytes are identical.
- These results identify search as the observed failing stage. They do not prove
  why IRSA did not answer the queries, or establish an archive-wide outage.
- Live browser decoding/rendering was not verified because browser permission was
  declined. No end-to-end success claim is made.

Official references:
https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts/
https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access/
https://irsa.ipac.caltech.edu/docs/program_interface/TAP.html
https://github.com/cds-astro/aladin-lite/blob/v3.8.2/src/js/Image.js
https://github.com/cds-astro/aladin-lite/blob/v3.8.2/src/core/al-core/src/image/fits.rs
