# Security Policy

## Supported Versions

Security fixes are expected to land on the current `main` branch. No long-term maintenance branches are defined yet.

## Reporting a Vulnerability

Please do not report security issues in public issues.

Use GitHub private vulnerability reporting if it is enabled for the repository. If it is not enabled, contact the repository maintainer through the GitHub owner profile and include only the minimum information needed to establish a private reporting channel.

## Scope

Security-sensitive areas include:

- Launching and discovering the local or remote `opencode` binary.
- Requests sent to `opencode serve`.
- Temporary file handling for pasted images and prompt attachments.
- Webview content security policy and message validation.
- Permission and question prompt handling.

Do not include API keys, provider credentials, private prompts, or session exports in public reports.
