# Security policy

Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security advisories) on this repository rather than in public issues.

Design notes:

- Projects are stored client-side (IndexedDB); the server only proxies AI requests and never stores project data.
- No marketplace (KDP) credentials are ever requested or stored.
- Uploaded SVGs are rasterized inside an `<img>` element, so embedded scripts never execute.
- AI output is schema-validated before it can modify a project; imported research text is passed to models as tagged data, not instructions.
