# Chrome Web Store Permission Justifications

Use these explanations in the Chrome Web Store Privacy and permissions forms.

## Single purpose

Element PDF Extractor lets users select a specific element on a web page and export that selected element as a PDF.

## activeTab

Used to interact with the currently active tab after the user opens the panel or starts an element-picking action.

## contextMenus

Used to add a right-click menu item that starts element selection directly from the page.

## debugger

Used only after the user starts an export, to call Chrome DevTools Protocol PDF generation for the selected tab. It is not used to monitor browsing activity, inspect network traffic, or debug arbitrary pages in the background.

## downloads

Used to save the generated PDF file to the user's computer.

## scripting

Used to inject the extension's content script into accessible frames so the user can select, highlight, and export page elements.

## sidePanel

Used to show the extension's DOM tree and export controls in Chrome's side panel.

## tabs

Used to identify the active tab, update panel state, and route export messages to the correct tab.

## unlimitedStorage

Used to avoid Chrome storage quota failures while temporarily preparing larger PDF export jobs. Temporary export data is not uploaded and is used only during the export workflow.

## webNavigation

Used to discover accessible frames in the current tab so element selection works in pages with iframes.

## Host permission: <all_urls>

Used because the extension's purpose is to let users select and export elements from arbitrary web pages they choose. The extension cannot perform its core function if it is restricted to a fixed set of websites.

## Remote code

The extension does not load or execute remote code.

## Data usage

Page content is processed locally in the user's browser to display the element tree, highlight selections, and generate PDFs. The extension does not sell, transfer, or upload user data.
