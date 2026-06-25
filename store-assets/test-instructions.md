# Chrome Web Store Review Test Instructions

No account, paid service, or external setup is required.

## Side Panel Workflow

1. Install the extension.
2. Open a normal `https://` web page, such as `https://example.com`.
3. Click the Element to PDF extension icon to open the Chrome side panel.
4. Wait for the DOM tree to load.
5. Select a visible element in the tree.
6. Confirm that the selected element is highlighted on the page.
7. Click **Export PDF**.
8. Choose a save location when Chrome prompts for the download.
9. Verify that a PDF file is downloaded.

## Context Menu Workflow

1. Open a normal `https://` web page.
2. Right-click the page.
3. Choose **Pick element for PDF**.
4. Click a visible page element.
5. Confirm that the selected element is highlighted.
6. Export the selected element from the side panel.

## DevTools Workflow

1. Open Chrome DevTools on a normal web page.
2. Select an element in the Elements panel.
3. Open the **Element to PDF** sidebar in DevTools.
4. Click the export control.
5. Verify that a PDF file is downloaded.

## Known Chrome Restrictions

- The extension cannot run on Chrome system pages such as `chrome://` URLs.
- The extension cannot run on Chrome Web Store listing pages.
- The extension cannot run inside restricted sandboxed frames.
- Local `file://` pages require file access to be enabled by the user in Chrome extension settings.
