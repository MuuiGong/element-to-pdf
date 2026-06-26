# Element to PDF

Select a specific element on a web page and export that element to a PDF.

Element to PDF is a Chrome extension for saving only the part of a page you care about. Open the side panel to browse a DevTools-style DOM tree, select an HTML element, preview the highlight on the page, and export the selected element and its child content as a PDF.

The Chrome Web Store display name is **Element to PDF**. The repository, package, and release artifact name remain `element-to-pdf`.

## Features

- Side panel DOM tree for inspecting the current page without opening Chrome DevTools.
- Search by tag, `#id`, `.class`, or visible text.
- Page highlighting before export so you can confirm the selected element.
- Right-click **Pick element for PDF** workflow for direct on-page selection.
- DevTools Elements sidebar support for exporting the currently inspected element.
- Frame support on pages where Chrome allows extension access.
- Local PDF generation through Chrome's built-in browser APIs.

## How To Use

1. Open a normal web page.
2. Click the Element to PDF extension icon to open the side panel.
3. Choose an element from the tree, or click **Pick** and select an element on the page.
4. Confirm the highlighted selection.
5. Click **Export PDF**.
6. Save the generated PDF when Chrome prompts for the download.

You can also right-click a page and choose **Pick element for PDF** to start selection immediately.

## What Gets Exported

The extension exports the selected DOM element and its descendant content. Parent containers, sibling elements, browser UI, and unrelated page content are intentionally excluded.

The primary export path prepares the original source tab with temporary print-only isolation styles, calls Chrome DevTools Protocol `Page.printToPDF`, then restores the page. This keeps the page's real DOM, CSS, fonts, layout context, and rendered state as close to the visible page as Chrome's PDF printer allows.

## Browser Limits

Chrome extensions cannot run everywhere. Element to PDF cannot inject into Chrome internal pages such as `chrome://`, Chrome Web Store pages, most other extension pages, or sandboxed frames that block extension access. Local `file://` pages require the user to enable file access for the extension in Chrome settings.

## Privacy

Element to PDF runs locally in your browser. It does not upload page content, generated PDFs, browsing history, or user activity to a remote server.

The extension reads page content only after you open the panel, inspect the tree, pick an element, or start an export. Temporary export data may be stored in the extension's local browser storage while a PDF is being prepared.

Read the full privacy policy in [PRIVACY.md](PRIVACY.md).

## Permissions

Element to PDF uses Chrome permissions for its core workflow:

- `activeTab`, `tabs`, `scripting`, and `<all_urls>` let the extension inspect and interact with pages the user chooses.
- `sidePanel` shows the element tree and export controls.
- `contextMenus` adds the right-click picker entry.
- `webNavigation` finds accessible frames in the current tab.
- `debugger` calls Chrome's built-in PDF generation API only during export.
- `downloads` saves the generated PDF.
- `unlimitedStorage` prevents temporary export jobs from failing on larger pages.

Detailed Chrome Web Store permission text is in [store-assets/permission-justifications.md](store-assets/permission-justifications.md).

## Install For Development

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository directory.
5. Reload the extension after code changes.

## Release Package

The Chrome Web Store upload package is built under:

```text
dist/element-to-pdf-0.1.2.zip
```

Chrome Web Store listing drafts, permission justifications, review test instructions, and submission notes are in [store-assets](store-assets).
