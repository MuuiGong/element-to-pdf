# Privacy Policy for Element to PDF

Last updated: June 25, 2026

Element to PDF is a Chrome extension that lets users select a page element and export the selected element and its descendant content as a PDF.

## Summary

Element to PDF does not collect, sell, transfer, or share user data with the developer or any third party. The extension runs locally in the user's browser and does not operate a remote server.

## Page Content

The extension can read page structure and page content only to provide its core features:

- displaying a DOM tree in the side panel;
- highlighting elements selected by the user;
- selecting elements from the page or DevTools;
- preparing the selected element for PDF export;
- generating and downloading the PDF.

Page content is processed locally in the browser. It is not uploaded to the developer or to an external service.

## Temporary Storage

The extension may temporarily store export job data in the browser's local extension storage while preparing a PDF. This storage is used only for the PDF generation workflow and is deleted after the export flow completes when possible.

## Downloads

Generated PDFs are saved to the user's computer through Chrome's download system. The extension does not receive or store copies of downloaded PDFs outside the user's browser.

## Permissions

Element to PDF requests Chrome permissions only for its element selection and PDF export workflow:

- `activeTab`, `tabs`, `scripting`, and host access are used to inspect and interact with pages selected by the user.
- `sidePanel` is used to show the DOM tree and export controls.
- `contextMenus` is used to provide the right-click picker.
- `webNavigation` is used to support accessible frames.
- `debugger` is used only during export to call Chrome's built-in PDF generation APIs, then detach.
- `downloads` is used to save the generated PDF.
- `unlimitedStorage` is used for temporary local export jobs.

## No Remote Code

The extension does not load or execute remote code.

## Contact

For questions or issues, open an issue at:

https://github.com/MuuiGong/element-to-pdf
