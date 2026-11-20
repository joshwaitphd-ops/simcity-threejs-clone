# City mock-up prototype

**Status: parked, 17 November 2026.** This is part of [#2 Building out the city](https://github.com/joshwaitphd-ops/simcity-threejs-clone/issues/2). It's on hold because it doesn't feel right yet. Nothing here is part of the game build: Vite builds from `src/`, and this folder sits outside it.

These are throwaway pages that render city ideas with the game's own models, palette, camera angle and lighting. They let us look at a layout before writing any game code.

## What's here

| File | What it does |
|---|---|
| `contact-sheet.html` | Renders all 259 models, grouped, with each footprint in tiles. Output: `renders/assets-*.jpg` |
| `roads.html` | Renders every road piece top-down, to show which way each one points |
| `mock.html` | One high-street block, as the game would draw it today and dressed with bases, a main road and props |
| `mock2.html` | A town square with a fountain, lot edges and a lighting comparison |
| `city.html` | City v1: a 32×32 town built from a text map |
| `city2.html` | City v2: several buildings per lot, less downtown parking, Chinatown, strip malls with parking in front |
| `organic.html` | The city without a grid, built from real Santa Fe streets, building footprints, parks and river (`osm/santafe.json`) |
| `maps/` | The text maps behind v1 and v2. One character per tile, with the legend at the bottom |
| `renders/` | The renders from each page, as JPEG |
| `references/` | OpenStreetMap views of Oxford (Mississippi), Savannah and Santa Fe, core and whole town |
| `tools/glb_bounds.py` | Prints every model's footprint in tiles |
| `tools/sheet_server.py` | Serves this folder and saves the images each page posts back |

`three`, `models` and `textures` are links into `node_modules` and `src/public`, so run `npm install` first. `scripts` links to `src/scripts`, so `organic.html` uses the game's own day/night cycle.

## Explore a city in the browser

```bash
npm run prototype
```

Then open http://127.0.0.1:3001/organic.html?live for the Santa Fe city, or http://127.0.0.1:3001/city2.html?live for the grid city. Drag to pan, right-drag to rotate, scroll to zoom.

The Santa Fe city runs the 3-minute day/night cycle. The slider at the bottom sets the time of day, and its button pauses the clock. The slider is a demo feature only: remove the parts marked `DEMO` in `organic.html` when it's no longer needed.

## How to render images

Without `?live`, the pages draw off-screen and post their images back to the little server, which saves them and stops.

```bash
cd prototypes/city-mockup
mkdir -p out
python3 tools/sheet_server.py . out 5 600 &      # expect 5 images, give up after 600 s
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --user-data-dir=/tmp/chrome-mockup --use-angle=swiftshader --enable-unsafe-swiftshader \
  http://127.0.0.1:8765/city2.html
```

The number of images each page posts: `contact-sheet` 5, `roads` 1, `mock` 4, `mock2` 4, `city` 5, `city2` 5, `organic` 4. Stop Chrome once the server prints `done`.

## What we learnt

- **The kit covers a whole American town** except the crisis infrastructure. There's no pumping station, substation, phone mast, supermarket, petrol station, town hall or people.
- **Every model is coloured from one 8×8 palette** (`textures/base.png`). New models just need their faces mapped onto it.
- **The road kit has main roads and local streets,** with junction pieces between them. `roadPiece()` in `city2.html` picks the right piece and rotation from a tile's neighbours, which is the hardest part of #2.1.
- **A text map works as a city format.** Roads, building choice and which way buildings face are all worked out from it.
- **What made the biggest difference, in order:**
  1. a ground base under every lot, with a raised edge
  2. buildings facing their street
  3. several buildings per lot
  4. strip malls with parking in front

  Small props only show when you zoom in.
- **The American small-city pattern** (references): a small square at the heart, a compact core, a loop road, older grid neighbourhoods, a shopping strip along a main road, and a highway bypass. The courthouse square is the layout the mock-ups ended up with.
- **The grid was the problem.** The player never places a building, so the city doesn't need tiles. `organic.html` drops them:
  - Streets are drawn as ribbons along real street lines, in palette colours.
  - Every real footprint becomes a raised plinth with a kit building on it, facing its street.

  It reads as a real town. What's still off: kit buildings are smaller than real footprints, and the brick mid-rise doesn't match Santa Fe's low adobe.

## Open threads

- **The look.** It reads as dated. The next step would be a proper look pass: soft contact shadows, tone mapping and a colour grade, haze, and times of day, including night with lit windows.
- **2.3: should the city be an island?** This is an open question.
- **2.4: our own assets** for the crisis infrastructure and people.
- **Multi-tile buildings** (the stadium and train station) aren't supported by the engine.

Map screenshots in `references/` and the data in `osm/santafe.json` © OpenStreetMap contributors, available under the Open Database Licence.
