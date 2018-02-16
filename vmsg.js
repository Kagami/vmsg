let shown = false;

function pad2(n) {
  n |= 0;
  return n < 10 ? `0${n}` : `${Math.min(n, 99)}`;
}

function now() {
  return (new Date()).getTime();
}

function inlineWorker() {
  // TODO(Kagami): Cache compiled module in IndexedDB? It works in FF
  // and Edge, see: https://github.com/mdn/webassembly-examples/issues/4
  // Though gzipped WASM module currently weights ~70kb so it should be
  // perfectly cached by the browser itself.
  function fetchAndInstantiate(url, imports) {
    const req = fetch(url, {credentials: "same-origin"});
    return WebAssembly.instantiateStreaming
      ? WebAssembly.instantiateStreaming(req, imports)
      : req.then(res => res.arrayBuffer())
           .then(buf => WebAssembly.instantiate(buf, imports));
  }

  // Must be in sync with emcc settings!
  const TOTAL_STACK = 5 * 1024 * 1024;
  const TOTAL_MEMORY = 16 * 1024 * 1024;
  const WASM_PAGE_SIZE = 64 * 1024;
  const memory = new WebAssembly.Memory({
    initial: TOTAL_MEMORY / WASM_PAGE_SIZE,
    maximum: TOTAL_MEMORY / WASM_PAGE_SIZE,
  });
  let dynamicTop = TOTAL_STACK;
  // TODO(Kagami): Grow memory?
  function sbrk(increment) {
    const oldDynamicTop = dynamicTop;
    dynamicTop += increment;
    return oldDynamicTop;
  }
  // TODO(Kagami): LAME calls exit(-1) on internal error. Would be nice
  // to provide custom DEBUGF/ERRORF for easier debugging. By the moment
  // those functions do nothing.
  function exit(status) {
    postMessage({type: "internal-error", data: status});
  }
  const Runtime = {
    memory: memory,
    pow: Math.pow,
    exit: exit,
    powf: Math.pow,
    exp: Math.exp,
    sqrtf: Math.sqrt,
    cos: Math.cos,
    log: Math.log,
    sin: Math.sin,
    sbrk: sbrk,
  };

  let FFI = null;
  let ref = null;
  let pcm_l = null;
  function vmsg_init() {
    ref = FFI.vmsg_init();
    if (!ref) return false;
    const pcm_l_ref = new Uint32Array(memory.buffer, ref, 1)[0];
    pcm_l = new Float32Array(memory.buffer, pcm_l_ref);
    return true;
  }
  function vmsg_encode(data) {
    pcm_l.set(data);
    return FFI.vmsg_encode(ref, data.length) >= 0;
  }
  function vmsg_flush() {
    if (FFI.vmsg_flush(ref) < 0) return null;
    const mp3_ref = new Uint32Array(memory.buffer, ref + 4, 1)[0];
    const size = new Uint32Array(memory.buffer, ref + 8, 1)[0];
    const mp3 = new Uint8Array(memory.buffer, mp3_ref, size);
    const file = new File([mp3], "rec.mp3", {type: "audio/mpeg"});
    FFI.vmsg_free(ref);
    ref = null;
    pcm_l = null;
    return file;
  }

  onmessage = (e) => {
    const msg = e.data;
    switch (msg.type) {
    case "init":
      fetchAndInstantiate(msg.data, {env: Runtime}).then(wasm => {
        FFI = wasm.instance.exports;
        postMessage({type: "init", data: null});
      }, err => {
        postMessage({type: "init-error", data: err.toString()});
      });
      break;
    case "start":
      if (!vmsg_init()) return postMessage({type: "error", data: "vmsg_init"});
      break;
    case "data":
      if (!vmsg_encode(msg.data)) return postMessage({type: "error", data: "vmsg_encode"});
      break;
    case "stop":
      const file = vmsg_flush();
      if (!file) return postMessage({type: "error", data: "vmsg_flush"});
      postMessage({type: "stop", data: file});
      break;
    }
  };
}

