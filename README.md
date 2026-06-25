# element-to-pdf

Chrome MV3 extension prototype for selecting a page element and exporting that element to PDF.

## What it supports

- Browser action: click the extension icon to open the docked **side panel** — a DevTools-like element tree that stays pinned while you browse.
- Side panel tree: select a DOM node to highlight it and scroll it into view on the page, then export it as a PDF.
- Side panel tree: double-click a DOM node to export it immediately. Filter the tree by tag, `#id`, `.class`, or text, and navigate with the arrow keys.
- Page context menu: right-click a page and choose **Pick element for PDF** to start direct on-page picking.
- DevTools Elements sidebar: select an element in Elements, then export it from the **element-to-pdf** sidebar.
- Normal pages, popup windows, modal overlays, nested frames, `about:blank` frames initiated by a matched page, and newly opened tabs/windows covered by `<all_urls>`.

## Hard browser limits

Chrome extensions are not truly unrestricted. This extension still cannot inject into Chrome internal pages such as `chrome://`, the Chrome Web Store, most other extension pages, sandboxed frames that block extension injection, or local files unless the user enables file access for the extension.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this directory: `D:\pdf-extension`.
5. After code changes, click **Reload** on the extension card before testing again.

## Notes

The default capture path exports only the selected DOM element and its descendant subtree by applying temporary print-only isolation CSS inside the original source tab, then calling Chrome DevTools Protocol `Page.printToPDF` on that same tab. This keeps the page's own DOM, CSS, fonts, layout context, and rendered state instead of reconstructing the element in a separate print page. The older visual/DOM clone paths are retained as implementation fallbacks, but normal element export should use the source-tab print path. Large fallback captures are staged in extension IndexedDB instead of `chrome.storage.session` to avoid small session-storage quotas.

The export intentionally excludes ancestors and siblings of the selected element.
