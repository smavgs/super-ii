# http-cache-semantics temporary security pin

This directory vendors `http-cache-semantics` for the Super ii build pipeline while no patched npm release exists for CVE-2026-93748 / GHSA-ch52-4w7c-c8xp.

- Upstream repository: `kornelski/http-cache-semantics`
- Upstream base: `f01112e954b83cfa8765b633ba880e5e980aa54c` (`4.2.0`)
- Upstream fix proposal: `kornelski/http-cache-semantics#58`
- Reviewed patch commit: `hellonewday/http-cache-semantics@14a8c2ad51740dc39bf3e8f1a11c845a5003f217`
- Local package version: `4.2.1-superii.1`
- Reviewed `index.js` SHA-256: `fc7b3f0265b7a7d0fee83bafa47186a66495720d3179801c2be3083de6d0cf76`

The patch prevents an attacker-controlled `Cache-Control: max-stale` directive from reusing shared responses whose zero lifetime represents a security boundary, including private `Set-Cookie`, `proxy-revalidate`, and `no-cache` responses. `tools/check-http-cache-semantics.mjs` verifies the exact vulnerable scenarios on every validation run.

Replace this directory with the first trusted upstream release that includes the fix, then keep the regression test.
