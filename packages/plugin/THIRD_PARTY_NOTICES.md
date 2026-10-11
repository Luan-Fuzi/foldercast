# Third-party notices

foldercast's own source code and documentation are licensed under the MIT License
in LICENSE, copyright 2026 Luan_Fuzi. That grant does not relicense dependencies,
native executables, fonts, data, or source material supplied by users.

The npm tarball contains foldercast code, schemas, references, and a client bundle;
it does not vendor node_modules or native executables. npm installs dependencies
separately. Preserve the copyright, license, and NOTICE files shipped with them.
The client bundle externalizes React and the DeepSeek Harness client packages.

## Direct dependencies (0.3.1)

| Package / repository | License | Use |
| --- | --- | --- |
| @deepseek-ai/schemastery / https://github.com/deepseek-ai/deepseek-harness | MIT | Settings schema |
| @remotion/bundler, @remotion/cli, @remotion/renderer, remotion 4.0.532 / https://github.com/remotion-dev/remotion | Remotion License | Video rendering |
| ajv / https://github.com/ajv-validator/ajv | MIT | JSON schema validation |
| ajv-formats / https://github.com/ajv-validator/ajv-formats | MIT | Schema formats |
| ignore / https://github.com/kaelzhang/node-ignore | MIT | Ignore rules |
| jsonc-parser / https://github.com/microsoft/node-jsonc-parser | MIT | JSONC parsing |
| marked / https://github.com/markedjs/marked | MIT | Markdown |
| msedge-tts / https://github.com/Migushthe2nd/MsEdgeTTS | MIT | Edge speech client |
| officeparser / https://github.com/harshankur/officeParser | MIT | Document text extraction |
| react, react-dom / https://github.com/facebook/react | MIT | Scene rendering |
| shiki / https://github.com/shikijs/shiki | MIT | Syntax highlighting |
| @deepseek-ai/libreoffice-kit (optional) / https://github.com/deepseek-ai/dsh-libreoffice-kit | MPL-2.0 (engine); see package notices for MIT wrapper and other components | Document page conversion |

These are separate upstream packages; foldercast does not grant their licenses.
MIT dependencies require preservation of their copyright and license notice when
redistributing copies or substantial portions. Apache dependencies also require
preserving applicable notices and marking modified files.

## Remotion and native FFmpeg

Remotion is source-available under its own Free License / Company License, not MIT.
Read the exact version's license:
https://github.com/remotion-dev/remotion/blob/v4.0.532/LICENSE.md
Eligibility and pricing: https://www.remotion.dev/docs/license/pricing

The installed @remotion/compositor-darwin-arm64 4.0.532 includes FFmpeg / ffprobe
and libraries. The local binary reports GPL v2 or later with GPL-enabled codecs.
Other platforms may ship different builds: inspect their bundled notices and
`ffmpeg -L` rather than assuming the macOS result applies everywhere.
Remotion publishes acknowledgements and the FFmpeg build/source location at
https://www.remotion.dev/docs/acknowledgements
FFmpeg redistribution guidance: https://ffmpeg.org/legal.html

foldercast invokes the rendering packages and tools; it does not copy these
binaries into its own tarball. An installer/container that redistributes binaries
must independently preserve notices and satisfy the exact build's corresponding
source obligations. Calling a separate program is not, by itself, evidence that
all calling source code must be relicensed under the GPL.

## LibreOffice / MPL-2.0

The optional LibreOffice kit distributes a native engine and additional components.
The native package contains `licenses/` and `sources/`, including the MPL license,
third-party notices, source revision metadata, and build/change information.
Preserve those directories when redistributing the kit. This repository does not
modify LibreOffice or Mediabunny source files.

MPL source obligations apply to covered files and redistributed executable forms;
a separate larger work may use a different license. If modifying or repackaging
covered files, provide the covered source and its license as required.
https://www.mozilla.org/en-US/MPL/2.0/
https://www.mozilla.org/en-US/MPL/2.0/FAQ/
LibreOffice source: https://git.libreoffice.org/core.git
Kit source: https://github.com/deepseek-ai/dsh-libreoffice-kit

## Other transitive components

The installed dependency closure includes Mediabunny and encoder packages
(MPL-2.0), pdfjs-dist (Apache-2.0, plus component/font notices), caniuse-lite
(CC-BY-4.0 data), argparse (Python-2.0), and MIT / ISC / BSD components. Preserve
individual package licenses; do not replace them with foldercast's MIT license.
For PDF.js fonts and CMaps, consult the notices included alongside those assets.
For reused CC-BY data, retain attribution and indicate changes.

A versioned production dependency inventory is in
https://github.com/Luan-Fuzi/foldercast/blob/main/docs/dependency-licenses.json
It records the installed macOS ARM64 dependency closure, not a guarantee about
uninstalled platform variants or subsequent dependency resolution. Regenerate
with `pnpm --filter dsh-foldercast licenses list --prod --json` and review native
notices whenever the lockfile changes. User source files and cloud service usage
retain their own rights and service terms.
