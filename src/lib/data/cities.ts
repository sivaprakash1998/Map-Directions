export type City = {
	name: string;
	country: string;
	/** [longitude, latitude] */
	coordinates: [number, number];
	/** metro population, millions */
	population: number;
};

/** A small built-in dataset so the map has something to show with no API keys or fetches. */
export const cities: City[] = [
	{ name: 'Tokyo', country: 'Japan', coordinates: [139.6917, 35.6895], population: 37.4 },
	{ name: 'Delhi', country: 'India', coordinates: [77.1025, 28.7041], population: 32.9 },
	{ name: 'Shanghai', country: 'China', coordinates: [121.4737, 31.2304], population: 29.2 },
	{ name: 'Dhaka', country: 'Bangladesh', coordinates: [90.4125, 23.8103], population: 23.2 },
	{ name: 'São Paulo', country: 'Brazil', coordinates: [-46.6333, -23.5505], population: 22.6 },
	{ name: 'Cairo', country: 'Egypt', coordinates: [31.2357, 30.0444], population: 22.1 },
	{ name: 'Mexico City', country: 'Mexico', coordinates: [-99.1332, 19.4326], population: 22.0 },
	{ name: 'Beijing', country: 'China', coordinates: [116.4074, 39.9042], population: 21.8 },
	{ name: 'Mumbai', country: 'India', coordinates: [72.8777, 19.076], population: 21.3 },
	{ name: 'Osaka', country: 'Japan', coordinates: [135.5023, 34.6937], population: 19.0 },
	{ name: 'Chongqing', country: 'China', coordinates: [106.5516, 29.563], population: 17.8 },
	{ name: 'Karachi', country: 'Pakistan', coordinates: [67.0011, 24.8607], population: 17.2 },
	{ name: 'Kinshasa', country: 'DR Congo', coordinates: [15.2663, -4.4419], population: 17.0 },
	{ name: 'Lagos', country: 'Nigeria', coordinates: [3.3792, 6.5244], population: 16.5 },
	{ name: 'Istanbul', country: 'Türkiye', coordinates: [28.9784, 41.0082], population: 16.0 },
	{ name: 'Buenos Aires', country: 'Argentina', coordinates: [-58.3816, -34.6037], population: 15.6 },
	{ name: 'Kolkata', country: 'India', coordinates: [88.3639, 22.5726], population: 15.6 },
	{ name: 'Manila', country: 'Philippines', coordinates: [120.9842, 14.5995], population: 14.9 },
	{ name: 'Guangzhou', country: 'China', coordinates: [113.2644, 23.1291], population: 14.6 },
	{ name: 'Rio de Janeiro', country: 'Brazil', coordinates: [-43.1729, -22.9068], population: 13.7 },
	{ name: 'Lahore', country: 'Pakistan', coordinates: [74.3587, 31.5204], population: 13.6 },
	{ name: 'Bangalore', country: 'India', coordinates: [77.5946, 12.9716], population: 13.2 },
	{ name: 'Moscow', country: 'Russia', coordinates: [37.6173, 55.7558], population: 12.6 },
	{ name: 'Paris', country: 'France', coordinates: [2.3522, 48.8566], population: 11.2 },
	{ name: 'Jakarta', country: 'Indonesia', coordinates: [106.8456, -6.2088], population: 11.1 },
	{ name: 'Lima', country: 'Peru', coordinates: [-77.0428, -12.0464], population: 11.0 },
	{ name: 'Bangkok', country: 'Thailand', coordinates: [100.5018, 13.7563], population: 10.9 },
	{ name: 'Seoul', country: 'South Korea', coordinates: [126.978, 37.5665], population: 10.0 },
	{ name: 'Nagoya', country: 'Japan', coordinates: [136.9066, 35.1815], population: 9.6 },
	{ name: 'London', country: 'United Kingdom', coordinates: [-0.1276, 51.5072], population: 9.5 },
	{ name: 'New York', country: 'United States', coordinates: [-74.006, 40.7128], population: 8.4 },
	{ name: 'Tehran', country: 'Iran', coordinates: [51.389, 35.6892], population: 9.5 },
	{ name: 'Ho Chi Minh City', country: 'Vietnam', coordinates: [106.6297, 10.8231], population: 9.3 },
	{ name: 'Luanda', country: 'Angola', coordinates: [13.2343, -8.8368], population: 9.0 },
	{ name: 'Chengdu', country: 'China', coordinates: [104.0665, 30.5723], population: 9.5 },
	{ name: 'Nairobi', country: 'Kenya', coordinates: [36.8219, -1.2921], population: 5.3 },
	{ name: 'Johannesburg', country: 'South Africa', coordinates: [28.0473, -26.2041], population: 6.2 },
	{ name: 'Madrid', country: 'Spain', coordinates: [-3.7038, 40.4168], population: 6.7 },
	{ name: 'Toronto', country: 'Canada', coordinates: [-79.3832, 43.6532], population: 6.4 },
	{ name: 'Los Angeles', country: 'United States', coordinates: [-118.2437, 34.0522], population: 3.9 },
	{ name: 'Chicago', country: 'United States', coordinates: [-87.6298, 41.8781], population: 2.7 },
	{ name: 'Sydney', country: 'Australia', coordinates: [151.2093, -33.8688], population: 5.3 },
	{ name: 'Melbourne', country: 'Australia', coordinates: [144.9631, -37.8136], population: 5.1 },
	{ name: 'Berlin', country: 'Germany', coordinates: [13.405, 52.52], population: 3.6 },
	{ name: 'Singapore', country: 'Singapore', coordinates: [103.8198, 1.3521], population: 6.0 },
	{ name: 'Riyadh', country: 'Saudi Arabia', coordinates: [46.6753, 24.7136], population: 7.7 },
	{ name: 'Santiago', country: 'Chile', coordinates: [-70.6693, -33.4489], population: 6.9 },
	{ name: 'Bogotá', country: 'Colombia', coordinates: [-74.0721, 4.711], population: 11.3 },
	{ name: 'Chennai', country: 'India', coordinates: [80.2707, 13.0827], population: 11.5 },
	{ name: 'Hong Kong', country: 'China', coordinates: [114.1694, 22.3193], population: 7.5 }
];
