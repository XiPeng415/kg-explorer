# kg-explorer

Static frontend for the Singapore Urban KG explorer.

## GitHub Pages deployment

Use repository root as publish source.

- Keep `index.html` at repository root (it redirects to `kg-explorer/`).
- Keep `kg-explorer/index.html` and `kg-explorer/viz_data.js` in the same folder.
- If your `viz_data.js` is generated at repo root, `kg-explorer/index.html` also includes a fallback `../viz_data.js`.

After pushing:

1. Wait for GitHub Pages build to finish.
2. Hard refresh (`Cmd+Shift+R`).
3. In DevTools Network tab, confirm at least one of these is `200`:
   - `kg-explorer/viz_data.js`
   - `viz_data.js`
