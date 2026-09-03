/** Geodesic helpers for snapping a live position onto a route polyline. */

export type LngLat = [number, number];

const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

/** Great-circle distance in metres. */
export function haversineM(a: LngLat, b: LngLat): number {
	const lat1 = a[1] * DEG;
	const lat2 = b[1] * DEG;
	const dLat = lat2 - lat1;
	const dLng = (b[0] - a[0]) * DEG;
	const h =
		Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cumulative distance (m) at each vertex of a path; length === path.length. */
export function cumulativeDistances(path: LngLat[]): number[] {
	const out = new Array<number>(path.length);
	out[0] = 0;
	for (let i = 1; i < path.length; i++) out[i] = out[i - 1] + haversineM(path[i - 1], path[i]);
	return out;
}

export type Snapped = {
	/** Index of the segment start vertex. */
	index: number;
	/** Position of the projection within that segment, 0..1. */
	t: number;
	/** The projected point on the route. */
	point: LngLat;
	/** Perpendicular distance from the route, in metres. */
	offRouteM: number;
	/** Distance travelled along the route to reach the projection, in metres. */
	alongM: number;
};

/**
 * Projects `p` onto the polyline and reports how far along the route it lands.
 * Segments are projected in a local metre-scaled plane, which is accurate enough
 * at the scale of consecutive route vertices.
 */
export function snapToPath(p: LngLat, path: LngLat[], cumulative: number[]): Snapped | null {
	if (path.length < 2) return null;

	const kx = Math.cos(p[1] * DEG) * EARTH_RADIUS_M * DEG;
	const ky = EARTH_RADIUS_M * DEG;
	let best: Snapped | null = null;

	for (let i = 0; i < path.length - 1; i++) {
		const [ax, ay] = path[i];
		const [bx, by] = path[i + 1];
		const vx = (bx - ax) * kx;
		const vy = (by - ay) * ky;
		const wx = (p[0] - ax) * kx;
		const wy = (p[1] - ay) * ky;
		const len2 = vx * vx + vy * vy;
		const t = len2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
		const dx = wx - t * vx;
		const dy = wy - t * vy;
		const offRouteM = Math.hypot(dx, dy);

		if (!best || offRouteM < best.offRouteM) {
			best = {
				index: i,
				t,
				point: [ax + (bx - ax) * t, ay + (by - ay) * t],
				offRouteM,
				alongM: cumulative[i] + t * (cumulative[i + 1] - cumulative[i])
			};
		}
	}
	return best;
}

/** The point `distanceM` along the path, plus the bearing of travel there. */
export function pointAtDistance(
	path: LngLat[],
	cumulative: number[],
	distanceM: number
): { point: LngLat; bearing: number } {
	const total = cumulative[cumulative.length - 1];
	const d = Math.max(0, Math.min(total, distanceM));

	let i = 0;
	while (i < cumulative.length - 2 && cumulative[i + 1] < d) i++;

	const segLen = cumulative[i + 1] - cumulative[i];
	const t = segLen > 0 ? (d - cumulative[i]) / segLen : 0;
	const a = path[i];
	const b = path[i + 1];
	return {
		point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
		bearing: bearingBetween(a, b)
	};
}

/** Compass bearing in degrees (0 = north, clockwise). */
export function bearingBetween(a: LngLat, b: LngLat): number {
	const lat1 = a[1] * DEG;
	const lat2 = b[1] * DEG;
	const dLng = (b[0] - a[0]) * DEG;
	const y = Math.sin(dLng) * Math.cos(lat2);
	const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
	return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** Slice the path from `fromM` to the end — used to draw the road still ahead. */
export function pathFromDistance(
	path: LngLat[],
	cumulative: number[],
	fromM: number
): LngLat[] {
	const { point } = pointAtDistance(path, cumulative, fromM);
	const rest = path.filter((_, i) => cumulative[i] > fromM);
	return [point, ...rest];
}

/** Slice the path from the start up to `toM` — the part already covered. */
export function pathToDistance(path: LngLat[], cumulative: number[], toM: number): LngLat[] {
	const { point } = pointAtDistance(path, cumulative, toM);
	const head = path.filter((_, i) => cumulative[i] < toM);
	return [...head, point];
}

export function formatDistance(m: number): string {
	if (!Number.isFinite(m)) return '–';
	if (m < 950) return `${Math.round(m / 10) * 10} m`;
	return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '–';
	const mins = Math.round(seconds / 60);
	if (mins < 60) return `${mins} min`;
	return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
}

export function formatClock(date: Date): string {
	return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatSpeed(metresPerSecond: number | null): string {
	if (metresPerSecond == null || !Number.isFinite(metresPerSecond)) return '–';
	return `${Math.round(metresPerSecond * 3.6)} km/h`;
}

/**
 * Steps `current` toward `target` (both in degrees) along the shorter arc.
 * Used to damp the camera and car heading, which would otherwise snap about as
 * the route crosses short segments.
 */
export function angleTowards(current: number, target: number, amount: number): number {
	const diff = ((target - current + 540) % 360) - 180;
	return (current + diff * amount + 360) % 360;
}
