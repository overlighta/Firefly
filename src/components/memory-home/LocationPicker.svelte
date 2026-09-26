<script lang="ts">
import { findCity, searchCities } from "@/lib/memory/locations";

export let value = "";
export let latitude = "";
export let longitude = "";
export let recent: string[] = [];

$: city = findCity(value);
$: usingSavedPosition = city && latitude !== "" && longitude !== "" &&
	(Math.abs(Number(latitude) - city.latitude) > 0.00001 || Math.abs(Number(longitude) - city.longitude) > 0.00001);
$: suggestions = searchCities(value);
$: place = city ? value.split("·").slice(1).join("·").replace(/^ /, "") : "";
$: recentPlaces = [...new Set(recent.filter(Boolean))].filter(item => item !== value).slice(0, 4);

function changeLocation(next: string) {
	value = next;
	const selected = findCity(next);
	latitude = selected ? String(selected.latitude) : "";
	longitude = selected ? String(selected.longitude) : "";
}
function changePlace(next: string) {
	if (city) value = next.trim() ? `${city.name} · ${next}` : city.name;
}
</script>

<div class="journal-location">
	<label>
		<span>城市或地点，可选</span>
		<input value={value} on:input={(event) => changeLocation(event.currentTarget.value)} placeholder="搜索城市，也可以直接写地点" autocomplete="off" />
	</label>
	{#if suggestions.length > 0}
		<div class="journal-location__choices" aria-label="城市选择">
			{#each suggestions as item}
				<button type="button" class:is-selected={city?.name === item.name} aria-pressed={city?.name === item.name} on:click={() => changeLocation(item.name)}>{item.name}<span aria-hidden="true">{city?.name === item.name ? " ✓" : " +"}</span></button>
			{/each}
		</div>
	{/if}
	{#if city}
		<label>
			<span>具体地点，可选</span>
			<input value={place} on:input={(event) => changePlace(event.currentTarget.value)} placeholder="例如：玄武湖、家里、喜欢的咖啡店" />
		</label>
	{/if}
	{#if recentPlaces.length > 0}
		<details class="journal-location__recent">
			<summary>用最近记录过的地点</summary>
			<div class="journal-location__choices">
				{#each recentPlaces as item}<button type="button" on:click={() => changeLocation(item)}>{item}</button>{/each}
			</div>
		</details>
	{/if}
	<p class="journal-location__hint" aria-live="polite">{usingSavedPosition ? "已保留原来标记的位置。点击城市按钮，可改用这座城市的大致位置。" : city ? `已选择${city.name}，足迹将标记在城市附近。具体地点作为文字保存。` : latitude && longitude ? "已保留这条记录原来的地图位置。" : "选择内置城市会自动点亮足迹；其他地点也可以直接保存。"}</p>
</div>
