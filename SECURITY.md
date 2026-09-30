# Security Policy

## Reporting a vulnerability

**Please do not open a public issue.** Report it through [GitHub's private vulnerability reporting](../../security/advisories/new).

Please include: the affected commit or version, reproduction steps, the impact you believe it has, and how you would like to be credited.

## What to expect

- Acknowledgement within 3 business days
- A note in the [CHANGELOG](CHANGELOG.md) once fixed, with credit to the reporter where possible
- Please keep the details private until a fix is released

## What we care about most

This is **self-hosted software**: site data lives in the deployer's **own Cloudflare account**, and the project does not hold any user data. The highest-priority issues are therefore:

| Category | Description |
| :---- | :---- |
| Template sandbox escape | Arbitrary code execution, privilege escalation, or resource exhaustion (render limits bypassed) |
| Asset boundary failure | Frontend framework code or editor runtime leaking into the site build output |
| Admin auth / CSRF bypass | Unauthorized access to administrative endpoints |
| Template validation bypass | Getting an invalid template saved despite server-side compilation checks |
| Supply chain | A dependency that is compromised or carries a known high-severity vulnerability |

## Out of scope

- Attacks that require an attacker to already fully control the deployer's Cloudflare account
- Issues introduced by deployers modifying the source or configuration themselves
- Purely theoretical reports without reproduction steps
