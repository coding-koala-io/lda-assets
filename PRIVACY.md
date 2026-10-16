# Privacy

LDA Local Assets ("the tool") is a free, development-only local stand-in compatible with Optimizely DAM for Optimizely CMS 13. It is part of Local Developer Accelerator for Optimizely, by Coding Koala. This notice explains what data it handles.

## Summary
- The tool runs entirely on your own computer.
- It has no telemetry, analytics, crash reporting or tracking. Coding Koala receives no data from it.
- It stores the assets you upload and copies of what your CMS site sends it on your disk. Treat that folder as sensitive.

## Network connections
The tool only connects to other computers in these cases:

| When | Destination | What is sent |
|---|---|---|
| Installing as a Windows service (once) | github.com (WinSW release download) | A normal download request (your IP address) |
| Checking for updates with the LDA CLI (only when you ask, or if you turn on automatic checks) | api.github.com / registry.npmjs.org | Your IP address and the current version |

Everything else is traffic between your CMS site, your browser and the local services on your own machine (127.0.0.1), including the Graph gateway address you link an instance to (normally the local LDA Local Graph).

## What is stored
Data folder (default `C:\ProgramData\Coding Koala\Local Developer Accelerator\Assets`, or the folder you chose at install):
- Assets you upload, with their titles, descriptions, alt text, tags and folders, and the sample assets you add.
- Usage (lineage) records sent by your CMS site, which include page names and addresses.
- Generated client IDs and secrets for each instance, and the Graph credentials you enter.
- Request logs, which can contain full request and response bodies. Authentication headers are redacted, but content in bodies is not.

When installed as a service, the data folder is readable only by administrators and the service account. Do not copy it to shared drives, tickets or source control.

## Your responsibility
If your assets or CMS content contain personal data, you (or your employer or client) remain responsible for it under the law that applies to you (for example the Privacy Act 1988 or GDPR). Coding Koala never receives it and is not a processor of it. Prefer test data over production copies.

## Deleting data
- One instance: use "Delete instance" in the instance's dashboard page and choose "Delete local data and log folders".
- One instance's assets: use "Clear instance" in the instance's dashboard page.
- Everything: run `lda uninstall --purge`, or stop the service and delete the data folder (`scripts\service.ps1 uninstall -RemoveData`).

## Contact
Questions: privacy@codingkoala.io. Last updated: 2026-10-16.
