<script lang="ts">
	import DeckMap from '$lib/components/DeckMap.svelte';
</script>

<svelte:head>
	<title>World metro areas · deck.gl</title>
</svelte:head>

<main>
	<DeckMap />
</main>

<style>
	main {
		position: fixed;
		inset: 0;
	}
</style>
