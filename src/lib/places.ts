import type { LngLat } from '$lib/geo/geometry';

export type Place = {
	id: string;
	name: string;
	detail: string;
	coordinates: LngLat;
};

/**
 * Coordinates from OpenStreetMap (Nominatim), both tagged `highway=bus_station`.
 */
export const DHARAPURAM_BUS_STAND: Place = {
	id: 'dharapuram',
	name: 'Dharapuram Main Bus Stand',
	detail: 'Oddanchatram – Dharapuram – Tiruppur Rd',
	coordinates: [77.5191099, 10.7331186]
};

export const TIRUPPUR_NEW_BUS_STAND: Place = {
	id: 'tiruppur-new',
	name: 'Tiruppur New Bus Stand',
	detail: 'Perumanallur Rd, Pitchampalayam',
	coordinates: [77.3412118, 11.132086]
};

export const TIRUPPUR_KOYIL_VAZHI_BUS_STAND: Place = {
	id: 'tiruppur-koyilvazhi',
	name: 'Koyil Vazhi Bus Stand, Tiruppur',
	detail: 'Tiruppur – Dharapuram Rd, Karatangadu',
	coordinates: [77.3883476, 11.0582456]
};

/** Tiruppur has more than one stand; buses from Dharapuram may use either. */
export const DESTINATIONS: Place[] = [TIRUPPUR_NEW_BUS_STAND, TIRUPPUR_KOYIL_VAZHI_BUS_STAND];
