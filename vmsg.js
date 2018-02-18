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
  function vmsg_init(rate) {
    ref = FFI.vmsg_init(rate);
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
      if (!vmsg_init(msg.data)) return postMessage({type: "error", data: "vmsg_init"});
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

    const progress = document.createElement("div");
    progress.className = "vmsg-progress";
    for (let i = 0; i < 3; i++) {
      const progressDot = document.createElement("div");
      progressDot.className = "vmsg-progress-dot";
      progress.appendChild(progressDot);
    }
    popup.appendChild(progress);

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
    this.worker.postMessage({type: "start", data: this.audioCtx.sampleRate});
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

let shown = false;

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
  }).then(result => {
    shown = false;
    return result;
  }, err => {
    shown = false;
    throw err;
  });
}

// Borrowed from and slightly modified:
// https://github.com/cwilso/Audio-Input-Effects/blob/master/js/jungle.js
//
// Copyright 2012, Google Inc.
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are
// met:
//
//     * Redistributions of source code must retain the above copyright
// notice, this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above
// copyright notice, this list of conditions and the following disclaimer
// in the documentation and/or other materials provided with the
// distribution.
//     * Neither the name of Google Inc. nor the names of its
// contributors may be used to endorse or promote products derived from
// this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
// A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
// OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
// LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
// THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

const delayTime = 0.100;
const fadeTime = 0.050;
const bufferTime = 0.100;

function createFadeBuffer(context, activeTime, fadeTime) {
  var length1 = activeTime * context.sampleRate;
  var length2 = (activeTime - 2*fadeTime) * context.sampleRate;
  var length = length1 + length2;
  var buffer = context.createBuffer(1, length, context.sampleRate);
  var p = buffer.getChannelData(0);

  var fadeLength = fadeTime * context.sampleRate;

  var fadeIndex1 = fadeLength;
  var fadeIndex2 = length1 - fadeLength;

  // 1st part of cycle
  for (var i = 0; i < length1; ++i) {
    var value;

    if (i < fadeIndex1) {
        value = Math.sqrt(i / fadeLength);
    } else if (i >= fadeIndex2) {
        value = Math.sqrt(1 - (i - fadeIndex2) / fadeLength);
    } else {
        value = 1;
    }

    p[i] = value;
  }

  // 2nd part
  for (var i = length1; i < length; ++i) {
    p[i] = 0;
  }

  return buffer;
}

function createDelayTimeBuffer(context, activeTime, fadeTime, shiftUp) {
  var length1 = activeTime * context.sampleRate;
  var length2 = (activeTime - 2*fadeTime) * context.sampleRate;
  var length = length1 + length2;
  var buffer = context.createBuffer(1, length, context.sampleRate);
  var p = buffer.getChannelData(0);

  // 1st part of cycle
  for (var i = 0; i < length1; ++i) {
    if (shiftUp)
      // This line does shift-up transpose
      p[i] = (length1-i)/length;
    else
      // This line does shift-down transpose
      p[i] = i / length1;
  }

  // 2nd part
  for (var i = length1; i < length; ++i) {
    p[i] = 0;
  }

  return buffer;
}

function Jungle(context) {
  this.context = context;
  // Create nodes for the input and output of this "module".
  var input = context.createGain();
  var output = context.createGain();
  this.input = input;
  this.output = output;

  // Delay modulation.
  var mod1 = context.createBufferSource();
  var mod2 = context.createBufferSource();
  var mod3 = context.createBufferSource();
  var mod4 = context.createBufferSource();
  this.shiftDownBuffer = createDelayTimeBuffer(context, bufferTime, fadeTime, false);
  this.shiftUpBuffer = createDelayTimeBuffer(context, bufferTime, fadeTime, true);
  mod1.buffer = this.shiftDownBuffer;
  mod2.buffer = this.shiftDownBuffer;
  mod3.buffer = this.shiftUpBuffer;
  mod4.buffer = this.shiftUpBuffer;
  mod1.loop = true;
  mod2.loop = true;
  mod3.loop = true;
  mod4.loop = true;

  // for switching between oct-up and oct-down
  var mod1Gain = context.createGain();
  var mod2Gain = context.createGain();
  var mod3Gain = context.createGain();
  mod3Gain.gain.value = 0;
  var mod4Gain = context.createGain();
  mod4Gain.gain.value = 0;

  mod1.connect(mod1Gain);
  mod2.connect(mod2Gain);
  mod3.connect(mod3Gain);
  mod4.connect(mod4Gain);

  // Delay amount for changing pitch.
  var modGain1 = context.createGain();
  var modGain2 = context.createGain();

  var delay1 = context.createDelay();
  var delay2 = context.createDelay();
  mod1Gain.connect(modGain1);
  mod2Gain.connect(modGain2);
  mod3Gain.connect(modGain1);
  mod4Gain.connect(modGain2);
  modGain1.connect(delay1.delayTime);
  modGain2.connect(delay2.delayTime);

  // Crossfading.
  var fade1 = context.createBufferSource();
  var fade2 = context.createBufferSource();
  var fadeBuffer = createFadeBuffer(context, bufferTime, fadeTime);
  fade1.buffer = fadeBuffer
  fade2.buffer = fadeBuffer;
  fade1.loop = true;
  fade2.loop = true;

  var mix1 = context.createGain();
  var mix2 = context.createGain();
  mix1.gain.value = 0;
  mix2.gain.value = 0;

  fade1.connect(mix1.gain);
  fade2.connect(mix2.gain);

  // Connect processing graph.
  input.connect(delay1);
  input.connect(delay2);
  delay1.connect(mix1);
  delay2.connect(mix2);
  mix1.connect(output);
  mix2.connect(output);

  // Start
  var t = context.currentTime + 0.050;
  var t2 = t + bufferTime - fadeTime;
  mod1.start(t);
  mod2.start(t2);
  mod3.start(t);
  mod4.start(t2);
  fade1.start(t);
  fade2.start(t2);

  this.mod1 = mod1;
  this.mod2 = mod2;
  this.mod1Gain = mod1Gain;
  this.mod2Gain = mod2Gain;
  this.mod3Gain = mod3Gain;
  this.mod4Gain = mod4Gain;
  this.modGain1 = modGain1;
  this.modGain2 = modGain2;
  this.fade1 = fade1;
  this.fade2 = fade2;
  this.mix1 = mix1;
  this.mix2 = mix2;
  this.delay1 = delay1;
  this.delay2 = delay2;

  this.setDelay(delayTime);
}

Jungle.prototype.setDelay = function(delayTime) {
  this.modGain1.gain.setTargetAtTime(0.5*delayTime, 0, 0.010);
  this.modGain2.gain.setTargetAtTime(0.5*delayTime, 0, 0.010);
};

Jungle.prototype.setPitchOffset = function(mult) {
  if (mult>0) { // pitch up
    this.mod1Gain.gain.value = 0;
    this.mod2Gain.gain.value = 0;
    this.mod3Gain.gain.value = 1;
    this.mod4Gain.gain.value = 1;
  } else { // pitch down
    this.mod1Gain.gain.value = 1;
    this.mod2Gain.gain.value = 1;
    this.mod3Gain.gain.value = 0;
    this.mod4Gain.gain.value = 0;
  }
  this.setDelay(delayTime*Math.abs(mult));
};
