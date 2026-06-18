/* ============================================================
   scanner.js — camera document scanner with filters
   ============================================================ */
export class Scanner {
  constructor(root) {
    this.root = root;
    this.video = root.querySelector("#cam");
    this.canvas = root.querySelector("#scan-canvas");
    this.review = root.querySelector("#scan-review");
    this.preview = root.querySelector("#scan-preview");
    this.stream = null;
    this.facing = "environment";
    this.filter = "color";
    this.captured = null;     // raw ImageData-based dataURL
    this.resolve = null;

    root.querySelector("#scan-close").onclick = () => this.cancel();
    root.querySelector("#scan-flip").onclick = () => this.flip();
    root.querySelector("#scan-shoot").onclick = () => this.shoot();
    root.querySelector("#scan-retake").onclick = () => this.retake();
    root.querySelector("#scan-use").onclick = () => this.use();

    root.querySelectorAll("#filter-seg button").forEach((b) => {
      b.onclick = () => {
        root.querySelectorAll("#filter-seg button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        this.filter = b.dataset.filter;
        if (this.captured) this._renderPreview();
      };
    });
  }

  /** opens scanner; resolves with a dataURL or null if cancelled */
  open() {
    return new Promise(async (resolve) => {
      this.resolve = resolve;
      this.root.classList.remove("hidden");
      this.review.classList.add("hidden");
      this.captured = null;
      try {
        await this._start();
      } catch (err) {
        alert("Kamera nicht verfügbar: " + err.message + "\nTipp: HTTPS oder localhost nötig, und Kamerazugriff erlauben.");
        this.cancel();
      }
    });
  }

  async _start() {
    this._stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: this.facing, width: { ideal: 2560 }, height: { ideal: 1440 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
  }
  _stop() {
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
  }

  async flip() {
    this.facing = this.facing === "environment" ? "user" : "environment";
    try { await this._start(); } catch (e) { /* ignore */ }
  }

  shoot() {
    const v = this.video;
    const w = v.videoWidth, h = v.videoHeight;
    if (!w) return;
    const cv = this.canvas;
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.drawImage(v, 0, 0, w, h);
    this.rawData = ctx.getImageData(0, 0, w, h);
    this.captured = true;
    this._stop();
    this.review.classList.remove("hidden");
    this._renderPreview();
  }

  _renderPreview() {
    const src = this.rawData;
    const cv = document.createElement("canvas");
    cv.width = src.width; cv.height = src.height;
    const ctx = cv.getContext("2d");
    const out = ctx.createImageData(src.width, src.height);
    applyFilter(src.data, out.data, this.filter);
    ctx.putImageData(out, 0, 0);
    this.preview.src = cv.toDataURL("image/jpeg", 0.92);
    this._outCanvas = cv;
  }

  retake() {
    this.review.classList.add("hidden");
    this.captured = null;
    this._start().catch(() => {});
  }

  use() {
    const url = this._outCanvas.toDataURL("image/jpeg", 0.9);
    this._finish(url);
  }

  cancel() { this._finish(null); }

  _finish(val) {
    this._stop();
    this.root.classList.add("hidden");
    this.review.classList.add("hidden");
    const r = this.resolve; this.resolve = null;
    if (r) r(val);
  }
}

/* image filters */
function applyFilter(src, dst, mode) {
  if (mode === "color") {
    // light enhancement: boost contrast + brightness
    const c = 1.18, b = 12;
    for (let i = 0; i < src.length; i += 4) {
      dst[i] = clamp((src[i] - 128) * c + 128 + b);
      dst[i + 1] = clamp((src[i + 1] - 128) * c + 128 + b);
      dst[i + 2] = clamp((src[i + 2] - 128) * c + 128 + b);
      dst[i + 3] = 255;
    }
    return;
  }
  if (mode === "gray") {
    const c = 1.25, b = 10;
    for (let i = 0; i < src.length; i += 4) {
      let g = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
      g = clamp((g - 128) * c + 128 + b);
      dst[i] = dst[i + 1] = dst[i + 2] = g; dst[i + 3] = 255;
    }
    return;
  }
  // bw — clean document look
  adaptiveThreshold(src, dst);
}

function adaptiveThreshold(src, dst) {
  const n = src.length / 4;
  const gray = new Float32Array(n);
  for (let i = 0, j = 0; i < src.length; i += 4, j++)
    gray[j] = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
  // global mean fallback adaptive: compare each pixel to local block mean via downsampled approximation
  let sum = 0; for (let j = 0; j < n; j++) sum += gray[j];
  const mean = sum / n;
  const T = mean * 0.92;
  for (let i = 0, j = 0; i < src.length; i += 4, j++) {
    const v = gray[j] < T ? 0 : 255;
    dst[i] = dst[i + 1] = dst[i + 2] = v; dst[i + 3] = 255;
  }
}

function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
