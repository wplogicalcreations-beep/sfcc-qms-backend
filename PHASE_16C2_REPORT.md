# Phase 16C-2 Runtime Readiness Report

Date: 2026-05-25 (UTC)

## Summary

`npm install` is blocked by environment-level proxy/security policy (HTTP 403 responses from npm registry via configured proxy env vars). This is not an application source code defect.

## What was checked

- No project-level `.npmrc` found at repository root.
- No backend-level `.npmrc` found in `backend/`.
- npm registry configured as `https://registry.npmjs.org/`.
- npm config shows proxy values are injected through environment variables.
- `backend/package.json` includes `express-rate-limit` and `puppeteer`.
- `backend/package-lock.json` does not include `express-rate-limit`, confirming lockfile desync.

## Command outcomes

- `npm config get registry` => `https://registry.npmjs.org/`
- `npm install` => `E403 403 Forbidden - GET https://registry.npmjs.org/express-rate-limit`
- `npm view express version` => `E403`
- `npm view express-rate-limit version` => `E403`
- `npm view puppeteer version` => `E403`

Because even metadata reads are blocked, this is a network/proxy policy issue outside application code.

## Required environment/CI fix

Run in CI/host where npm egress is allowed to `registry.npmjs.org`, or ensure the corporate proxy explicitly allows npm package metadata/tarball endpoints.

Suggested commands:

```bash
cd backend
npm config delete proxy || true
npm config delete https-proxy || true
npm config set registry https://registry.npmjs.org/
# if env vars are forced, clear them for the install shell:
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy npm_config_http_proxy npm_config_https_proxy
npm install
```

If the environment requires a proxy, configure an allowlist for package endpoints and retain CA trust settings.

## Lockfile action status

`backend/package-lock.json` was not regenerated because install access is currently blocked.

## Puppeteer/runtime status

Could not validate runtime (`require('puppeteer')`, `executablePath()`, `generatePdfBuffer`) because dependencies cannot be installed under current environment policy.

## PDF generation status

Could not generate actual PDFs for Material Submittal, Drawing Submittal, RFI, Inspection Request, or Handover Certificate due to blocked npm dependency installation.

