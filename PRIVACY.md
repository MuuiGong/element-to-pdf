# Privacy Policy for Element PDF Extractor

Last updated: June 25, 2026

Element PDF Extractor is a Chrome extension that lets users select a page element and export it as a PDF.

## Data collection

Element PDF Extractor does not collect, sell, transfer, or share user data with the developer or any third party.

The extension can read the current web page only to provide its core feature: showing an element tree, highlighting elements, and exporting a user-selected element to a PDF. Page content is processed locally in the browser.

## Data storage

The extension may temporarily store generated print jobs in the browser's local extension storage while preparing a PDF. This temporary data is used only for PDF generation and is deleted after the export flow completes when possible.

The extension does not run a remote server and does not upload page content, PDFs, browsing history, or user activity to any external service.

## Permissions

Element PDF Extractor requests Chrome permissions only for its element selection and PDF export workflow:

- Access to web pages is used to inspect and export user-selected elements.
- Debugger access is used to call Chrome's built-in PDF generation APIs on the current tab after the user starts an export.
- Downloads access is used to save the generated PDF.
- Tabs, scripting, web navigation, side panel, and context menu permissions are used to integrate the picker, side panel, frame support, and right-click workflow.

## Contact

For questions or issues, open an issue at:

https://github.com/MuuiGong/element-to-pdf
