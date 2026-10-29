# Terrazur

Which **Paris café and bar terraces are in the sun**, now and later today, and for how long.

👉 **Live: https://remimeynadier.github.io/terrazur/** (français / English: toggle in the header, or `?lang=fr` / `?lang=en`)

Four steps, nothing else: **where** (around me, or one of the 80 quartiers), **when** (now, in 1 or 2 hours, another
time), the **terraces in the sun** and how long it lasts, and, once there, **is it really in the sun?** Those on-site
answers are stored with what the model predicted, to score it and improve it.

A terrace is in the sun when two things hold: the sun is above the buildings and trees around it, and no cloud
hides it. Terrazur computes both.

## How it works

| Step | How |
|---|---|
| **Terraces** | The City of Paris's list of authorised terraces ([open data](https://opendata.paris.fr/explore/dataset/terrasses-autorisations/), ~16,600 open terraces and summer terraces, with position, length and width). Closed terraces and shop displays are left out. Each one is laid out as a rectangle along the nearest facade ([IGN BD TOPO](https://geoservices.ign.fr/bdtopo) buildings) and tagged with its [quartier](https://opendata.paris.fr/explore/dataset/quartier_paris/). |
| **Obstacles** | [IGN LiDAR HD](https://geoservices.ign.fr/lidarhd) surface model at 50 cm (buildings, trees, everything above ground) and terrain model for the ground level. |
| **Horizons** | For three points along each terrace, at a seated person's shoulders (1.1 m), rays are cast in every direction from 45° to 315° (1° steps) up to 400 m, and the elevation angle of the highest obstacle is kept: once with all obstacles, once with buildings only (the difference is tree shade). Fine 50 cm steps near the terrace, max-pooled 1 m and 2 m grids further out, so thin tall features are not skipped. The terrace itself (umbrellas, awnings at survey time) is ignored. |
| **Sun** | Exact solar position (NOAA algorithm, atmospheric refraction included) every 5 minutes, compared with the horizons: share of the terrace in the sun, in tree shade, in building shade. Valid for any date. |
| **Clouds, next hour** | [EUMETSAT](https://view.eumetsat.int/) MTG-I visible images (0.6 µm, 500 m, every 10 min). Brightness is turned into a cloud index (calibrated against satellite-derived direct sunlight), the cloud motion is measured between images 20 minutes apart, and the latest image is moved along it. The cloud that matters is looked up where the line of sight to the sun crosses the cloud layer, shifted by the satellite's parallax (~1.5 × cloud height to the north in Paris). |
| **Clouds, later** | [Open-Meteo](https://open-meteo.com/) 15-minute direct normal irradiance (Météo-France AROME): sunny when ≥ 120 W/m² (WMO definition). Blended with the satellite between 1 and 2 hours ahead. Cloud layers set the cloud height used above. |

The horizons need ~430 LiDAR tiles and take ~20 minutes to compute, so they are not rebuilt on every deploy:
`.github/workflows/horizons.yml` runs monthly (and on demand) and publishes them on the `data` branch, which the
app reads from raw.githubusercontent.com. The app itself is static (GitHub Pages) and does everything else in the
browser.

## On-site checks

Each answer (sun / partly / shade / cloudy) is saved with the terrace, the time, the predicted state, the share of
the terrace in the sun's geometry, the satellite's and the model's chance of sun, and the user's position when they
used "Around me". Answers wait in an outbox on the phone (`localStorage`) and are sent as a JSON POST to
`VITE_FEEDBACK_URL` once that build variable is set (for example a Google Apps Script web app writing to a
spreadsheet, or a Supabase table). Until then they stay on the device.

## Development

```bash
npm install
npm run dev
npm test
npm run lint
npm run build

# Horizons (Python 3 with numpy and Pillow; ~1 GB of cache)
python3 scripts/build_horizons.py out --cache cache                      # all of Paris
python3 scripts/build_horizons.py out --cache cache --near 2.3497,48.8443  # 1 km around a point
```

To use locally built horizons, copy `out/` to `public/data/` and put `VITE_DATA_URL=/terrazur/data` in
`.env.local`.

## Structure

```
scripts/
  build_horizons.py     terraces, LiDAR, buildings → horizons (the heavy part)
  lambert93.py          WGS84 ↔ Lambert-93 (IGN formulas)
  sun.py                solar position (same algorithm as the app)
src/
  i18n.ts               French / English
  api/data.ts           horizons index and cells (data branch)
  api/satellite.ts      MTG images → cloud index
  api/weather.ts        AROME 15-minute direct sunlight, cloud layers
  lib/sun.ts            solar position, sunrise and sunset
  lib/horizon.ts        horizon lookup, sun / tree / building shade
  lib/nowcast.ts        cloud motion and extrapolation
  lib/sky.ts            chance the sun is out (line of sight, parallax, blending)
  lib/status.ts         terrace state, how long the sun lasts
  lib/feedback.ts       on-site answers, outbox
  components/           results list, day strip, sky panorama
```

## Limits

- Awnings, umbrellas, temporary structures and buildings newer than the LiDAR survey are not in the data.
- Trees are counted as dappled shade: how much they block depends on the season (deciduous trees are bare in winter)
  and on when the LiDAR was flown.
- Terrace positions come from the City's file (± 1 m) and are aligned on BD TOPO facades (± 1–3 m); a terrace on a
  corner may be oriented along the wrong street.
- The cloud nowcast moves existing clouds; it does not see clouds that form or dissolve. Thin cirrus can let the sun
  through while looking bright to the satellite.
