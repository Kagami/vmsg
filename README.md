# vmsg [![npm](https://img.shields.io/npm/v/vmsg.svg)](https://www.npmjs.com/package/vmsg)

vmsg is a small library for creating voice messages. While traditional
way of communication on the web is via text, sometimes it's easier or
rather funnier to express your thoughts just by saying it. Of course it
doesn't require any special support: record your voice with some
standard program, upload to file hosting and share the link. But why
bother with all of that boredom stuff if you can do the same in browser
with a few clicks.

**[DEMO](https://kagami.github.io/vmsg/)**

## Features

* No dependencies, framework-agnostic, can be easily added to any site
* Small: ~73kb gzipped WASM module and ~3kb gzipped JS + CSS
* Uses MP3 format which is widely supported
* Works in all latest browsers

## Supported browsers

* Chrome 57+
* Firefox 53+
* Safari 11+
* Edge 16+

Note that this haven't been extensively tested yet. Feel free to open
issue in case of any errors.

## Usage

```
npm install vmsg --save
```

```js
import { record } from "vmsg";

someButton.onclick = function() {
  record(/* {wasmURL: "/path/to/vmsg.wasm"} */)
    .then(file => {
      console.log("Recorded MP3:", file);
      // Can be used like this:
      //
      // const form = new FormData();
      // form.append("file[]", file);
      // fetch("/upload.php", {
      //   credentials: "include",
      //   method: "POST",
      //   body: form,
      // }).then(resp => {
      // });
    });
};
```

That's it! Don't forget to include [vmsg.css](vmsg.css) and
[vmsg.wasm](vmsg.wasm) to your project.

See also [demo](demo) directory for a more feasible example.

## Development

1. [Install Emscripten SDK](http://webassembly.org/getting-started/developers-guide/)
2. Install latest LLVM, Clang and LLD with WebAssembly backend, fix
   `LLVM_ROOT` variable of Emscripten config
3. Make sure you have a standard GNU development environment
4. Activate emsdk environment
5. ```bash
   git clone --recurse-submodules https://github.com/Kagami/vmsg.git && cd vmsg
   make clean all
   npm install
   npm start
   ```

These instructions are very basic because there're a lot of systems with
different conventions. Docker image would probably be provided to fix it.

## Technical details for nerds

vmsg uses LAME encoder underneath compiled with Emscripten to
WebAssembly module. LAME build is optimized for size, weights only
little more than 70kb gzipped and can be super-efficiently fetched and
parsed by browser. [It's like a small image.](https://twitter.com/wycats/status/942908325775077376)

Access to microphone is implemented with Web Audio API, data samples
sent to Web Worker which is responsibe for loading WebAssembly module
and calling LAME API.

Module is produced with modern LLVM WASM backend and LLD linker which
should become standard soon, also vmsg has own tiny WASM runtime instead
of Emscripten's to decrease overall size and simplify architecture.
Worker code is inlined to the main JS module so end-user has to care
only about 3 files: `vmsg.js`, `vmsg.css` and `vmsg.wasm`. CSS can be
inlined too but IMO that would be ugly.

## Why not MediaRecorder?

[MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
is great but:

1. Works only in Firefox and Chrome
2. Provides little to no options, e.g. VBR quality can't be specified
3. Firefox/Chrome encode only to Opus which can't be natively played in Safari and Edge

## License

vmsg is licensed under [CC0](COPYING).  
LAME is licensed under [LGPL](https://github.com/Kagami/lame-svn/blob/master/lame/COPYING).  
MP3 patents seems to be [expired since April 23, 2017](https://en.wikipedia.org/wiki/LAME#Patents_and_legal_issues).
