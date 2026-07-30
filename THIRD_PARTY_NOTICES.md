# Third-party notices

OpenDroid Remote is MIT-licensed. Its browser runtime uses the following
open-source projects.

| Project | Packages/assets | License |
| --- | --- | --- |
| [ya-webadb](https://github.com/yume-chan/ya-webadb) | `@yume-chan/adb`, WebUSB transport, credential store, scrcpy protocol/client, stream helpers, WebCodecs decoder | MIT |
| [scrcpy](https://github.com/Genymobile/scrcpy) | Bundled `scrcpy-server-v3.3.3` | Apache License 2.0 |
| [React](https://github.com/facebook/react) | UI runtime | MIT |

The exact scrcpy server license is copied to
`public/vendor/SCRCPY-LICENSE.txt`. Its pinned SHA-256 digest is recorded in
`public/vendor/SCRCPY-SHA256.txt` and verified again in the browser before the
server is pushed to Android.

Development and build dependencies remain governed by their respective
licenses. Run `npm ls` to inspect the complete resolved dependency tree.
