<script lang="ts">
	import TrackerMap from '$lib/components/TrackerMap.svelte';
</script>

<svelte:head>
	<title>Dharapuram → Tiruppur · live tracking</title>
	<meta
		name="description"
		content="Live position tracking along the road route from Dharapuram bus stand to Tiruppur bus stand."
	/>
</svelte:head>

<main>
	<TrackerMap />
</main>

<style>
	main {
		position: fixed;
		inset: 0;
	}
</style>
