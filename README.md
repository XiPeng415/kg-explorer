# kg-explorer

Static frontend for the Singapore Urban KG explorer.

## GitHub Pages deployment

Use repository root as publish source.

- Keep `index.html` at repository root (it redirects to `kg-explorer/`).
- The explorer loads data from `/kg-explorer/viz_data.js` (absolute path for GitHub project pages).
- Ensure `viz_data.js` exists at repository root after generation.

After pushing:

1. Wait for GitHub Pages build to finish.
2. Hard refresh (`Cmd+Shift+R`).
3. In DevTools Network tab, confirm this is `200`:
   - `/kg-explorer/viz_data.js`
