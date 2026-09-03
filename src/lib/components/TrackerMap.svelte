<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { LayersList, PickingInfo } from '@deck.gl/core';
	import type { IControl, Map as MapLibreMap } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';

	import { fetchRoute, type Route, type RouteStep } from '$lib/services/routing';
	import { DESTINATIONS, DHARAPURAM_BUS_STAND, type Place } from '$lib/places';
	import { GeoWatcher, type Fix } from '$lib/state/geolocation.svelte';
	import {
		angleTowards,
		bearingBetween,
		formatClock,
		formatDistance,
		formatDuration,
		formatSpeed,
		haversineM,
		pathFromDistance,
		pathToDistance,
		pointAtDistance,
		snapToPath,
		type LngLat
	} from '$lib/geo/geometry';

	type Basemap = 'dark' | 'light';

	const STYLES: Record<Basemap, string> = {
		dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
		light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
	};

	/** Treated as "you have left the road" once the snap distance exceeds this. */
	const OFF_ROUTE_M = 130;
	/** Simulated drive speed in m/s (about 50 km/h). */
	const SIM_SPEED_MPS = 14;
	/** Replay animation duration bounds, in ms. */
	const REPLAY_MIN_MS = 2_600;
	const REPLAY_MAX_MS = 11_000;
	/** Camera zoom used while the replay flies along the road. */
	const REPLAY_ZOOM = 13.6;

	/** Top-down car, drawn pointing north so getAngle can aim it down the road. */
	const CAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
	<g stroke="#0b1220" stroke-width="2" stroke-linejoin="round">
		<rect x="14" y="20" width="8" height="9" rx="2.5" fill="#0b1220"/>
		<rect x="42" y="20" width="8" height="9" rx="2.5" fill="#0b1220"/>
		<rect x="14" y="38" width="8" height="9" rx="2.5" fill="#0b1220"/>
		<rect x="42" y="38" width="8" height="9" rx="2.5" fill="#0b1220"/>
		<path d="M32 4c6.5 0 11 4.2 11.6 10.5l1.4 14.8c.4 4.4.4 12.6 0 17L43.6 55C43 59.2 38 61 32 61s-11-1.8-11.6-6L19 46.3c-.4-4.4-.4-12.6 0-17l1.4-14.8C21 8.2 25.5 4 32 4z" fill="#38bdf8"/>
		<path d="M32 11c3.9 0 6.6 1.6 7.4 4.6l1.2 4.6c.2.9-.5 1.8-1.5 1.8H24.9c-1 0-1.7-.9-1.5-1.8l1.2-4.6C25.4 12.6 28.1 11 32 11z" fill="#0f2942"/>
		<path d="M25 33h14v10H25z" fill="#0f2942" opacity=".55"/>
		<path d="M32 52.5c3.3 0 5.8 1 6.6 3.2H25.4c.8-2.2 3.3-3.2 6.6-3.2z" fill="#0f2942" opacity=".7"/>
	</g>
	<circle cx="25" cy="7.5" r="2.2" fill="#fde68a"/>
	<circle cx="39" cy="7.5" r="2.2" fill="#fde68a"/>
