# Current change: SPHEREx instrument scope only

SIA requests now send `INSTRUMENT=SPHEREx` instead of named COLLECTION
parameters. The initial search makes one SPHEREx request rather than preferring
QR3 then trying DR1. The restored center position, date/band selection, image
loading, timeouts and per-request limits remain. There is no discovery lookup,
new API mode or alternate search system. The instrument value is present in
the previously saved official IRSA service metadata. No live success is claimed.
The earlier exact working baseline remains available for backtracking.

# Restored working checkpoint

The browser and observation backend match the user's supplied working source
attachments byte for byte. Time uses the original center search and release
sequence, loads one initial image, and requests earlier same-band dates in
batches of ten. New collection discovery, global database timeline, polygon
search and wavelength linking have been removed. Other mission tabs, infrared
view and existing hide controls remain as in that supplied version.

This is a source restoration, not a verified live archive recovery.

# Current simplified rectangle flow

## Hide observation dates from the timeline

Each Time-filmstrip thumbnail has a keyboard-accessible × button labelled
with its UTC date. Hiding a date removes it from the scrubber, thumbnail strip,
date buttons and playback sequence. The science image, layer, thumbnail and
download reference remain loaded. Hidden dates can be restored individually
or together from the Hidden dates section below the strip.

Changing the included dates pauses playback. Hiding the displayed image shows
the next remaining chronological image, or the preceding one at the end of
the sequence. If every date is hidden, playback and scrubbing are disabled,
the observation layer is hidden, and the filmstrip remains open with restore
controls. Restoring the first visible date displays it; otherwise restoration
preserves the current frame. Counts and chronological positions describe the
included dates only. Direct attempts to select an excluded date are ignored.

Exclusions belong to the currently loaded region's observation set. They
survive additional history downloads and source switching, and reset when
that set is reloaded or the region is cleared. They never change the search
anchor, original metadata, FITS bytes or sky coordinates. No extra image
downloads or camera fitting are needed to hide or restore a date.

Thumbnail-button pointer events bypass filmstrip dragging. A ResizeObserver
positions the source switcher and messages above the player's actual height,
including the restore controls. All 130 Node tests pass, including skipped
playback/scrub frames, hiding the current/last/all frames, individual and bulk
restore, retained images, history and reset behavior, and pointer isolation.

## Time search: restore collection-scoped IRSA queries

The user reported HTTP 502 at `IRSA single-image search`, before FITS download,
at multiple positions. Local history shows that `e3589fb` explicitly scopes
SIA searches to QR3/DR1 wide/deep collections, whereas `91a758c` removed those
constraints in favor of `INSTRUMENT=SPHEREx`. IRSA's current SPHEREx guide says
users must supply COLLECTION:
https://irsa.ipac.caltech.edu/spherex-archive-documentation/spherex-data-access/.

The collection-scoped approach is restored. Single-image discovery searches
`spherex_qr3` and `spherex_qr3_deep`, then `spherex_dr1` and
`spherex_dr1_deep` only after a valid QR3 response with no usable image. Each
response is capped at 1,000 records; the newest usable returned image is
selected, within a shared 90-second budget. Earlier/newer-date searches and
legacy rectangle searches explicitly include all four image collections.
The whole-sky map resolver remains independent and still discovers newer
compatible published maps. Future spectral-image releases require updating
the collection list or adding verified collection discovery.

An HTTP failure still stops the search, preserving the actual failure instead
of silently treating it as an empty result. All 125 Node tests pass, including
collection scopes, latest returned selection, empty-result DR1 fallback,
UTC history bounds and stopping on gateway errors. The direct live search
reproduction was not approved, so disappearance of the reported 502 has not
been verified. Restart the Node server to load this backend change.

## Observation dates and latest SPHEREx reference

A persistent date panel shows the current view's observation time or survey
observation range in UTC. Compare dates expands the four survey ranges,
SPHEREx release-check state and current map publication date. Observation
dates and map publication dates are explicitly separate. The panel remains
visible when tools are hidden; on narrow screens it yields to expanded Sky
tools to avoid covering the settings.

