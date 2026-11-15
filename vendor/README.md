# Aladin Lite 3.8.2 SIP correction

`aladin-lite-3.8.2.js` is the bundled Aladin Lite 3.8.2 distribution from
https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.js, with one local
correction to the embedded WebAssembly SIP polynomial evaluator. The original
bundle's SHA-256 is
`bed9c8ef1d1e83501b1cb782366092c72c5ecd1c88f16fef3166188ae8062066`.

Aladin Lite is copyright CDS/Unistra and distributed under LGPL-3.0-or-later.
Upstream source and license: https://github.com/cds-astro/aladin-lite/tree/v3.8.2.
The local modification is documented and reproducible in
`scripts/patch-aladin-sip.cjs`. It refuses inputs that do not match the pinned
bundle. No other dependency code is changed.

The original native `mapproj::sip::SipCoeff::p` starts powers at x and y and
repeatedly squares them. SIP requires x^i y^j, starting at exponent zero and
advancing by multiplication by x and y. The correction preserves its loops,
coefficient storage, and bounds checks; it adds an x-power local and corrects
the initial values and increments.

The retained real D2 cutout in `test/fixtures/spherex/2026-09-22-image.fits`
reproduces the reported error exactly. Its original decoding places its center
at RA 73.27156451746073°, Dec -34.11285165393297°, rather than near the requested
RA 60.44222703421171°, Dec +54.54087028244997°.

Original archive file:
https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/2026W39_1A/l2b-v27-2026-268/2/level2_2026W39_1A_0413_1D2_spx_l2b-v27-2026-268.fits

Cutout parameters: `center=60.442227034211726,54.540870282449944`,
`size=0.36469300135998406`, `gzip=false`.
The fixture is its IMAGE-only representation with all science pixel bytes
unchanged. Pixel SHA-256:
`ef55acc371f8432a6f6894aecf7e60dea3c4ea629414c0c25b9bec3e8807335e`.

`test/aladin-sip.test.cjs` executes the actual corrected WASM in Node with
test-only WCS exports. It tests polynomial powers and compares the real image's
center and corners against independent TAN-SIP equations. This requires neither
a browser nor archive access. It verifies coordinate decoding, not WebGL output.

To reproduce the dependency change after downloading the original distribution:

```
node scripts/patch-aladin-sip.cjs original-aladin.js vendor/aladin-lite-3.8.2.js
node --test
```

The application also compensates for the pinned renderer's plane-zero HiPS
cube filenames through `hips-cube-tiles.mjs`. This does not modify the vendor
bundle: registered SPHEREx requests for `NpixN_0.png` become `NpixN.png`, while
other band suffixes stay unchanged. See `test/hips-cube-tiles.test.mjs` and
`OBSERVATION_DEBUG.md` for the archive checks and documented empty-band handling.
