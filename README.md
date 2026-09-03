# Map-Directions
Used deck gl to track locations
# map

A SvelteKit + [deck.gl](https://deck.gl) app that tracks your live position along
the road route from **Dharapuram Main Bus Stand** to **Tiruppur Bus Stand** —
route line, turn-by-turn banner, remaining distance/ETA and off-route detection.

No API keys or tokens anywhere: the basemap is CARTO's free MapLibre style and
routing comes from the public OSRM demo server.

## Run

```bash
npm run dev          # http://localhost:5173
npm run dev:phone    # https + LAN address, for testing on a real phone
npm run build         # production build
npm run check         # svelte-check / typescript
```

### Testing on a phone

`navigator.geolocation` only runs in a secure context. `localhost` counts, a
plain-HTTP LAN address does not — so `npm run dev` on your laptop works, but
`http://192.168.x.x:5173` on your phone will report "location blocked".

`npm run dev:phone` serves over HTTPS with a self-signed certificate
(`@vitejs/plugin-basic-ssl`) and binds to your LAN address. Open the printed
`https://192.168.x.x:5173` on the phone and accept the certificate warning once.
A laptop browser will also report a coarse wifi-derived position; only a phone
gives you real GPS accuracy and a `speed`/`heading` reading.

## What the page does

- Draws the OSRM driving route as a `PathLayer` with a casing, splitting it into
  the part already covered (grey) and the road ahead (blue).
- Watches `navigator.geolocation.watchPosition` and projects each fix onto the
  route to work out distance travelled, distance remaining, ETA and the next
  manoeuvre. ETA uses the device's own speed once you are actually moving, and
  the routing engine's average pace otherwise.
- Flags you as **off route** past 130 m from the line, and can re-route from
  wherever you are.
- **Refresh** takes a fresh position reading, then replays the journey: a car
  icon drives from Dharapuram up to where you are now, with the covered road
  filling in green behind it and the camera chasing it (toggle with
  **Chase cam**). With no position available it previews the whole route
  instead, and standing at the start just parks the car there. Once a replay
  has finished the car rides along with incoming live fixes.
- **Simulate drive** animates a position along the route at ~50 km/h, so the
  whole flow can be exercised from a desk.
- Drops a yellow breadcrumb trail of the fixes actually received.

## Layout

- [src/routes/+page.svelte](src/routes/+page.svelte) — the tracking page
- [src/lib/components/TrackerMap.svelte](src/lib/components/TrackerMap.svelte) — map, deck.gl layers, HUD
- [src/lib/geo/geometry.ts](src/lib/geo/geometry.ts) — haversine, snap-to-path, path slicing, formatting
- [src/lib/services/routing.ts](src/lib/services/routing.ts) — OSRM request and turn instructions
- [src/lib/state/geolocation.svelte.ts](src/lib/state/geolocation.svelte.ts) — `watchPosition` as reactive state
- [src/lib/places.ts](src/lib/places.ts) — the bus stand coordinates
- [src/routes/cities/+page.svelte](src/routes/cities/+page.svelte) — the earlier world-cities deck.gl demo

## Configuration

Nothing is required to run this. The one knob is the routing backend:

```bash
cp .env.example .env    # then edit PUBLIC_ROUTING_URL
```

Left unset, it falls back to the public OSRM demo server, which is rate limited
and explicitly not for production traffic — point `PUBLIC_ROUTING_URL` at your
own OSRM instance before this goes anywhere real. `.env` is gitignored;
[.env.example](.env.example) is the tracked template.