`survey-dates.mjs` reads valid `t_min`/`t_max` MJD bounds from the actual map
metadata. For the identified Gaia DR3 RGB map, which omits these fields, it
uses the documented 2014-07-25 to 2017-05-28 DR3 observation interval and links
to ESA's DR3 documentation. That fallback is restricted to the DR3 dataset;
other releases need their own real metadata. Unknown or invalid ranges are
labelled unavailable, never inferred from a publication date. A selected
dated SPHEREx frame displays its exact `observedStart` timestamp.

The reference is always the latest verified compatible SPHEREx whole-sky
release discovered by the existing startup/daily release checks. It remains
the reference while another source or an older manually selected exposure is
displayed. A failed/stale check or an advertised incompatible newer map is
labelled, rather than claiming the retained image is the latest. Reference
date comparisons update when the verified SPHEREx metadata changes.

Gaia DR3 (2014–2017) and DSS2 (1975–1999) have no selectable SPHEREx-era map
epochs. Their current available maps are retained with a historical/no-match
message, not retimed, interpolated or replaced with an unrelated satellite.
Even overlapping survey coverage intervals are not claimed to be the same
observation date; combined maps can mix epochs within their footprint. This
does not add an epoch-selection API or discovery of future Gaia data releases.

All 119 Node tests pass, including UTC conversion, missing/invalid bounds,
Gaia date provenance, publication/observation separation, explicit epoch gaps,
selected exposure dates, stale checks and reference updates after a new map.
Restart the server to enable `/survey-dates.mjs`, then refresh the page.

## WISE color comparison

The WISE tab uses NASA/IPAC IRSA's published color HiPS service:
`https://irsa.ipac.caltech.edu/data/hips/CDS/AllWISE/RGB-W4-W2-W1`.
It validates the `ivo://CDS/P/allWISE/color` dataset identity, equatorial image
geometry, color product and JPEG format. Metadata is revalidated when the
tab is selected. Only this WISE color composite is added; no NEOWISE
Reactivation or time-series endpoint is queried.

The assigned infrared colors are red W4 (22 µm), green W2 (4.6 µm) and blue
W1 (3.4 µm). Whole-sky switches preserve RA/Dec, field of view and rotation.
An active Time rectangle keeps the same viewer and exact crop, and can return
to its previously loaded SPHEREx frames. SPHEREx-only controls are inactive
in WISE. Returning from whole-sky navigation does not reopen an old crop.

The date panel shows IRSA's numeric MJD bounds for this map: 55378–55414,
or 2010-07-01 to 2010-08-06 UTC, separately from its 2019-05-20 publication
date. These are the bounds supplied for this archive visualization, not the
dates of newer NEOWISE products or the lifetime of the spacecraft. The map
is labelled as a historical comparison with SPHEREx.

Live checks on 2026-11-15 returned HTTP 200 for the properties and real tiles
`Norder0/Dir0/Npix0.jpg` and `Norder2/Dir0/Npix159.jpg`. The properties and
tile responses allow cross-origin access. Official source listing:
https://irsa.ipac.caltech.edu/data/hips/list.

All 124 Node tests pass, including view/crop preservation, map identity and
error restoration, metadata revalidation, observation-date display and the
absence of NEOWISE requests. Browser/WebGL appearance remains unverified.

## DSS2 Color comparison

The DSS2 Color tab uses the MAST/STScI mirror explicitly listed by CDS:
`https://stpubdata.s3.us-east-1.amazonaws.com/mast/skybackgrounds/DSSColor`.
Reference: https://aladin.cds.unistra.fr/ (official HiPS alternatives list).
It replaces the survey in the same whole-sky Aladin viewer, without changing
ICRS position, zoom, rotation or projection. In an active Time rectangle it
uses the same comparison viewer and exact crop. Leaving the rectangle and
browsing elsewhere does not cause a later DSS2/SPHEREx switch to reopen the
old crop. Loaded dated observations remain available when returning to Time.
Gaia retains its separately restored original loading path.

