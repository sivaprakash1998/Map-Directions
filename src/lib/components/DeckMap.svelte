<script lang="ts">
	import { onMount } from 'svelte';
	import type { LayersList, PickingInfo } from '@deck.gl/core';
	import type { IControl, Map as MapLibreMap } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { cities, type City } from '$lib/data/cities';

	type Basemap = 'light' | 'dark';
	type Mode = 'points' | 'columns';

	let {
		/** Initial camera position. */
		longitude = 20,
		latitude = 25,
		zoom = 1.6,
		pitch = 0,
		bearing = 0
	}: {
		longitude?: number;
		latitude?: number;
		zoom?: number;
		pitch?: number;
		bearing?: number;
	} = $props();

	/** Free CARTO basemaps — no access token required. */
	const STYLES: Record<Basemap, string> = {
		light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
		dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
	};

	let container: HTMLDivElement;
	let basemap = $state<Basemap>('dark');
	let mode = $state<Mode>('points');
	let ready = $state(false);
	let error = $state<string | null>(null);

	// Held outside of reactive state: these are big, mutable, non-reactive objects.
	let map: MapLibreMap | undefined;
	let overlay: import('@deck.gl/mapbox').MapboxOverlay | undefined;
	let buildLayers: (() => LayersList) | undefined;

	onMount(() => {
		let disposed = false;

		(async () => {
			// deck.gl and maplibre both touch `window`, so they load only in the browser.
			const [{ Map, NavigationControl }, { MapboxOverlay }, { ScatterplotLayer, ColumnLayer }] = await Promise.all([
				import('maplibre-gl'),
				import('@deck.gl/mapbox'),
				import('@deck.gl/layers')
			]);
			if (disposed) return;

			// Radius/height scale with population so the biggest metros read first.
			const radius = (d: City) => Math.sqrt(d.population) * 12_000;

			buildLayers = () =>
				mode === 'points'
					? [
							new ScatterplotLayer<City>({
								id: 'cities-scatter',
								data: cities,
								getPosition: (d) => d.coordinates,
								getRadius: radius,
								radiusMinPixels: 3,
								radiusMaxPixels: 60,
								getFillColor: [56, 189, 248, 180],
								getLineColor: [8, 47, 73, 255],
								lineWidthMinPixels: 1,
								stroked: true,
								filled: true,
								pickable: true,
								autoHighlight: true,
								highlightColor: [250, 204, 21, 220]
							})
						]
					: [
							new ColumnLayer<City>({
								id: 'cities-columns',
								data: cities,
								diskResolution: 24,
								radius: 40_000,
								extruded: true,
								getPosition: (d) => d.coordinates,
								getElevation: (d) => d.population * 20_000,
								getFillColor: (d) => {
									const t = Math.min(d.population / 37.4, 1);
									return [40 + t * 215, 190 - t * 130, 250 - t * 130, 210];
								},
								pickable: true,
								autoHighlight: true,
								highlightColor: [250, 204, 21, 220]
							})
						];

			map = new Map({
				container,
				style: STYLES[basemap],
				center: [longitude, latitude],
				zoom,
				pitch,
				bearing,
				attributionControl: { compact: true }
			});
			map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');

			overlay = new MapboxOverlay({
				interleaved: false,
				layers: buildLayers(),
				getTooltip: ({ object }: PickingInfo<City>) =>
					object
						? {
								html: `<strong>${object.name}</strong><div>${object.country}</div><div>${object.population.toFixed(1)}M people</div>`,
								style: {
									background: 'rgba(15, 23, 42, 0.92)',
									color: '#e2e8f0',
									font: '12px/1.5 system-ui, sans-serif',
									padding: '8px 10px',
									borderRadius: '6px',
									boxShadow: '0 4px 14px rgba(0,0,0,0.35)'
								}
							}
						: null
			});
			map.addControl(overlay as unknown as IControl);
			map.on('load', () => {
				if (!disposed) ready = true;
			});
		})().catch((e) => {
			error = e instanceof Error ? e.message : String(e);
		});

		return () => {
			disposed = true;
			overlay?.finalize();
			map?.remove();
			map = undefined;
			overlay = undefined;
		};
	});

	// Push layer changes into deck.gl whenever the render mode flips.
	$effect(() => {
		void mode;
		if (overlay && buildLayers) overlay.setProps({ layers: buildLayers() });
	});

	// Swap the basemap style in place; the deck.gl overlay survives a style reload.
	$effect(() => {
		map?.setStyle(STYLES[basemap]);
	});

	function setPitch(next: number) {
		map?.easeTo({ pitch: next, duration: 600 });
	}
