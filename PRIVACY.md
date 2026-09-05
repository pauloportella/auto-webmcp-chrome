# Privacy Policy for Auto WebMCP

Effective for version 0.11.0 when published. Updated September 5, 2026.

Auto WebMCP turns web forms, standalone inputs, supported widgets, and searches into structured tools that compatible browser agents can discover and invoke.

## Data handled locally

Auto WebMCP reads page structure and descriptive metadata, including control names, labels, placeholders, ARIA text, validation constraints, option labels and values, and the page title. It uses this information to describe and register tools in the current page. Search discovery also reads declared form routes and the current page URL.

When a tool is invoked, Auto WebMCP processes the values supplied by the browser agent. Fill tools write supported controls and read their current values to validate and verify the requested changes. Widget tools activate disclosures or options and inspect selected state or a linked control's value to verify the outcome. Depending on the page and requested action, these values may include personal, authentication, financial, health, communication, or location information.

Processing runs in the user's browser. Auto WebMCP has no analytics, advertising, telemetry, accounts, or developer-operated remote services. It does not send page content or tool arguments to its developer or sell them. Website interactions and search navigation can send data to the destination website as described below. A browser agent or client that accesses the page's tools has its own data-handling practices.

## Website behavior

Fill tools dispatch edit events and use native clicks for checkbox or radio changes. Widget tools click supported controls. The website may react by sending data, changing state, or navigating according to its own functionality and privacy policy. Fill tools do not call form submission; this does not prevent the website from reacting to edits or clicks.

Search tools navigate the current tab to a supported search URL. This sends search parameters to the destination website. For supported native GET forms, the URL includes supplied values and current values for omitted fields, plus successful hidden fields and the supported submit button. Forms containing password, file, or image inputs are excluded from generic search routing. The Willhaben adapter constructs a marketplace URL from the supplied query and supported filters.

Search parameters can appear in browser history and destination website logs. Use these tools only for searches you intend to send to that website. The extension does not call the website's submit or form-data event handlers when constructing a search URL.

The production extension does not persist entered values or learned search mappings. Generated metadata and registrations exist in the current page. They are removed when the page is closed or navigated away from; website state and browser history follow the website's and browser's own behavior.

## Website access

Auto WebMCP runs on top-level HTTP and HTTPS pages to make supported controls and searches available as WebMCP tools. Chrome's **Site access** control can restrict the websites on which the extension runs. Chrome-protected pages do not allow the extension to run.

## Policy changes

This policy will be updated before a release changes how Auto WebMCP handles data.
