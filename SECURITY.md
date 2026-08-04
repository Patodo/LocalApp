# Security Policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
security advisory flow for the repository and include:

- affected version or commit;
- reproduction steps and expected impact;
- relevant logs with credentials and personal data removed;
- a suggested fix, when available.

Maintainers will acknowledge a complete report as soon as practical, coordinate
validation and remediation privately, and publish an advisory after a fix is
available. Please allow reasonable time for remediation before disclosure.

## Supported versions

Security fixes target the latest released version and the default branch.
Operators should keep LocalApp, its CLI, and Desktop client current.

## Deployment guidance

- Set unique production values for JWT and bootstrap administrator secrets.
- Expose LocalApp through HTTPS and a trusted reverse proxy.
- Back up the data directory before upgrades.
- Restrict administrator access and rotate API keys after suspected exposure.
- Obtain CLI and Desktop artifacts from the release manifest and verify their
  SHA-256 digests.

Never include real credentials, production databases, backups, or uploaded
application files in vulnerability reports.