</script>

<div class="wrap">
	<div class="map" bind:this={container}></div>

	{#if error}
		<div class="panel error">
			<strong>Map failed to load</strong>
			<p>{error}</p>
		</div>
	{:else}
		<div class="panel">
			<h2>World metro areas</h2>
			<p class="sub">{cities.length} cities · sized by population · deck.gl + MapLibre</p>

			<div class="row">
				<span class="label">Layer</span>
				<div class="seg">
					<button class:active={mode === 'points'} onclick={() => (mode = 'points')}>Points</button>
					<button
						class:active={mode === 'columns'}
						onclick={() => {
							mode = 'columns';
							setPitch(45);
						}}>Columns 3D</button
					>
				</div>
			</div>

			<div class="row">
				<span class="label">Basemap</span>
				<div class="seg">
					<button class:active={basemap === 'dark'} onclick={() => (basemap = 'dark')}>Dark</button>
					<button class:active={basemap === 'light'} onclick={() => (basemap = 'light')}>Light</button>
				</div>
			</div>

			<p class="hint">Drag to pan · scroll to zoom · right-drag to rotate · hover a city for details</p>
		</div>

		{#if !ready}
			<div class="loading">Loading map…</div>
		{/if}
	{/if}
</div>

<style>
	.wrap {
		position: relative;
		width: 100%;
		height: 100%;
		background: #0f172a;
	}

	.map {
		position: absolute;
		inset: 0;
	}

	.panel {
		position: absolute;
		top: 1rem;
		left: 1rem;
		z-index: 2;
		width: min(20rem, calc(100% - 2rem));
		padding: 0.9rem 1rem 1rem;
		border-radius: 0.75rem;
		background: rgba(15, 23, 42, 0.86);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(148, 163, 184, 0.25);
		color: #e2e8f0;
		font: 13px/1.5 system-ui, sans-serif;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
	}

	.panel h2 {
		margin: 0;
		font-size: 0.95rem;
		letter-spacing: 0.01em;
	}

	.sub {
		margin: 0.25rem 0 0.9rem;
		color: #94a3b8;
		font-size: 0.75rem;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.55rem;
	}

	.label {
		color: #94a3b8;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.seg {
		display: inline-flex;
		border-radius: 0.5rem;
		overflow: hidden;
		border: 1px solid rgba(148, 163, 184, 0.3);
	}

	.seg button {
		appearance: none;
		border: 0;
		background: transparent;
		color: #cbd5e1;
		font: inherit;
		font-size: 0.75rem;
		padding: 0.3rem 0.6rem;
		cursor: pointer;
	}

	.seg button:hover {
		background: rgba(148, 163, 184, 0.15);
	}

	.seg button.active {
		background: #38bdf8;
		color: #082f49;
		font-weight: 600;
	}

	.hint {
		margin: 0.75rem 0 0;
		color: #64748b;
		font-size: 0.7rem;
	}

	.error {
		border-color: rgba(248, 113, 113, 0.5);
	}

	.error p {
		margin: 0.4rem 0 0;
		color: #fca5a5;
		font-size: 0.75rem;
	}

	.loading {
		position: absolute;
		inset: 0;
		z-index: 1;
		display: grid;
		place-items: center;
		color: #94a3b8;
		font: 13px/1.5 system-ui, sans-serif;
		pointer-events: none;
	}
</style>
