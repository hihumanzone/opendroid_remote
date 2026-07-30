# Contributing

Issues and pull requests are welcome.

Before submitting:

```sh
npm install
npm test
npm run typecheck
npm run lint
npm run build
```

Keep runtime logic browser-only and device-independent. New Android
compatibility behavior must be capability-detected, isolated behind an adapter,
documented in the compatibility matrix, and covered by deterministic tests.
Never add manufacturer/model checks, fixed display IDs, analytics, account
requirements, native bridges, remote relays, or an Android companion app.

When upgrading ya-webadb/scrcpy, pin exact package versions and update the
bundled server, SHA-256 digest, license notice, tests, and documentation as one
change.
