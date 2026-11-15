# Current simplified rectangle flow

## Compact viewing controls

Sky tools start collapsed. The spectrum player keeps wavelength, Play/Pause
and the scrubber visible, with all range controls, band indicators and help in
a native expandable details section. The time player similarly keeps its
scrubber and playback controls visible and offers expandable thumbnails/help.
Settings stay mounted, so collapsing controls does not discard buffered data.

The persistent Hide tools/Show tools pill and H shortcut hide or restore the
search panel, source controls, players, sky slider and coordinate readout.
Playback, selected ranges, frames and the camera stay unchanged. The shortcut
ignores typing in fields, modifier shortcuts and held-key repeats. Escape also
restores hidden tools. Credits, map errors and active infrared preparation
progress remain visible. A spectrum preparation error opens its settings so
the error and retry controls are easy to find. Expanded player panels scroll
within the viewport on small screens.

## Rectangle modes: Time or Infrared

The region tool offers mutually exclusive Time and Infrared radio choices.
Infrared accepts large rectangles (up to a padded angular diameter of 170° to
stay within the TAN projection's hemisphere). Time keeps its 1° limit both in
the browser and on the archive API. Switching a large infrared rectangle to
Time explains that a smaller selection is needed and leaves its spectrum intact.
Drawing a rectangle starts the chosen mode; changing modes on an existing
rectangle keeps its geometry and replaces the active exploration. Time retains
the dated-observation pipeline. Infrared cancels and removes dated FITS frames,
loads only the SPHEREx mosaic in the locked crop, and hides the source/date
switcher and time filmstrip. It makes no observation search or cutout requests.

Infrared has a band strip, wavelength scrubber and Play/Pause button. Before
enabling playback or scrubbing, it prepares every selected wavelength for the
locked rectangle and shows the number of buffered bands. For each band it
waits for actual survey image downloads, response bodies, bitmap decoding,
cube-worker messages, and native rendering to settle, then captures a decoded
ImageBitmap. The intermediate loading tiles are covered by a canvas. Browser
network/decoder hooks exist only during preparation and are restored afterward.

Frame capture now copies the displayed Aladin image canvas directly, composited
onto opaque black, rather than round-tripping through the PNG export API.
Every playback/scrub redraw replaces the previous frame on opaque black before
drawing. This prevents transparent pixels accumulating brightness across frames.
Live and cropped SPHEREx layers explicitly share the same native PNG colormap,
linear 0–255 cuts, gamma, tone and non-additive blend settings. Pixel-compositing
regressions compare a transparent source against its cached display and repeat
it 100 times to verify brightness remains constant. The requested headless
browser comparison was not approved, so this change has no new WebGL screenshot
verification.
A centered loading card shows a spinner, progress bar, ready-band count,
percentage, and current wavelength. It appears during initial map setup too,
and disappears on completion, cancellation, or an error.

The From/To dropdowns use the release's actual wavelengths in micrometers.
Their inclusive interval can be set before drawing; the controls move into
the spectrum player when exploring a rectangle. The default is the full
range. Changing endpoints pauses playback and interrupts ongoing preparation;
`Prepare selected range` applies the interval without redrawing the rectangle.
Only its selected global channel indices are prepared, shown in the band strip,
scrubbed, and looped. Progress and preview memory sizing use the selected band
count. Reversed endpoints are rejected. An already cached interval is ready
immediately, and a single-band interval displays a still frame with Play disabled.
Time mode and the whole-sky wavelength slider remain independent.
The readiness tracker includes only HiPS tile and Allsky image paths, rather
than every request below the survey URL: optional MOC, preview and metadata
404s do not abort a spectrum. A required tile failure includes the actual URL
in the displayed error and console diagnostics.

The reported `_0.png` errors were real tile naming errors, not optional
metadata errors. IRSA serves plane zero as `NpixN.png`, without `_0`, while
planes 1–101 retain their suffixes. `hips-cube-tiles.mjs` normalizes only those
plane-zero tile/Allsky URLs for registered SPHEREx services, for both image and
fetch transports. It does not offset channel indices. `hips_cube_firstframe`
is an initial display preference, not a numbering offset. Live HEAD checks on
2026-11-15 confirmed `Npix89.png` and `Npix89_1.png` return 200 while
`Npix89_0.png` returns 404; the reported order-5 `Npix5716.png`, `_1.png` and
`_101.png` also return 200.

The official properties explicitly document zero-based frames 50 and 51 as
blank; live checks confirmed their PNGs are absent. Preparation represents
these as labelled "No archive data" frames and never requests their missing
tiles. This classification follows the explicit metadata, not arbitrary 404s.
The live sky slider also labels and hides these empty bands. All other missing
tiles remain preparation errors. Tests cover the reported URLs, all 102 frame
indices, hook composition, and blank-frame handling without reusing stale data.

Once every band is buffered, playback draws only these local frames at eight
frames per second. Scrubbing also draws cached frames. Neither operation
changes the native HiPS frequency, downloads tiles, or refits the camera.
Decoded previews preserve the rectangle aspect ratio and use a 96 MiB frame
pixel budget across all channels, with a maximum side of 1,024 pixels. This
limits preview resolution for very large views while keeping playback local.
The source science data and the full-resolution live sky map are unchanged.

Tile or capture errors keep Play disabled. Retrying preparation retains the
completed frames for the same region and capture dimensions. Leaving cancels
in-progress preparation; clearing the region or changing modes closes decoded
bitmaps. Cancellation also closes a capture that finishes late. A resize during
preparation cancels it and invalidates partial frames so a retry stays aligned.
Manual scrubbing, hiding the page, resizing, changing modes, clearing the
rectangle, and returning to the whole sky stop spectrum playback. The global
sky wavelength is preserved independently. Newly discovered map releases are
reported but deferred while an infrared region is active, to avoid changing
its cube during a sweep.

Controller and buffer tests cover rectangle dispatch, exclusive modes, full
preload gating, cached-only playback, asynchronous tile readiness, retries,
memory bounds, cancellation, looping, and bitmap cleanup.
Browser/WebGL appearance and tile loading have not been live verified.

## Sky wavelength slider

The whole-sky SPHEREx view has an infrared wavelength range slider. Its channel
count and wavelength labels come from the loaded release's `hips_cube_depth`
and `data_cube_crval3_arr`, with the existing initial selection near 3.293 µm.
Dragging switches the resident HiPS cube's frequency bin at most ten times per
second; releasing the slider commits the final band immediately. It does not
replace the layer, move the camera, or request observation FITS downloads.
Aladin fetches the selected plane's visible tiles directly from the survey.

The slider is hidden for Gaia and locked region comparisons. Its selection
survives switching sources and is preserved at the nearest compatible physical
wavelength when the official map release changes. A cached SPHEREx region
survey starts at the selected channel; Infrared mode can sweep it independently.
Dated FITS exposures, earlier/newer-date
queries, and time playback remain independent of the sky wavelength. The UI
explicitly states that dated observations use their usual bands.

Controller tests cover all 102 plane indices, metadata labels, rapid input,
camera/layer preservation, source switching, release upgrades, and independent
observation searches. Browser/WebGL interaction has not been live verified.

## Automatic archive updates

On opening the app and daily while the page is visible, the viewer checks
IRSA's official HiPS catalogue and the actual survey properties. There is no
manual refresh button or public cache-bypass parameter. A higher official SPHEREx DR cube is selected
only after its metadata confirms a full-sky PNG cube with a compatible 3.293 µm
channel; release labels and channel indices come from that metadata. URLs are
restricted to IRSA's HiPS services. The resolver caches checks for one day,
retains its last verified release during outages, and never downgrades to an
older release due to a temporarily stale catalogue. A failed map load restores
the prior survey. Future incompatible formats require viewer changes.

For a loaded region, the same check searches for up to ten newer UTC dates
after its newest loaded day, adding them to the filmstrip without changing the
selected frame or crop. Further checks continue from the latest loaded date;
failed downloads retain the batch anchor for retry. This keeps one image per
day and the same detector band. Older-date discovery is re-enabled after a
check to allow archive backfills. Existing frames are not replaced by later
reprocessing of the same date. Nothing polls while the page is closed.

Weekly images enter through IRSA's searchable observations, independently of
whole-sky releases; the app does not construct a whole-sky mosaic from them.
Discovery uses SIA `INSTRUMENT=SPHEREx` rather than fixed DR/QR collection names,
and permits official numbered DR/QR level-2 FITS paths. Availability depends on
IRSA publishing and indexing the data. Search results remain capped at 1,000
records. Future DR2 discovery and failure handling are tested with synthetic
release metadata; browser/WebGL upgrades have not been live verified.

## Discovery coverage

Initial discovery now asks for up to 1,000 records and chooses the newest usable
returned exposure covering the selected center. This replaces the arbitrary
first-row/MAXREC=1 choice, which could start the earlier-date search too far
back. All searchable SPHEREx collections participate through the instrument
filter, including newly published releases. A capped response cannot prove
global newestness.

Earlier-date searches include searchable wide/deep collections. Per
https://irsa.ipac.caltech.edu/spherex-archive-documentation/spherex-data-access/,
the `_deep` collections contain additional spectral image coverage omitted by
the earlier wide-only queries. History responses include counts of matching
same-band exposures and distinct UTC dates within the returned rows. The UI
shows those counts and explicitly describes one-image-per-day/same-band filters.
These searches have not been live verified during this coverage investigation.

## Observation filmstrip

Play/Pause loops resident observations at four frames per second. Starting from
the newest frame begins at the oldest date; starting elsewhere continues from
the current frame. Playback uses animation-frame timing, avoids catch-up bursts
after slow frames, and never refits the camera or downloads additional images.
Manual scrubbing/source changes, leaving or clearing the region, a hidden tab,
and a changed set of loaded dates pause it. Play is disabled with fewer than two
observations. The filmstrip's visual transition respects reduced-motion settings.
Controller tests verify timing, wraparound, pause conditions, and zero additional
downloads/camera refits. Browser playback has not been live verified.

The locked region now has a camera-roll-style filmstrip, ordered oldest to
newest. Drag the thumbnails or the native range slider to switch resident
observation frames. Keyboard arrows also work on the slider. The fixed playhead
and UTC date/count identify the selected frame. With only one observation, the
slider is disabled and the UI prompts the user to load earlier dates.

Scrubbing changes layer visibility synchronously, without downloads or camera
refits. Returning from whole-sky browsing still fits the selected region once.
Thumbnails are display-only, letterboxed previews of the downloaded FITS pixel
array using the image's display cuts; they retain detector orientation while
the main viewer uses celestial WCS. FITS arrays remain unchanged. Clearing a
region removes the filmstrip and cancels its active drag. Existing source/date
tabs synchronize with the filmstrip; multiple date tabs are visually replaced
by the filmstrip once more than one observation is available.

Controller tests cover chronological order, fast successive inputs, pointer
dragging from a survey, no extra requests/camera refits, and region cleanup.
Preview tests use synthetic values and a genuine SPHEREx fixture. Browser
appearance and interaction have not been live verified in this session.

## Earlier observation dates

After the first observation loads, `Load 10 earlier dates` searches for up to
ten distinct UTC dates before that displayed observation's UTC day. Survey
tabs use the initial observation as the anchor. The action keeps the current
image, requires the same SPHEREx detector band, and checks center coverage.
Earlier dates appear as individual tabs without changing the selected crop.
After a completed batch, the button becomes `Load 10 more dates` and searches
before the oldest date in that batch. Requests can continue farther back;
there is no eleven-image session limit. Existing frames remain resident and
the filmstrip/playback includes all loaded dates. Adding dates pauses playback
and preserves the displayed image.

The new `mode=history` API uses SIA `TIME=-Inf <anchor-midnight-MJD>` and the
SPHEREx instrument filter. IRSA's TIME format is documented at
https://irsa.ipac.caltech.edu/ibe/sia.html. Results are capped at 1,000 rows;
the selector chooses the newest distinct dates within those returned rows,
not a proven global latest-ten result. The UI reports a capped search.

Downloads are serial. A failed date does not discard other loaded dates; retry
skips successful downloads and retains that batch's original search anchor.
The cursor advances only after the batch completes. A complete, uncapped result
with fewer than ten dates marks the earlier-date search exhausted and disables
the button; capped results are not treated as proof of exhaustion. Clearing the
region aborts the client operation and removes its layers/blob URLs.
Same detector band does not guarantee identical per-pixel wavelengths.

Backend and browser-controller tests cover the new flow, including UTC bounds,
same-band selection, capped results, two-digit tab indices, partial failures,
multiple successive batches, retry cursor preservation, and cancellation.
This flow has not been live archive/browser verified.

## Grey observation display investigation

The placement error is now reproduced and corrected in the native dependency.
Aladin Lite 3.8.2's embedded `mapproj::sip::SipCoeff::p` evaluator starts powers
at x/y and repeatedly squares them rather than evaluating ordinary SIP powers
from exponent zero. The unmodified native WCS reproduces the user's reported
RA/Dec exactly. Converting PC to CD, removing inverse SIP coefficients, and
omitting redundant pole keywords did not correct it; these are not app fixes.

The app now serves a pinned local Aladin bundle with this single evaluator
corrected. See `vendor/README.md` and `scripts/patch-aladin-sip.cjs` for the
reproduction and source hash guard. The actual corrected WASM decodes the
reported image center to [60.44195531414003, 54.5404773655837] and matches
independent TAN-SIP equations at its center and all four corners. The science
pixel hash remains identical to the user's download. Native checks also place
both older D4 fixtures near their expected target. Browser/WebGL rendering is
still unverified; this verification executes the pinned native coordinate code
directly in Node, without a browser or live archive during tests.

Restart `npm start` to enable the new local dependency route, then refresh the
page and select a region again.

The user's subsequent display event confirms a sky-placement mismatch, not a
successful render: imageCenter = [73.27156451746073, -34.11285165393297], while
viewCenter = [60.44222703421171, 54.54087028244997]. Opacity was 1 and the cuts
were [0.22970916330814362, 4.662294387817383]. The image is about 89 degrees
from the selected region. The exact cutout was subsequently downloaded and its
pixel hash matched the user's log, enabling the reproduction described above.

The controller now rejects this mismatch during decoding, before declaring
readiness, using spherical separation and a generous limit based on cutout size
and decoded FoV. It never moves the camera to the incorrect image center.
Regression checks use the reported values and cover RA wraparound and poles.
Server FITS inspection logs now include primary celestial WCS and SIP cards.

The single-image viewer now uses Aladin's automatic image cuts instead of a
fixed 0–40 MJy/sr range. The search accepts any detector, so that fixed range
can hide contrast in a valid downloaded image. The image starts opaque, and
the region is refitted after registration. Crop measurements wait for render
frames after zoom changes and reject invalid projected bounds. Cancellation
prevents an obsolete fit from changing the current crop.

The ready message is set after the display checks; a display exception clears
readiness and removes the failed layer. These checks validate registration and
opacity, not the actual rendered science pixels. Aladin 3.8.2's standalone FITS
readPixel method is unimplemented, so diagnostics now record image/view centers,
FoVs, cuts, and crop bounds instead of misleading null pixel probes.

The original controller tests covered fit timing, cancellation, invalid
projection, automatic cuts, and display failure cleanup. Those tests alone did
not identify the grey-screen cause; the native SIP reproduction above later
confirmed it. Browser rendering remains unverified.

Drawing a rectangle now requests mode=single and loads just one available SPHEREx
image. This is the default on the normal localhost URL; old observationTest URL
flags do not select async searching in the current frontend.

The search uses the rectangle center, one release group at a time, MAXREC=1000
and no wavelength/date constraint. It sorts returned rows by newest observation
time and verifies that the returned
footprint contains that center, so the image overlaps the selected rectangle.
QR3 wide/deep is queried first; DR1 wide/deep is checked only if QR3 returns no usable match. A failed
HTTP request is not retried against another collection. The original search budget
is shared across the possible two requests. One FITS file is downloaded, with its
science IMAGE extension displayed at its original celestial coordinates. Coverage
of the entire rectangle is not guaranteed.

A previously captured independent QR3 point search at the retained fixture target
returned 19 real matching D4 images in 0.946 seconds. That historical result does
not verify the latest discovery changes or establish coverage at other targets.
Backend and mocked viewer checks are not real-browser rendering verification.
Legacy pair and async backend helpers remain available for later work but are not
called by the simplified rectangle action.

---

# SPHEREx observation diagnostics

The existing map, rectangle selection and comparison viewer are retained. Normal rectangle searches and FITS decoding keep their 90-second limits;
cutout downloads keep the 105-second browser limit. Point-test discovery now uses
asynchronous TAP with a 150-second overall job budget and at most 20 seconds per
TAP HTTP request. Only the point-test browser search wait is 195 seconds.

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
queried asynchronously with the documented `spherex.artifact` / `spherex.plane` TAP join and
`CONTAINS(POINT(...), p.poly)`. Cutouts are 0.05 degrees wide, so this mode does NOT
provide full-rectangle coverage. The existing status message identifies it.

`tap-async.js` creates one job using POST and a manual redirect, validates the job
Location, checks its phase, sends PHASE=RUN only if PENDING, polls while queued or
executing, and retrieves /results/result after COMPLETED. It requests the documented
CSV format and normalizes the result for the existing selector. Each failure names
creation, start, phase polling, execution, or result retrieval; an ERROR phase also
retrieves /error. A failed submission is not retried or silently replaced by sync.

UTC day selection now uses an explicit calendar conversion, with midnight/noon
boundary tests. MJD itself starts at midnight: the pasted review's claim that it
starts at noon confuses MJD with JD. No half-day shift is introduced.
https://www.nist.gov/pml/time-and-frequency-division/timekeeping-and-clocks-faqs

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
are also serial while diagnosing. Failed submissions and image downloads are not automatically retried. The longer point-search browser wait accommodates
the async job budget; cutout and decoder waits have not increased.

Output includes the search result, original multi-extension FITS, an IMAGE-only
FITS for display, and an extension/pixel summary. The IMAGE-only FITS preserves
all science-array bytes, spatial WCS and units. It removes unrelated image arrays
and calibration tables from the viewer input, not from the source archive file.
This avoids depending on HDU-selection APIs absent from pinned Aladin Lite 3.8.2.

Run checks with:

    node --test

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

## Async live check: 2026-11-14

- Exact published M101/D2 SQL, including its URI expression, ascending order, and
  no TOP limit, was tested independently with documented FORMAT=CSV.
- GET https://irsa.ipac.caltech.edu/TAP/sync: HTTP 502 in 0.410 seconds.
  Error page: "The proxy server received an invalid response from an upstream
  server"; reason: "Error reading from remote server".
- POST https://irsa.ipac.caltech.edu/TAP/async: HTTP 303 in 1.433 seconds,
  Location https://irsa.ipac.caltech.edu/TAP/async/28314983.
- GET https://irsa.ipac.caltech.edu/TAP/async/28314983/phase: HTTP 502 in
  0.422 seconds with the same proxy error. Testing stopped there. Submission is
  confirmed; execution state and result retrieval remain unknown. No duplicate job
  was submitted after that failure.
- The application still uses the same spatial join but selects raw artifact URIs,
  D4 instead of the tutorial's D2, newest-first ordering, and TOP 200. These
  differences are recorded, not asserted to cause the gateway failures.
- A second genuine QR3 D4 cutout at the previously verified target downloaded:
  HTTP 200 in 3.651 seconds, 3,962,880 bytes.
- test/fixtures/spherex contains IMAGE-only diagnostic fixtures for the same
  0.05-degree sky region. Their FITS headers identify the actual observations as
  2026-08-25T07:03:31.518Z and 2026-09-02T10:36:30.731Z. The manifest records archive
  URLs, raw-file hashes, and science-pixel hashes. These are real cached data, not
  successful live-discovery results or simulated images. The original first MEF
  remains preserved at /private/tmp/planetx-pipeline-debug/one-cutout.fits.
- Twenty tests pass, including async lifecycle and failure-stage checks, UTC
  boundaries, FITS integrity, and the genuine fixture timestamps and hashes.

## Transient status-read errors

A user log subsequently showed job 28315580 accepted with HTTP 303 and six
successful QUEUED status responses, followed by one HTTP 502 on /phase. That
response does not establish that execution itself failed. Phase polling now allows
at most two extra GETs for HTTP 502/503/504, spaced 3 then 6 seconds apart by
default, on the same job and within the original 150-second budget. This is a total
retry limit per job, not a counter reset after every successful status read.
Submission, RUN, result retrieval, other HTTP errors and transport timeouts are
not automatically retried. Persistent failures include the existing job URL.
Mock tests verify transient recovery and the persistent-failure bound; a live
recovery has not yet been verified.