Every DSS2 selection fetches/revalidates live `/properties` metadata with
`cache: 'no-cache'`; no map release is bundled or pinned. It verifies the
`ivo://CDS/P/DSS2/color` identifier, equatorial image geometry, color product
and JPEG format. Aladin then loads the survey's own format and coordinate
metadata. The published map date is included in the credit tooltip. DSS2 is
historical photographic imagery from 1975–1999, not current observations.
The About DSS2 Color disclosure explains this distinction. SPHEREx observation
loading, history, wavelength and region drawing controls are inactive in DSS2;
Back to whole sky remains available in a locked comparison.

Live checks on 2026-11-15 returned HTTP 200 for MAST's properties and real
`Norder0/Dir0/Npix0.jpg` and `Norder2/Dir0/Npix159.jpg` tiles. An Origin request
also confirmed `Access-Control-Allow-Origin: *` for the metadata endpoint.
The metadata reports map release `2019-05-07T10:55Z`; S3 reports a properties
object Last-Modified date of 2026-03-12. These are publication/storage dates,
not observation epochs. No alternative host is used automatically.

All 112 Node tests pass, including whole-sky camera preservation at ordinary,
RA-wrap and polar positions; exact crop preservation; returning from an old
selection; live metadata revalidation; dataset rejection; failure restoration;
and retained observation frames. The Chrome rendering check was not approved,
so actual browser/WebGL appearance remains unverified.

## Gaia DR3 comparison

Gaia uses the loading and switching path from the user's supplied older code.
The app fetches `https://skies.esac.esa.int/Gaia/dr3/RGB/properties` with a
15-second timeout and normal browser caching, validates the DR3 identifier,
and remembers successful metadata for the session. It passes only the survey
name and success/error callbacks to `A.HiPS`, letting Aladin retrieve and
interpret the survey's live metadata. `skyMap.setBaseImageLayer` replaces the
base layer in the same viewer, preserving its ICRS position, zoom and rotation.

Gaia exits the locked region view, as in the older implementation. Returning
to SPHEREx restores the whole-sky base layer; previously loaded observations
can still be reopened through their date controls. SPHEREx keeps its newer
wavelength, region and playback features. Its exploration tools are hidden in
Gaia. Infrared playback keeps its exclusive SPHEREx view.

The bundled Gaia metadata, private parser call, background preload, and
visibility-only whole-sky layer cache have been removed. No alternative host
or satellite is used. Tests cover the original HiPS options, normal metadata
fetch caching, unchanged coordinates, metadata timeout/retry, prior-survey
restoration and returning to retained observations. The user's console showed
ESA tile connection timeouts; restoring the older code cannot guarantee ESA
availability. Live tile delivery has not been reverified.

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
Both modes accept large rectangles (up to a padded angular diameter of 170° to
stay within the TAN projection's hemisphere), in the browser and on the archive
APIs. Large infrared rectangles can switch directly to Time. Time still searches
at the region center and displays individual exposures; a larger selection does
not create a mosaic or add observations away from the center. Individual
exposures may cover only a small part of a large region.
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

The slider is hidden for locked region comparisons. Its selection
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
Observation discovery uses the four documented DR1/QR3 wide/deep COLLECTION
names and permits official numbered DR/QR level-2 FITS paths. Availability
depends on IRSA publishing and indexing the data. Search results remain capped
at 1,000 records. Future whole-sky DR2 discovery and failure handling are tested
with synthetic map metadata; browser/WebGL upgrades have not been live verified.

## Discovery coverage

Initial discovery now asks for up to 1,000 records and chooses the newest usable
returned exposure covering the selected center. This replaces the arbitrary
first-row/MAXREC=1 choice, which could start the earlier-date search too far
back. The documented QR3 wide/deep collections are searched first, with DR1
wide/deep used after an empty usable QR3 result. A capped response cannot
prove global newestness.

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
four documented SPHEREx image collections. IRSA's TIME format is documented at
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
