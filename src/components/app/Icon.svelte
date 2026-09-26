<script lang="ts">
export let name = "home";
const paths: Record<string, string> = {
  home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  timeline: "M7 3v18M4 6h6m-6 6h6m-6 6h6m4-12h6m-6 6h6m-6 6h4",
  map: "m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Zm6-3v15m6-12v15",
  memories: "M4 5h16v15H4ZM8 2v6m8-6v6M4 10h16m-12 4h3m2 0h3m-8 3h3",
  space: "M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-2a6 6 0 0 1 12 0v2m1-16a4 4 0 0 1 0 7m2 3a6 6 0 0 1 5 6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm6-2 5 5",
  lock: "M6 10h12v11H6Zm3 0V6a3 3 0 0 1 6 0v4m-3 4v3",
};
</script>
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.home} /></svg>