class Form {
  constructor(opts = {}, resolve, reject) {
    // Can't use relative URL in blob worker, see:
    // https://stackoverflow.com/a/22582695
    this.wasmURL = new URL(opts.wasmURL || "vmsg.wasm", location).href;
    this.resolve = resolve;
    this.reject = reject;
    this.backdrop = null;
    this.popup = null;
    this.recordBtn = null;
    this.stopBtn = null;
    this.timer = null;
    this.audio = null;
    this.saveBtn = null;
    this.pitchSlider = null;
    this.audioCtx = null;
    this.ppNode = null;
    this.worker = null;
    this.workerURL = null;
    this.file = null;
    this.fileURL = null;
    this.tid = 0;
    this.start = 0;
    Object.seal(this);

    this.initAudio()
      .then(() => this.drawInit())
      .then((module) => this.initWorker(module))
      .then(() => this.drawAll())
      .catch((err) => this.drawError(err));
  }
  drawInit() {
    if (this.backdrop) return;
    const backdrop = this.backdrop = document.createElement("div");
    backdrop.className = "vmsg-backdrop";
    backdrop.addEventListener("click", () => this.close(null));

    const popup = this.popup = document.createElement("div");
    popup.className = "vmsg-popup";
    popup.addEventListener("click", (e) => e.stopPropagation());

    // TODO(Kagami): Draw progress bar.

    backdrop.appendChild(popup);
    document.body.appendChild(backdrop);
  }
  drawTime(msecs) {
    const secs = Math.round(msecs / 1000);
    this.timer.textContent = pad2(secs / 60) + ":" + pad2(secs % 60);
  }
  drawAll() {
    this.drawInit();
    this.clearAll();

    const recordRow = document.createElement("div");
    recordRow.className = "vmsg-record-row";
    this.popup.appendChild(recordRow);

    const recordBtn = this.recordBtn = document.createElement("button");
    recordBtn.className = "vmsg-button vmsg-record-button";
    recordBtn.textContent = "●";
    recordBtn.title = "Start recording";
    recordBtn.addEventListener("click", () => this.startRecording());
    recordRow.appendChild(recordBtn);

    const stopBtn = this.stopBtn = document.createElement("button");
    stopBtn.className = "vmsg-button vmsg-stop-button";
    stopBtn.style.display = "none";
    stopBtn.textContent = "◼";
    stopBtn.title = "Stop recording";
    stopBtn.addEventListener("click", () => this.stopRecording());
    recordRow.appendChild(stopBtn);

    const timer = this.timer = document.createElement("span");
    timer.className = "vmsg-timer";
    timer.title = "Play record";
    timer.addEventListener("click", () => {
      if (audio.paused) {
        if (this.fileURL) {
          audio.src = this.fileURL;
        }
      } else {
        audio.pause();
      }
    });
    this.drawTime(0);
    recordRow.appendChild(timer);

    const audio = this.audio = new Audio();
    audio.autoplay = true;
    audio.loop = true;

    const saveBtn = this.saveBtn = document.createElement("button");
    saveBtn.className = "vmsg-button vmsg-save-button";
    saveBtn.textContent = "✓";
    saveBtn.disabled = true;
    saveBtn.title = "Save record";
    saveBtn.addEventListener("click", () => this.close(this.file));
    recordRow.appendChild(saveBtn);

    // const pitchSlider = this.pitchSlider = document.createElement("input");
    // pitchSlider.className = "vmsg-slider vmsg-pitch-slider";
    // pitchSlider.setAttribute("type", "range");
    // pitchSlider.value = 0;
    // pitchSlider.title = "Change pitch";
    // this.popup.appendChild(pitchSlider);
  }
  drawError(err) {
    console.error(err);
    this.drawInit();
    this.clearAll();
    const error = document.createElement("div");
    error.className = "vmsg-error";
    error.textContent = err.toString();
    this.popup.appendChild(error);
  }
  clearAll() {
    if (!this.popup) return;
    this.popup.innerHTML = "";
  }
  close(file) {
    if (this.audio) this.audio.pause();
    if (this.ppNode) this.ppNode.disconnect();
    if (this.audioCtx) this.audioCtx.close();
    if (this.worker) this.worker.terminate();
    if (this.workerURL) URL.revokeObjectURL(this.workerURL);
    if (this.fileURL) URL.revokeObjectURL(this.fileURL);
    if (this.tid) clearTimeout(this.tid);
    this.backdrop.remove();
    shown = false;
    if (file) {
      this.resolve(file);
    } else {
      this.reject(new Error("No record made"));
    }
  }
  initAudio() {
    if (!navigator.mediaDevices.getUserMedia) {
      const err = new Error("getUserMedia is not implemented in this browser");
      return Promise.reject(err);
    }
    return navigator.mediaDevices.getUserMedia({audio: true}).then(stream => {
      const audioCtx = this.audioCtx = new AudioContext();
      const sourceNode = audioCtx.createMediaStreamSource(stream);
      const ppNode = this.ppNode = audioCtx.createScriptProcessor(0, 1, 1);
      ppNode.onaudioprocess = (e) => {
        const samples = e.inputBuffer.getChannelData(0);
        this.worker.postMessage({type: "data", data: samples});
      };
      sourceNode.connect(ppNode);
    });
  }
  initWorker(module) {
    // https://stackoverflow.com/a/19201292
    const blob = new Blob(
      ["(", inlineWorker.toString(), ")()"],
      {type: "application/javascript"});
    const workerURL = this.workerURL = URL.createObjectURL(blob);
    const worker = this.worker = new Worker(workerURL);
    worker.postMessage({type: "init", data: this.wasmURL});
    return new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        const msg = e.data;
        switch (msg.type) {
        case "init":
          resolve();
          break;
        case "init-error":
          reject(new Error(msg.data));
          break;
        // TODO(Kagami): Error handling.
        case "error":
        case "internal-error":
          console.error("Worker error:", msg.data);
          break;
        case "stop":
          this.file = msg.data;
          this.fileURL = URL.createObjectURL(msg.data);
          this.recordBtn.style.display = "";
          this.stopBtn.style.display = "none";
          this.stopBtn.disabled = false;
          this.saveBtn.disabled = false;
          break;
        }
      }
    });
  }
  startRecording() {
    this.audio.pause();
    this.file = null;
    if (this.fileURL) URL.revokeObjectURL(this.fileURL);
    this.fileURL = null;
    this.start = now();
    this.updateTime();
    this.recordBtn.style.display = "none";
    this.stopBtn.style.display = "";
    this.saveBtn.disabled = true;
    this.worker.postMessage({type: "start", data: null});
    this.ppNode.connect(this.audioCtx.destination);
  }
  stopRecording() {
    clearTimeout(this.tid);
    this.tid = 0;
    this.stopBtn.disabled = true;
    this.ppNode.disconnect();
    this.worker.postMessage({type: "stop", data: null});
  }
  updateTime() {
    // NOTE(Kagami): We can do this in `onaudioprocess` but that would
    // run too often and create unnecessary DOM updates.
    this.drawTime(now() - this.start);
    this.tid = setTimeout(() => this.updateTime(), 300);
  }
}

/**
 * Record a new voice message.
 *
 * @param {Object=} opts - Options
 * @param {number=} opts.wasmURL - URL of the module (`vmsg.wasm` by default)
 * @return {Promise.<File>} A promise that contains recorded file when fulfilled.
 */
export function record(opts) {
  return new Promise((resolve, reject) => {
    if (shown) throw new Error("Record form is already opened");
    shown = true;
    new Form(opts, resolve, reject);
  });
}
