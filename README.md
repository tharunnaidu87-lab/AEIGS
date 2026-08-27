# AEGIS FieldGrid UI — Windows-safe Vite build

This package is the same FieldGrid AEGIS interface, converted from the ChatGPT Work `vinext/Next/Cloudflare` runtime to a standard Vite + React application.

## Why this fixed build exists

The previous build could show:

`TypeError: Cannot read properties of null (reading 'useContext')`

inside `vinext/dist/shims/slot.js` on local Windows development. The AEGIS application logic itself was not the source of that crash; it came from the framework compatibility layer used by the exported Work project.

This fixed package removes that compatibility layer and uses plain Vite + React. AEGIS algorithms, pages, storage, maps, report flow, command center, responder, What-If and relocation UI remain in the application.

## Run on Windows

Open this exact folder in VS Code, then use Command Prompt:

```cmd
npm install
npm run dev
```

Open `http://localhost:5173/`.

If you copied this over an older project, delete the old `node_modules` folder first.

## Routes

- `/` — Command Center
- `/command` — Command Center
- `/report` — Citizen report
- `/track/<REPORT-ID>` — Track a report
- `/responder` — Responder view
- `/simulate` — What-If simulator
- `/relocation` — Red-zone / relocation center
- `/landing` — role-selection landing screen

## Notes

- The operational map loads Leaflet from the public CDN at runtime.
- OSRM/Nominatim features need internet access.
- Prototype operational state is stored in localStorage.
