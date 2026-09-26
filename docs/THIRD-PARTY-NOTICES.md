# City locations

The preset city centers in `src/lib/memory/cities.ts` are selected and simplified
from the GeoNames `cities15000` dataset, downloaded on 2026-09-26.

- Source: https://download.geonames.org/export/dump/
- Attribution: GeoNames, https://www.geonames.org/
- License: Creative Commons Attribution 4.0, https://creativecommons.org/licenses/by/4.0/
- Changes: a selection of Chinese city names and search aliases, with only city-center coordinates retained.

These are approximate city positions, not addresses or landmark coordinates.
No online geocoding service is called. Existing explicitly saved coordinates take precedence.
