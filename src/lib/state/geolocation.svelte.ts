import type { LngLat } from '$lib/geo/geometry';

export type Fix = {
	coordinates: LngLat;
	/** Reported horizontal accuracy in metres, when the device provides it. */
	accuracyM: number | null;
	/** Direction of travel in degrees, when moving. */
	headingDeg: number | null;
	speedMps: number | null;
	timestamp: number;
	source: 'gps' | 'simulated';
};

export type WatchStatus =
	| 'idle'
	| 'locating'
	| 'live'
	| 'located'
	| 'denied'
	| 'error'
	| 'unsupported';

/**
 * Wraps `navigator.geolocation.watchPosition` as reactive state.
 *
 * The Geolocation API only works in a secure context, so this reports `denied`
 * over plain HTTP on anything other than localhost.
 */
export class GeoWatcher {
	fix = $state<Fix | null>(null);
	status = $state<WatchStatus>('idle');
	message = $state<string | null>(null);

	#watchId: number | null = null;

	get isWatching() {
		return this.#watchId !== null;
	}

	/** Returns false and sets an explanatory status when positioning is unavailable. */
	#available(): boolean {
		if (typeof navigator === 'undefined' || !navigator.geolocation) {
			this.status = 'unsupported';
			this.message = 'This browser has no Geolocation API.';
			return false;
		}
		if (typeof window !== 'undefined' && !window.isSecureContext) {
			this.status = 'denied';
			this.message = 'Location needs HTTPS (or localhost). See README for phone testing.';
			return false;
		}
		return true;
	}

	#accept(position: GeolocationPosition, status: WatchStatus) {
		const { longitude, latitude, accuracy, heading, speed } = position.coords;
		this.fix = {
			coordinates: [longitude, latitude],
			accuracyM: Number.isFinite(accuracy) ? accuracy : null,
			headingDeg: heading != null && Number.isFinite(heading) ? heading : null,
			speedMps: speed != null && Number.isFinite(speed) ? speed : null,
			timestamp: position.timestamp,
			source: 'gps'
		};
		this.status = status;
		this.message = null;
	}

	#reject(err: GeolocationPositionError) {
		this.status = err.code === err.PERMISSION_DENIED ? 'denied' : 'error';
		this.message =
			err.code === err.PERMISSION_DENIED
				? 'Location permission was blocked for this site.'
				: err.code === err.POSITION_UNAVAILABLE
					? 'No position available — no GPS or network fix yet.'
					: err.message || 'Could not get a position.';
	}

	start() {
		if (this.#watchId !== null) return;
		if (!this.#available()) return;

		this.status = 'locating';
		this.message = null;

		this.#watchId = navigator.geolocation.watchPosition(
			(position) => this.#accept(position, 'live'),
			(err) => this.#reject(err),
			{ enableHighAccuracy: true, maximumAge: 2_000, timeout: 20_000 }
		);
	}

	/**
	 * Grabs a single fresh position without starting a watch. Always resolves —
	 * A failure lands in `status`/`message` rather than throwing.
	 */
	locateOnce(): Promise<void> {
		if (!this.#available()) return Promise.resolve();

		this.status = 'locating';
		this.message = null;

		return new Promise((resolve) => {
			navigator.geolocation.getCurrentPosition(
				(position) => {
					this.#accept(position, this.#watchId !== null ? 'live' : 'located');
					resolve();
				},
				(err) => {
					this.#reject(err);
					resolve();
				},
				{ enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
			);
		});
	}

	stop() {
		if (this.#watchId !== null) {
			navigator.geolocation.clearWatch(this.#watchId);
			this.#watchId = null;
		}
		if (this.status !== 'denied' && this.status !== 'unsupported') this.status = 'idle';
	}
}
