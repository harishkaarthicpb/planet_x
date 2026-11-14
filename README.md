# Planet X

A minimal website starter using HTML, CSS, vanilla JavaScript, and a Node.js
local preview server. No external dependencies or build step.

## Run locally

Install Node.js with npm, then run from this folder:

```bash
npm start
```

Open http://localhost:8000. Keep the terminal running. Refresh the browser after
editing files, and press Ctrl+C to stop the server.

If another project is already using port 8000, stop its server first, or run
`PORT=8001 npm start` and open http://localhost:8001.

## Files

- `index.html`: page content
- `style.css`: styling
- `script.js`: browser interactions
- `server.js`: local static file server; add new assets to its routes as needed
- `package.json`: npm start command
