# MedHub Reader

Custom reading UI on the stock Mozilla PDF.js engine (`build/pdf.mjs`, `build/pdf.worker.mjs` are untouched; `LICENSE` preserved).

## Files
- `medhub-reader.html` — place next to the `build/` and `web/` folders
- `medhub-reader/reader.css`, `medhub-reader/reader.js`

## Run locally
PDF.js needs http(s), not `file://`:

    cd <this folder> && python3 -m http.server 8000

Open `http://localhost:8000/medhub-reader.html?file=web/compressed.tracemonkey-pldi-09.pdf`
- Local test: open the page with no `?file=`, then use "Open a PDF" or drag a PDF in.
- Optional `&title=Cardiology%20Lecture%201` overrides the title. Spaces and special characters in `?file=` are handled (it is resolved against the page URL).

## Integrate with MedHub
Define this before the module script in `medhub-reader.html`:

    window.MEDHUB_READER_CONFIG = {
      allowedOrigins: ['https://files.medhub.example'], // cross-origin PDFs must be listed and send CORS headers
      getHeaders: async () => ({ Authorization: 'Bearer ' + await getToken() }),
      withCredentials: false
    };

- Only same-origin and listed origins load; anything else shows a friendly error.
- Real protection must be server-side: serve PDFs only to authorized sessions (short-lived signed URLs or token headers). A hidden or removed Download button protects nothing; the Download button here is a convenience.

## Interface
- Top bar: MedHub wordmark, centered title, three-dot menu (Open PDF in browser, Show/Hide outline, Fullscreen reading) and a blue Download button (original, unmodified PDF).
- Sidebar: PDF bookmarks when present (opens by default on wide screens), otherwise a simple page list. On screens under 820px it is a drawer opened from the menu.
- Open PDF in browser opens the original URL in a new tab. For local files, or when `getHeaders` is set, it opens the already-loaded bytes instead so no token ever goes in a URL.

## Notes
- Only pages near the viewport are rendered; off-screen canvases are freed. Canvases are capped at ~16 MP.
- Pages use page 1's size until each renders (mixed-size PDFs adjust on render).
- The zoom percentage label was removed; zoom with the −/+ buttons, Ctrl +/−, or trackpad pinch (Ctrl+wheel).
- Fit-to-width caps at 1100 CSS px for reading comfort. Shortcuts: arrows, Home/End, Ctrl +/−/0.
- iPhone Safari has no element fullscreen, so that button is hidden there.
- Inter loads from Google Fonts; self-host it for zero external requests (system fonts are the fallback).
