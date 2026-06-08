# tests/fixtures/

Sample RAW files used for manual decode testing (Phase 4.3).

Binary RAW files are **not committed to git** — they are excluded by the
`.gitignore` in this directory. Run the download script after cloning:

```bash
npm run download-fixtures
```

Then run the decode test:

```bash
npm run test:raw
```

---

## What's in this directory

| Path                                       | Contents                                                 |
| ------------------------------------------ | -------------------------------------------------------- |
| `tests/fixtures/*.{cr3,nef,arw,raf,dng,…}` | RAW fixture files (git-ignored)                          |
| `tests/fixtures/output/`                   | Decoded JPEG output — written by `test:raw`, git-ignored |
| `tests/fixtures/README.md`                 | This file                                                |
| `tests/fixtures/.gitignore`                | Excludes binaries and output from git                    |

---

## Populating fixtures manually

If the download script fails (e.g. `raw.pixls.us` is unreachable), drop your
own RAW files directly into this folder. Any filename works — the test script
picks up all files matching the supported extensions.

**One file per camera brand is sufficient for a first-pass test:**

| Brand     | Format | Where to get a sample                                                            |
| --------- | ------ | -------------------------------------------------------------------------------- |
| Canon     | `.cr3` | Shoot with any Canon R-series; or browse [raw.pixls.us](https://raw.pixls.us)    |
| Nikon     | `.nef` | Shoot with any Nikon Z/D-series; or browse [raw.pixls.us](https://raw.pixls.us)  |
| Sony      | `.arw` | Shoot with any Sony Alpha; or browse [raw.pixls.us](https://raw.pixls.us)        |
| Fujifilm  | `.raf` | Shoot with any Fuji X/GFX-series; or browse [raw.pixls.us](https://raw.pixls.us) |
| Adobe DNG | `.dng` | Any camera using Adobe DNG; Leica, Pentax, Ricoh, many phones                    |

Older formats (`.cr2`, `.nrw`, `.sr2`, `.orf`, `.rw2`, `.pef`, `.3fr`) can be
tested the same way — just drop the file in.

---

## Visual inspection checklist

After running `npm run test:raw`, open the output JPEGs in any viewer
(`tests/fixtures/output/`) and verify:

- **Colours look correct** — no strong green or magenta cast that shouldn't be there
- **No corruption** — no banding, no solid-colour blocks, no half-decoded tiles
- **Correct orientation** — portrait images are upright (EXIF rotation applied)
- **Reasonable exposure** — not clipped pure-white or solid-black (some test shots may be under/overexposed by design — use judgement)
- **Full resolution** — output should be the camera's native sensor resolution, not a small thumbnail

If any of these fail, check the error output from `npm run test:raw` first.
Most failures are caused by the native addon not being built (`npm run postinstall`).

---

## CC0 licence

All files downloaded by `npm run download-fixtures` are sourced from
[raw.pixls.us](https://raw.pixls.us), which hosts RAW samples released under
the [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
public domain dedication by their respective donors.

Files you add from your own camera are yours — store them here as needed for
local testing. Do not commit personal photos to the repository.
