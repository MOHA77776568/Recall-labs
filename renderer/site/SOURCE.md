# Recall Lab public interface

The user owns the source website and requested a local desktop copy of it.
These assets were retrieved with ordinary public HTTPS GET requests from
https://recall-lab.moha77776568.chatgpt.site/ on 2026-10-12.
No account authentication, private API data, or credentials were copied.
The original workspace endpoint returned HTTP 401 without authentication.

The published React interface, Tailwind stylesheet, React runtime, PDF.js
decoder, PDF worker, and icon are preserved locally. Existing upstream
copyright and license notices remain in their respective files. There are
no runtime CDN, font, or website dependencies.

`source-manifest.json` records the original and local SHA-256 checksums and
every replacement in the original application bundle. Those replacements
use a local module loader, locate the PDF worker locally, and adapt visible
cloud/account messages to describe local saves accurately. GitHub synchronization and update settings are accessed
through the local control panel. The sign-out link now opens that panel;
this local application does not have a ChatGPT login.

`fsrs-original.js` extracts the self-contained FSRS scheduling section of
the same public bundle, with a thin JSON wrapper for browser and Node use.
Its defaults remain 90% requested retention and fuzz disabled, matching the
original interface's interval previews. The original published asset does
not disclose an npm version, so the source checksum identifies the preserved
implementation. The extracted implementation includes the original Date
helpers. No scheduling approximation is used.

`bootstrap.js`, `preload-shim.js`, `index.html`, and `local-shell.css` implement
the local bridge and navigation. The original interface keeps its courses,
lecture sources, review scheduling, free-recall writing and reflection,
file extraction, import, and export behavior. Its workspace schema remains
version 1 within the separately versioned synchronization document.

To transfer existing account data, export `Download JSON backup` from the
website's `Data & settings`, then use `Import CSV or JSON` here. The original
export deliberately omits attachment IDs and binary files; download and
reattach those files separately. Local attachment binaries stay on the
device; source text and notes are included in the synchronized workspace.
