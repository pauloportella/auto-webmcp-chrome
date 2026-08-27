# Privacy Policy for Auto WebMCP

Effective date: August 26, 2026

Auto WebMCP has one purpose: to turn standard web forms into structured WebMCP tools that compatible browser agents can use to populate supported controls.

## Data handled locally

Auto WebMCP reads form structure and descriptive metadata, including form and field names, labels, placeholders, ARIA text, validation constraints, option labels and values, and the page title. This information is used only to describe and register WebMCP tools in the current page.

When a generated tool is invoked, Auto WebMCP processes the values supplied by the browser agent and writes them to the matching form controls. Depending on the form, those values may include personally identifiable information, authentication information, financial or payment information, health information, personal communications, or location information. Auto WebMCP processes these values locally only to populate the requested controls. It does not inspect existing user-entered text or selected state. It never submits a form.

All processing by Auto WebMCP occurs locally in the user's browser. The extension does not collect, retain, sell, transmit, or share website content, form data, personal data, browsing history, or credentials with its developer or third parties. It has no analytics, advertising, telemetry, accounts, or remote services.

## Website behavior

Populating a control triggers the same input and change events that a website normally receives when a field is edited. The website may process those values according to its own functionality and privacy policy. Data is sent to the website only if the website reacts to those events or the user or agent later submits the form; Auto WebMCP itself makes no production network requests.

Generated metadata and tools exist only in the current page and are removed when the page is closed or navigated away from.

## Website access

Auto WebMCP runs on ordinary HTTP and HTTPS pages because its single purpose is to make forms available as WebMCP tools wherever the user encounters them. Chrome's **Site access** control can restrict the websites on which the extension runs. Chrome-protected pages do not allow the extension to run.

## Policy changes

This policy will be updated before a release changes how Auto WebMCP handles data.
