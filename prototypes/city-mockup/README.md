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
| `town.html` | A town made by Wave Function Collapse instead of from real data: a fresh town for every `?seed=`. See **Procedural town** below |
| `lib/townPlan.js` | The town planner behind `town.html`: the WFC solver and its module catalogue. No three.js, so it runs in Node too |
| `lib/look.js` | Ground and building textures, shared by `organic.html` and `town.html` |
| `ground/` | Detail textures for the ground in `organic.html`: `grass.jpg` is Grass 23 from Screaming Brain Studios' Tiny Texture Pack 1. From Poly Haven: `pavers.jpg` is Square Concrete Pavers and `asphalt.jpg` is Asphalt 02. All CC0, reduced to 512 px |
| `buildings/` | Detail textures for buildings in `organic.html`, all from Poly Haven: `brick.jpg` (Large Red Bricks), `plaster.jpg` (White Plaster 02), `roof-flat.jpg` (Tarred Gravel) and `roof-tiles.jpg` (Grey Roof Tiles 02). All CC0, reduced to 512 px |
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

Then open http://127.0.0.1:3001/town.html?live for a procedural town, http://127.0.0.1:3001/organic.html?live for the Santa Fe city, or http://127.0.0.1:3001/city2.html?live for the grid city. Drag to pan, right-drag to rotate, scroll to zoom.

Add `&ground=flat`, `&ground=procedural` or `&ground=textures` (the default) to switch how the ground is drawn, and `&buildings=flat` to turn off the building textures. See **Ground and building detail** below.

The Santa Fe city runs the 3-minute day/night cycle. The slider at the bottom sets the time of day, and its button pauses the clock. The slider is a demo feature only: remove the parts marked `DEMO` in `organic.html` when it's no longer needed.

## Procedural town

`town.html` makes a town from a seed, with Wave Function Collapse (WFC), ideas taken from [wass08/wfc-magic-school](https://github.com/wass08/wfc-magic-school). It's built around the kit, so nothing has to be squeezed onto plots that don't fit it.

**The plan** (`lib/townPlan.js`). The map is a grid of 32 m cells. Every module (a street, a bend, a junction, a lot of shops or houses, a park, woods, a landmark) has a socket on each side, and two cells can sit side by side only if their sockets fit:

- a lot's front must face the side of a street
- a lot's back can't face a street, so blocks are lots back to back
- two streets never run side by side without joining

Then, on top of plain WFC:

- **Fixed constraints:** the courthouse square, its ring road and 3 or 4 main streets are placed first.
- **Weights by place:** shops downtown and on main streets, then flats, townhouses and houses, then woods.
- **Affinity:** parks, woods, shops and each kind of housing cluster, so streets get a character.
- **Spacing:** junctions keep 2 cells apart, and no street runs 2 cells from a parallel street, so blocks are long enough for a row of lots, 2 deep.
- **No tiny loops:** no 2×2 patch of road. Propagation enforces this: when 3 cells of a 2×2 can only be roads, the 4th can't be one.
- **Soft size cap** on parks, and **one of each landmark** (town hall, bank, school, fire station, police, hospital, data centre).
- **Restarts:** a plan that contradicts itself, or whose streets don't all connect, is dropped. Of 6 working plans, the one with the fewest defects is kept. A 25×25 town takes 0.1–2.5 s.

**Drawing it.** A gentle, smooth warp bends the whole grid, so streets curve a little while lots keep their shape (`?warp=0` for straight streets). Streets are traced from junction to junction and drawn as textured ribbons, with rounded bends and round junctions. Downtown streets get pavements wall to wall. Lots get a raised base sized to the cell, and buildings in a row along their front, using city2's lot rules. Every house lot holds 2 houses, so plots are about 16 m wide.

**In the browser** (`?live`): a minimap of the plan, with a tick on each lot's front; **Watch it build**, which raises the lots in the order the solver decided them; **New town**; straight or bent streets; and the day/night cycle. `?size=` changes the grid (odd numbers), and `?ground=`, `?buildings=` and `?texscale=` work as in `organic.html`.

To try the planner without a browser: `node -e "import('./lib/townPlan.js').then(({ planTown }) => console.log(planTown({ seed: 5 }).map))"`

Renders: `renders/town-seed<n>-*.jpg`, and `renders/town-seed1-map.png` for the plan.

## Ground and building detail

Grass, paving and roads used to be one flat palette colour each. `organic.html` now shades them in the shader, in world space, keeping the palette colour underneath. `?ground=` picks the style:

| Style | Grass | Plinths, paths and pavements |
|---|---|---|
| `flat` | Plain palette colour, as before | Plain palette colour |
| `procedural` | Light and dark patches about 50 m across, the brighter ones yellower, and smaller tufts | 3 m slabs, each a slightly different shade, with joints. Pavements get 2 m panels across. Slabs are laid square to each footprint and along each street |
| `textures` | The same patches, with the grain of a photo texture on top | The grain of a photo paver texture |

Roads and car parks get worn patches in every style except `flat`, and photo asphalt with cracks in `textures`, laid along each street.

Only each texture's brightness is used, so colours stay in the palette. Joints fade out as you zoom out, before they can shimmer.

**Texture scale.** Every texture is drawn at its real-world size (metres across one tile, from Poly Haven's metadata, listed in `DETAIL` in `organic.html`) times one exaggeration for the whole scene, `TEXTURE_SCALE`, which is 2.5 by default. The kit is close to real size (the 5-floor block is 25 m tall), so everything matches. Change it with `?texscale=`: 1 is real size, and higher is chunkier and more model-like.

**No visible tiling.** Photos are lit a little unevenly, and that unevenness repeats with every tile as stripes or a grid. So, apart from the grass, only each texture's fine detail is used: its brightness divided by a blurred copy of itself, taken from a smaller mipmap level. Large-scale variation comes from noise instead, which never repeats. Asphalt is laid the same way everywhere, so roads, junctions and car parks join without seams.

Buildings get the same treatment unless you add `?buildings=flat`. The kit's UVs point at palette squares, so the grain is projected onto each face along the model's own axes, and picked by the face's colour and direction:

- flat grey roofs: tarred gravel
- sloped roofs: tiles in rows along the ridge
- brick-red and brown walls: brick
- other walls: plaster
- glass: nothing, so the window lights at night are unchanged

Each building also gets its own look, so copies of the same kit model don't match: a slightly warmer or cooler, lighter or darker tint, its own place in the texture, and more or less weathering (grime on the bottom 2.5 m and rain streaks). Looks use their own random sequence, so they don't change where buildings go.

Renders of each ground style, with plain buildings: `renders/ground-<style>-{whole,neighbourhood,closeup}.jpg`. With textured buildings: `renders/buildings-textures-{closeup,downtown}.jpg`.

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

The number of images each page posts: `contact-sheet` 5, `roads` 1, `mock` 4, `mock2` 4, `city` 5, `city2` 5, `organic` 5, `town` 6 (with its map, as `town-map.txt` and `town-map.png`). Add `?ground=…` or `?buildings=flat` to the URL to render one style. Stop Chrome once the server prints `done`.

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
