import { env } from '$env/dynamic/public';

import { cumulativeDistances, type LngLat } from '$lib/geo/geometry';

/** A single turn instruction, positioned by distance along the route. */
export type RouteStep = {
	/** Metres from the route origin at which this manoeuvre happens. */
	atM: number;
	/** Length of the step itself, in metres. */
	lengthM: number;
	/** e.g. "turn", "roundabout", "arrive". */
	type: string;
	/** e.g. "left", "slight right". */
	modifier?: string;
	/** Road name, when OSM has one. */
	road: string;
	instruction: string;
};

export type Route = {
	path: LngLat[];
	/** Cumulative metres at each vertex of `path`. */
	cumulative: number[];
	distanceM: number;
	durationS: number;
	steps: RouteStep[];
};

/**
 * Public OSRM demo server: no API key, no token, fine for development.
 * It is rate limited and explicitly not for production traffic, so the endpoint
 * is overridable — point PUBLIC_ROUTING_URL at your own OSRM instance (see
 * .env.example) rather than editing this file.
 */
const DEMO_OSRM = 'https://router.project-osrm.org/route/v1/driving';
const OSRM = env.PUBLIC_ROUTING_URL || DEMO_OSRM;

function describe(type: string, modifier: string | undefined, road: string): string {
	const where = road ? ` onto ${road}` : '';
	switch (type) {
		case 'depart':
			return road ? `Head out on ${road}` : 'Start';
		case 'arrive':
			return 'Arrive at destination';
		case 'turn':
		case 'end of road':
			return `Turn ${modifier ?? ''}${where}`.replace('  ', ' ');
		case 'new name':
			return road ? `Continue on ${road}` : 'Continue';
		case 'continue':
			return `Continue ${modifier ?? 'straight'}${where}`;
		case 'merge':
			return `Merge ${modifier ?? ''}${where}`.trim();
		case 'fork':
			return `Keep ${modifier ?? 'straight'}${where}`;
		case 'roundabout':
		case 'rotary':
			return `Take the roundabout${where}`;
		case 'on ramp':
			return `Take the ramp${where}`;
		case 'off ramp':
			return `Take the exit${where}`;
		default:
			return `${type} ${modifier ?? ''}${where}`.trim();
	}
}

/** Fetches a driving route through the given waypoints, in order. */
export async function fetchRoute(waypoints: LngLat[], signal?: AbortSignal): Promise<Route> {
	const coords = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';');
	const url = `${OSRM}/${coords}?overview=full&geometries=geojson&steps=true`;

	const res = await fetch(url, { signal });
	if (!res.ok) throw new Error(`Routing service returned ${res.status}`);

	const json = await res.json();
	if (json.code !== 'Ok' || !json.routes?.length) {
		throw new Error(json.message ?? `Routing failed (${json.code})`);
	}

	const route = json.routes[0];
	const path = route.geometry.coordinates as LngLat[];

	let atM = 0;
	const steps: RouteStep[] = [];
	for (const leg of route.legs) {
		for (const step of leg.steps) {
			const type: string = step.maneuver?.type ?? 'continue';
			const modifier: string | undefined = step.maneuver?.modifier;
			const road: string = step.name ?? '';
			steps.push({
				atM,
				lengthM: step.distance,
				type,
				modifier,
				road,
				instruction: describe(type, modifier, road)
			});
			atM += step.distance;
		}
	}

	// OSRM's own distance differs from the summed geometry by a couple hundred
	// metres over a 50 km route. Progress is measured against the geometry, so
	// use that as the authoritative length and rescale the step offsets to match.
	const cumulative = cumulativeDistances(path);
	const geometryM = cumulative[cumulative.length - 1];
	const scale = route.distance > 0 ? geometryM / route.distance : 1;
	for (const step of steps) {
		step.atM *= scale;
		step.lengthM *= scale;
	}

	return {
		path,
		cumulative,
		distanceM: geometryM,
		durationS: route.duration,
		steps
	};
}