</svg>`;
	const CAR_ICON_URL = `data:image/svg+xml,${encodeURIComponent(CAR_SVG)}`;

	const origin = DHARAPURAM_BUS_STAND;

	let container: HTMLDivElement;
	let basemap = $state<Basemap>('dark');
	let mapReady = $state(false);
	let mapError = $state<string | null>(null);

	let destination = $state<Place>(DESTINATIONS[0]);
	let route = $state<Route | null>(null);
	let routeLoading = $state(false);
	let routeError = $state<string | null>(null);
	let routeFrom = $state<'start' | 'here'>('start');

	const watcher = new GeoWatcher();
	let follow = $state(true);
	let trail = $state<LngLat[]>([]);

	let simulating = $state(false);
	let simFix = $state<Fix | null>(null);
	let simDistanceM = $state(0);

	/** Journey replay: a car driven from the start of the route to `replayToM`. */
	let replaying = $state(false);
	let replayCar = $state<{ point: LngLat; bearing: number } | null>(null);
	let replayDistanceM = $state(0);
	let replayPercent = $state(0);
	let carActive = $state(false);
	let refreshing = $state(false);
	let chaseCam = $state(true);
	let replayFrame = 0;

	// Non-reactive handles for the big mutable map objects.
	let map: MapLibreMap | undefined;
	let overlay: import('@deck.gl/mapbox').MapboxOverlay | undefined;
	let deck:
		| {
				IconLayer: typeof import('@deck.gl/layers').IconLayer;
				PathLayer: typeof import('@deck.gl/layers').PathLayer;
				ScatterplotLayer: typeof import('@deck.gl/layers').ScatterplotLayer;
				TextLayer: typeof import('@deck.gl/layers').TextLayer;
		  }
		| undefined;

	/** Whichever position feed is currently driving the map. */
	const fix = $derived<Fix | null>(simulating ? simFix : watcher.fix);

	/** Everything derived from "where am I on this route right now". */
	const progress = $derived.by(() => {
		if (!route || !fix) return null;

		const snapped = snapToPath(fix.coordinates, route.path, route.cumulative);
		if (!snapped) return null;

		const travelledM = snapped.alongM;
		const remainingM = Math.max(0, route.distanceM - travelledM);

		// Prefer the device's own speed once actually moving; otherwise fall back
		// to the routing engine's average pace for the road that is left.
		const speed = fix.speedMps;
		const remainingS =
			speed != null && speed > 2
				? remainingM / speed
				: route.distanceM > 0
					? route.durationS * (remainingM / route.distanceM)
					: 0;

		const upcoming: RouteStep[] = route.steps.filter((s) => s.atM > travelledM + 5);
		const next = upcoming[0] ?? route.steps[route.steps.length - 1];

		return {
			snapped,
			travelledM,
			remainingM,
			remainingS,
			offRoute: snapped.offRouteM > OFF_ROUTE_M,
			toDestinationM: haversineM(fix.coordinates, destination.coordinates),
			percent: route.distanceM > 0 ? Math.min(100, (travelledM / route.distanceM) * 100) : 0,
			next,
			nextInM: next ? Math.max(0, next.atM - travelledM) : 0,
			then: upcoming[1] ?? null,
			eta: new Date(Date.now() + remainingS * 1000)
		};
	});

	const arrived = $derived(progress != null && progress.toDestinationM < 120);

	async function loadRoute(from: LngLat, mode: 'start' | 'here' = 'start') {
		routeLoading = true;
		routeError = null;
		try {
			route = await fetchRoute([from, destination.coordinates]);
			routeFrom = mode;
			simDistanceM = 0;
			if (mode === 'start' && !fix) fitRoute();
		} catch (e) {
			routeError = e instanceof Error ? e.message : String(e);
		} finally {
			routeLoading = false;
		}
	}

	function fitRoute() {
		if (!map || !route) return;
		let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
		for (const [x, y] of route.path) {
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
		follow = false;
		map.fitBounds(
			[
				[minX, minY],
				[maxX, maxY]
			],
			{ padding: { top: 140, bottom: 200, left: 40, right: 40 }, duration: 800, pitch: 0 }
		);
	}

	function buildLayers(): LayersList {
		if (!deck) return [];
		const { IconLayer, PathLayer, ScatterplotLayer, TextLayer } = deck;
		const layers: LayersList = [];

		if (route) {
			const travelled = progress?.travelledM ?? 0;
			// A slice can collapse to a single vertex at either end of the trip,
			// which PathLayer cannot draw — only pass through real segments.
			const ahead = pathFromDistance(route.path, route.cumulative, travelled);
			const done = pathToDistance(route.path, route.cumulative, travelled);

			layers.push(
				new PathLayer<{ path: LngLat[] }>({
					id: 'route-casing',
					data: [{ path: route.path }],
					getPath: (d) => d.path,
					getColor: [8, 15, 30, 220],
					getWidth: 22,
					widthMinPixels: 11,
					widthMaxPixels: 22,
					capRounded: true,
					jointRounded: true
				}),
				new PathLayer<{ path: LngLat[] }>({
					id: 'route-ahead',
					data: ahead.length > 1 ? [{ path: ahead }] : [],
					getPath: (d) => d.path,
					getColor: [56, 189, 248, 255],
					getWidth: 14,
					widthMinPixels: 6,
					widthMaxPixels: 14,
					capRounded: true,
					jointRounded: true
				}),
				new PathLayer<{ path: LngLat[] }>({
					id: 'route-done',
					data: done.length > 1 ? [{ path: done }] : [],
					getPath: (d) => d.path,
					getColor: [100, 116, 139, 210],
					getWidth: 12,
					widthMinPixels: 5,
					widthMaxPixels: 12,
					capRounded: true,
					jointRounded: true
				})
			);
		}

		if (trail.length > 1) {
			layers.push(
				new PathLayer<{ path: LngLat[] }>({
					id: 'gps-trail',
					data: [{ path: trail }],
					getPath: (d) => d.path,
					getColor: [250, 204, 21, 200],
					getWidth: 4,
					widthMinPixels: 2,
					capRounded: true,
					jointRounded: true
				})
			);
		}

		const endpoints = [
			{ ...origin, kind: 'origin' as const },
			{ ...destination, kind: 'destination' as const }
		];

		layers.push(
			new ScatterplotLayer<(typeof endpoints)[number]>({
				id: 'endpoints',
				data: endpoints,
				getPosition: (d) => d.coordinates,
				getRadius: 9,
				radiusUnits: 'pixels',
				getFillColor: (d) => (d.kind === 'origin' ? [34, 197, 94, 255] : [244, 63, 94, 255]),
				getLineColor: [255, 255, 255, 230],
				getLineWidth: 2.5,
				lineWidthUnits: 'pixels',
				stroked: true,
				pickable: true,
				autoHighlight: true
			}),
			new TextLayer<(typeof endpoints)[number]>({
				id: 'endpoint-labels',
				data: endpoints,
				getPosition: (d) => d.coordinates,
				getText: (d) => d.name,
				getSize: 12,
				getColor: [236, 243, 255, 255],
				getPixelOffset: [0, -18],
				outlineColor: [4, 10, 22, 255],
				outlineWidth: 4,
				fontSettings: { sdf: true },
				getTextAnchor: 'middle',
				getAlignmentBaseline: 'bottom'
			})
		);

		if (route && replayDistanceM > 0) {
			const driven = pathToDistance(route.path, route.cumulative, replayDistanceM);
			if (driven.length > 1) {
				layers.push(
					new PathLayer<{ path: LngLat[] }>({
						id: 'replay-line',
						data: [{ path: driven }],
						getPath: (d) => d.path,
						getColor: [34, 197, 94, 255],
						getWidth: 13,
						widthMinPixels: 5,
						widthMaxPixels: 13,
						capRounded: true,
						jointRounded: true
					})
				);
			}
		}

		if (fix) {
			if (fix.accuracyM && fix.accuracyM > 15) {
				layers.push(
					new ScatterplotLayer<Fix>({
						id: 'accuracy',
						data: [fix],
						getPosition: (d) => d.coordinates,
						getRadius: (d) => d.accuracyM ?? 0,
						radiusUnits: 'meters',
						getFillColor: [56, 189, 248, 45],
						getLineColor: [56, 189, 248, 110],
						getLineWidth: 1,
						lineWidthUnits: 'pixels',
						stroked: true
					})
				);
			}

			layers.push(
				new ScatterplotLayer<Fix>({
					id: 'me',
					data: [fix],
					getPosition: (d) => d.coordinates,
					getRadius: 8,
					radiusUnits: 'pixels',
					getFillColor: (d) => (d.source === 'simulated' ? [168, 85, 247, 255] : [37, 99, 235, 255]),
					getLineColor: [255, 255, 255, 255],
					getLineWidth: 3,
					lineWidthUnits: 'pixels',
					stroked: true
				})
			);
		}

		if (replayCar) {
			layers.push(
				new IconLayer<{ point: LngLat; bearing: number }>({
					id: 'replay-car',
					data: [replayCar],
					getPosition: (d) => d.point,
					getIcon: () => ({
						url: CAR_ICON_URL,
						width: 64,
						height: 64,
						anchorX: 32,
						anchorY: 32
					}),
					getSize: 42,
					sizeUnits: 'pixels',
					sizeMinPixels: 26,
					// deck.gl angles run counter-clockwise; compass bearings run
					// clockwise, so the sprite is aimed with the negated bearing.
					getAngle: (d) => -d.bearing,
					billboard: false
				})
			);
		}

		return layers;
	}

	onMount(() => {
		let disposed = false;

		(async () => {
			const [{ Map, NavigationControl }, { MapboxOverlay }, layers] = await Promise.all([
				import('maplibre-gl'),
				import('@deck.gl/mapbox'),
				import('@deck.gl/layers')
			]);
			if (disposed) return;

			deck = {
				IconLayer: layers.IconLayer,
				PathLayer: layers.PathLayer,
				ScatterplotLayer: layers.ScatterplotLayer,
				TextLayer: layers.TextLayer
			};

			map = new Map({
				container,
				style: STYLES[basemap],
				center: [77.44, 10.94],
				zoom: 8.6,
				attributionControl: { compact: true }
			});
			map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right');
			// Panning by hand means "stop chasing me".
			map.on('dragstart', () => (follow = false));

			overlay = new MapboxOverlay({
				interleaved: false,
				layers: [],
				getTooltip: ({ object }: PickingInfo<Place>) =>
					object?.name
						? {
								html: `<strong>${object.name}</strong><div>${object.detail}</div>`,
								style: {
									background: 'rgba(9, 15, 28, 0.94)',
									color: '#e2e8f0',
									font: '12px/1.5 system-ui, sans-serif',
									padding: '8px 10px',
									borderRadius: '6px'
								}
							}
						: null
			});
			map.addControl(overlay as unknown as IControl);

			map.on('load', () => {
				if (disposed) return;
				mapReady = true;
				fitRoute();
			});
		})().catch((e) => {
			mapError = e instanceof Error ? e.message : String(e);
		});

		loadRoute(origin.coordinates);

		return () => {
			disposed = true;
			cancelAnimationFrame(replayFrame);
			watcher.stop();
			overlay?.finalize();
			map?.remove();
			map = undefined;
			overlay = undefined;
		};
	});

	// Keep deck.gl in sync with the reactive state read inside buildLayers().
	$effect(() => {
		const next = buildLayers();
		if (mapReady) overlay?.setProps({ layers: next });
	});

	$effect(() => {
		if (mapReady) map?.setStyle(STYLES[basemap]);
	});

	// Record breadcrumbs, but only once the fix has actually moved.
	$effect(() => {
		const current = fix?.coordinates;
		if (!current) return;
		untrack(() => {
			const last = trail[trail.length - 1];
			if (!last || haversineM(last, current) > 12) trail = [...trail, current];
		});
	});

	// Follow mode: keep the camera over the live position, facing the way we move.
	$effect(() => {
		if (!follow || replaying || !mapReady || !map || !fix) return;
		const heading =
			fix.headingDeg ??
			(trail.length > 1 ? bearingBetween(trail[trail.length - 2], fix.coordinates) : null);
		map.easeTo({
			center: fix.coordinates,
			zoom: Math.max(map.getZoom(), 14.5),
			bearing: heading ?? map.getBearing(),
			pitch: 45,
			duration: 900
		});
	});

	// After a replay, keep the parked car on the live snapped position so it
	// drives along with incoming fixes instead of sitting where it stopped.
	$effect(() => {
		if (replaying || !carActive || !route || !progress) return;
		replayCar = pointAtDistance(route.path, route.cumulative, progress.travelledM);
		replayDistanceM = progress.travelledM;
	});

	// Drive the simulated position along the route.
	$effect(() => {
		if (!simulating || !route) return;
		const active = route;

		let frame = 0;
		let last = performance.now();
		const step = (now: number) => {
			const dt = Math.min(0.5, (now - last) / 1000);
			last = now;
			const next = Math.min(active.distanceM, simDistanceM + SIM_SPEED_MPS * dt);
			const { point, bearing } = pointAtDistance(active.path, active.cumulative, next);
			simDistanceM = next;
			simFix = {
				coordinates: point,
				accuracyM: 12,
				headingDeg: bearing,
				speedMps: SIM_SPEED_MPS,
				timestamp: Date.now(),
				source: 'simulated'
			};
			if (next < active.distanceM) frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
		return () => cancelAnimationFrame(frame);
	});

	/**
	 * Drives the car sprite from the start of the route to `targetM` metres
	 * along it, optionally chasing it with the camera.
	 */
	function startReplay(targetM: number) {
		if (!route) return;
		const active = route;

		cancelAnimationFrame(replayFrame);
		carActive = true;

		if (targetM <= 50) {
			// Still at the starting point: place the car, nothing to animate.
			replaying = false;
			replayDistanceM = targetM;
			replayCar = pointAtDistance(active.path, active.cumulative, targetM);
			return;
		}

		follow = false;
		replaying = true;
		replayPercent = 0;
		replayDistanceM = 0;

		const duration = Math.min(REPLAY_MAX_MS, Math.max(REPLAY_MIN_MS, targetM / 4));
		const first = pointAtDistance(active.path, active.cumulative, 0);
		let camBearing = first.bearing;
		let carBearing = first.bearing;

		replayCar = first;
		if (map && chaseCam) {
			map.easeTo({
				center: first.point,
				zoom: REPLAY_ZOOM,
				pitch: 50,
				bearing: camBearing,
				duration: 650
			});
		}

		// Let the opening camera move settle before the car pulls away.
		const startAt = performance.now() + (map && chaseCam ? 650 : 0);

		const tick = (now: number) => {
			const t = Math.max(0, Math.min(1, (now - startAt) / duration));
			// Ease in and out, so the car pulls away and settles like a vehicle.
			const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
			const at = pointAtDistance(active.path, active.cumulative, eased * targetM);

			carBearing = angleTowards(carBearing, at.bearing, 0.25);
			replayCar = { point: at.point, bearing: carBearing };
			replayDistanceM = eased * targetM;
			replayPercent = t * 100;

			if (map && chaseCam) {
				camBearing = angleTowards(camBearing, at.bearing, 0.08);
				map.jumpTo({ center: at.point, zoom: REPLAY_ZOOM, pitch: 50, bearing: camBearing });
			}

			if (t < 1) {
				replayFrame = requestAnimationFrame(tick);
			} else {
				replaying = false;
				// Hand the camera back to follow mode if a live fix is coming in.
				if (fix && (watcher.isWatching || simulating)) follow = true;
			}
		};
		replayFrame = requestAnimationFrame(tick);
	}

	function endReplay(jumpToEnd: boolean) {
		cancelAnimationFrame(replayFrame);
		replaying = false;
		replayPercent = 100;
		if (jumpToEnd && route) {
			const target = progress?.travelledM ?? route.distanceM;
			replayDistanceM = target;
			replayCar = pointAtDistance(route.path, route.cumulative, target);
		}
	}

	/**
	 * The "Refresh" action: take a fresh position reading, then replay the
	 * journey from the start of the route up to it. With no position available
	 * it previews the whole route instead.
	 */
	async function refresh() {
		if (replaying) {
			endReplay(true);
			return;
		}
		if (!route) return;

		refreshing = true;
		try {
			if (!simulating) await watcher.locateOnce();
		} finally {
			refreshing = false;
		}

		startReplay(progress?.travelledM ?? route.distanceM);
	}

	function toggleTracking() {
		if (watcher.isWatching) {
			watcher.stop();
		} else {
			simulating = false;
			follow = true;
			watcher.start();
		}
	}

	function toggleSimulation() {
		if (simulating) {
			simulating = false;
			return;
		}
		watcher.stop();
		if (route && simDistanceM >= route.distanceM) simDistanceM = 0;
		simulating = true;
		follow = true;
	}

	function resetTrip() {
		endReplay(false);
		carActive = false;
		replayCar = null;
		replayDistanceM = 0;
		simDistanceM = 0;
		simFix = null;
		trail = [];
		if (routeFrom === 'here') loadRoute(origin.coordinates);
	}

	function changeDestination(place: Place) {
		endReplay(false);
		carActive = false;
		replayCar = null;
		replayDistanceM = 0;
		destination = place;
		trail = [];
		simDistanceM = 0;
		simFix = null;
		loadRoute(routeFrom === 'here' && fix ? fix.coordinates : origin.coordinates, routeFrom);
	}

	const statusLabel = $derived(
		simulating
			? 'Simulated drive'
			: watcher.status === 'live'
				? 'Live GPS'
				: watcher.status === 'located'
					? 'Position taken'
				: watcher.status === 'locating'
					? 'Getting a fix…'
					: watcher.status === 'denied'
						? 'Location blocked'
						: watcher.status === 'unsupported'
							? 'Not supported'
							: watcher.status === 'error'
								? 'Location error'
								: 'Tracking off'
	);
</script>

<div class="wrap">
	<div class="map" bind:this={container}></div>

	{#if mapError}
		<div class="card center error">
			<strong>Map failed to load</strong>
			<p class="sub">{mapError}</p>
		</div>
	{/if}

	<div class="card guide" class:muted={!progress}>
		{#if routeLoading}
			<p class="lead">Finding the road route…</p>
		{:else if routeError}
			<p class="lead warn">Route unavailable</p>
			<p class="sub">{routeError}</p>
			<div class="controls">
				<button class="btn" onclick={() => loadRoute(origin.coordinates)}>Retry</button>
			</div>
		{:else if arrived}
			<p class="lead">Arrived at {destination.name}</p>
			<p class="sub">{formatDistance(progress?.toDestinationM ?? 0)} from the stand</p>
		{:else if progress}
			<p class="turn">{progress.next?.instruction ?? 'Continue'}</p>
			<p class="sub">
				in {formatDistance(progress.nextInM)}{#if progress.then}
					· then {progress.then.instruction}{/if}
			</p>
		{:else}
			<p class="lead">{origin.name} → {destination.name}</p>
			<p class="sub">
				{#if route}
					{formatDistance(route.distanceM)} · {formatDuration(route.durationS)} by road — hit
					“Track me” to follow your position
				{:else}
					Loading route…
				{/if}
			</p>
		{/if}
	</div>

	{#if replaying}
		<div class="card replay">
			<span>Replaying your trip · {formatDistance(replayDistanceM)}</span>
			<div class="rbar"><span style="width:{replayPercent}%"></span></div>
			<button class="btn" onclick={() => endReplay(true)}>Skip</button>
		</div>
	{/if}

	{#if progress?.offRoute && !arrived && !replaying}
		<div class="card offroute">
			<span>Off route — {formatDistance(progress.snapped.offRouteM)} from the line</span>
			<button class="btn" onclick={() => fix && loadRoute(fix.coordinates, 'here')}>
				Re-route from here
			</button>
		</div>
	{/if}

	<div class="card hud">
		<div class="stats">
			<div class="stat">
				<span class="k">Remaining</span>
				<span class="v">{formatDistance(progress?.remainingM ?? route?.distanceM ?? NaN)}</span>
			</div>
			<div class="stat">
				<span class="k">Time left</span>
				<span class="v">{formatDuration(progress?.remainingS ?? route?.durationS ?? NaN)}</span>
			</div>
			<div class="stat">
				<span class="k">Arrival</span>
				<span class="v">
					{#if progress}
						{formatClock(progress.eta)}
					{:else if route}
						{formatClock(new Date(Date.now() + route.durationS * 1000))}
					{:else}
						–
					{/if}
				</span>
			</div>
			<div class="stat">
				<span class="k">Speed</span>
				<span class="v">{formatSpeed(fix?.speedMps ?? null)}</span>
			</div>
		</div>

		<div class="bar"><span style="width:{progress?.percent ?? 0}%"></span></div>

		<div class="meta">
			<span class="dot" class:live={watcher.status === 'live' || simulating}></span>
			{statusLabel}{#if fix?.accuracyM}
				· ±{Math.round(fix.accuracyM)} m{/if}{#if routeFrom === 'here'}
				· rerouted from your position{/if}
		</div>

		{#if watcher.message}
			<p class="sub warn">{watcher.message}</p>
		{/if}

		<div class="controls">
			<button class="btn primary" onclick={toggleTracking}>
				{watcher.isWatching ? 'Stop tracking' : 'Track me'}
			</button>
			<button class="btn refresh" onclick={refresh} disabled={!route || refreshing}>
				{#if replaying}
					Skip replay
				{:else if refreshing}
					Locating…
				{:else}
					Refresh
				{/if}
			</button>
			<button class="btn" onclick={toggleSimulation}>
				{simulating ? 'Pause sim' : 'Simulate drive'}
			</button>
			<button class="btn" class:on={follow} onclick={() => (follow = !follow)}>
				{follow ? 'Following' : 'Follow'}
			</button>
			<button class="btn" onclick={fitRoute}>Whole route</button>
			<button class="btn" onclick={resetTrip}>Reset</button>
		</div>

		<div class="controls">
			<select
				class="select"
				value={destination.id}
				onchange={(e) => {
					const found = DESTINATIONS.find((d) => d.id === e.currentTarget.value);
					if (found) changeDestination(found);
				}}
			>
				{#each DESTINATIONS as place (place.id)}
					<option value={place.id}>{place.name}</option>
				{/each}
			</select>
			<button class="btn" class:on={chaseCam} onclick={() => (chaseCam = !chaseCam)}>
				{chaseCam ? 'Chase cam' : 'Fixed cam'}
			</button>
			<button class="btn" onclick={() => (basemap = basemap === 'dark' ? 'light' : 'dark')}>
				{basemap === 'dark' ? 'Light map' : 'Dark map'}
			</button>
		</div>
	</div>
</div>

<style>
	.wrap {
		position: relative;
		width: 100%;
		height: 100%;
		background: #070c16;
		color: #e2e8f0;
		font: 13px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif;
	}

	.map {
		position: absolute;
		inset: 0;
	}

	.card {
		position: absolute;
		z-index: 2;
		padding: 0.75rem 0.9rem;
		border-radius: 0.8rem;
		background: rgba(9, 15, 28, 0.88);
		backdrop-filter: blur(10px);
		border: 1px solid rgba(148, 163, 184, 0.22);
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
	}

	.guide {
		top: 0.85rem;
		left: 0.85rem;
		right: 0.85rem;
		max-width: 30rem;
	}

	.guide.muted {
		background: rgba(9, 15, 28, 0.8);
	}

	.turn {
		margin: 0;
		font-size: 1.15rem;
		font-weight: 650;
		letter-spacing: -0.01em;
		text-transform: capitalize;
	}

	.lead {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
	}

	.sub {
		margin: 0.2rem 0 0;
		color: #94a3b8;
		font-size: 0.78rem;
	}

	.warn {
		color: #fca5a5;
	}

	.offroute {
		top: 6.6rem;
		left: 0.85rem;
		right: 0.85rem;
		max-width: 30rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		border-color: rgba(251, 191, 36, 0.45);
		color: #fde68a;
		font-size: 0.8rem;
	}

	.replay {
		top: 6.6rem;
		left: 0.85rem;
		right: 0.85rem;
		max-width: 30rem;
		display: flex;
		align-items: center;
		gap: 0.7rem;
		border-color: rgba(34, 197, 94, 0.45);
		color: #bbf7d0;
		font-size: 0.78rem;
	}

	.replay span {
		white-space: nowrap;
	}

	.rbar {
		flex: 1;
		height: 3px;
		border-radius: 2px;
		background: rgba(148, 163, 184, 0.3);
		overflow: hidden;
	}

	.rbar > span {
		display: block;
		height: 100%;
		background: #22c55e;
	}

	.btn.refresh {
		border-color: rgba(34, 197, 94, 0.55);
		color: #bbf7d0;
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.hud {
		bottom: 0.85rem;
		left: 0.85rem;
		width: min(23rem, calc(100% - 1.7rem));
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.5rem;
	}

	.stat {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.k {
		color: #7c8ba1;
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}

	.v {
		font-size: 0.95rem;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}

	.bar {
		margin: 0.7rem 0 0.5rem;
		height: 4px;
		border-radius: 2px;
		background: rgba(148, 163, 184, 0.25);
		overflow: hidden;
	}

	.bar span {
		display: block;
		height: 100%;
		background: linear-gradient(90deg, #22c55e, #38bdf8);
		transition: width 0.4s ease;
	}

	.meta {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		color: #94a3b8;
		font-size: 0.72rem;
	}

	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #64748b;
	}

	.dot.live {
		background: #22c55e;
		box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.22);
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.6rem;
	}

	.btn {
		appearance: none;
		cursor: pointer;
		border: 1px solid rgba(148, 163, 184, 0.35);
		border-radius: 0.45rem;
		background: rgba(148, 163, 184, 0.08);
		color: #dbe4f0;
		font: inherit;
		font-size: 0.75rem;
		padding: 0.3rem 0.6rem;
	}

	.btn:hover {
		background: rgba(148, 163, 184, 0.2);
	}

	.btn.primary {
		background: #38bdf8;
		border-color: #38bdf8;
		color: #06263a;
		font-weight: 600;
	}

	.btn.on {
		border-color: #22c55e;
		color: #86efac;
	}

	.select {
		appearance: none;
		border: 1px solid rgba(148, 163, 184, 0.35);
		border-radius: 0.45rem;
		background: rgba(148, 163, 184, 0.08);
		color: #dbe4f0;
		font: inherit;
		font-size: 0.75rem;
		padding: 0.3rem 0.5rem;
		max-width: 100%;
	}

	.center {
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		text-align: center;
	}

	.error {
		border-color: rgba(248, 113, 113, 0.5);
	}

	@media (max-width: 30rem) {
		.stats {
			grid-template-columns: repeat(2, 1fr);
			row-gap: 0.6rem;
		}
	}
</style>
