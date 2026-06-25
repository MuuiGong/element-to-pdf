# Chrome Web Store Review Test Instructions

No account or paid service is required.

1. Install the extension.
2. Open any normal `https://` web page, such as `https://example.com`.
3. Click the extension action to open the Chrome side panel.
4. Wait for the DOM tree to load.
5. Select a visible element in the tree. The element should highlight on the page.
6. Click **Export PDF** and choose a save location when prompted.
7. Verify that a PDF file is downloaded.

Additional workflow:

1. Right-click on a normal web page.
2. Choose **Pick element for PDF**.
3. Click a visible page element.
4. Verify that the selected element export flow starts.

Known Chrome restrictions:

- The extension cannot run on Chrome system pages such as `chrome://` URLs.
- The extension cannot run on the Chrome Web Store listing pages.
- Local `file://` pages require file access to be enabled by the user in Chrome extension settings.
