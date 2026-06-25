# Chrome Web Store Permission Justifications

Use these explanations in the Chrome Web Store privacy and permissions forms.

## Single purpose

Element to PDF lets users select a specific HTML element on a web page and export that selected element and its descendant content as a PDF.

## activeTab

Used to interact with the active tab after the user opens the side panel, starts the picker, selects an element, or exports a PDF.

## contextMenus

Used to add the right-click **Pick element for PDF** menu item so users can start element selection directly from the page.

## debugger

Used only after the user starts an export. The extension attaches to the selected tab, calls Chrome DevTools Protocol PDF generation APIs, then detaches. It is not used to monitor browsing activity, inspect network traffic, or debug pages in the background.

## downloads

Used to save the generated PDF file to the user's computer.

## scripting

Used to inject the extension's content script into accessible pages and frames so users can view the DOM tree, highlight elements, pick elements, and prepare the selected element for export.

## sidePanel

Used to show the element tree, selection details, picker controls, and export button in Chrome's side panel.

## tabs

Used to identify the active tab, keep side panel state connected to the correct page, and route export messages to the selected tab and frame.

## unlimitedStorage

Used to prevent temporary export jobs from failing on larger pages. Temporary export data remains local to the browser and is used only during PDF generation.

## webNavigation

Used to discover accessible frames in the current tab so element selection and export can work on pages that contain iframes.

## Host permission: <all_urls>

Used because the extension's single purpose is to let users select and export elements from web pages they choose. The extension cannot provide this workflow if it is limited to a fixed list of domains.

## Remote code

The extension does not load or execute remote code.

## Data usage

Page content is processed locally in the user's browser to display the DOM tree, highlight selections, and generate PDFs. The extension does not collect, sell, transfer, or upload user data.
