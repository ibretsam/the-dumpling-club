// recorder.js — BiteRecorder: records a square "bite" clip of the scene.
//
// The recorder switches the WebGLRenderer to a fixed square drawing buffer
// (pixelRatio 1, size×size, CSS untouched), captures `canvas.captureStream(fps)`,
// optionally mixes in an audio MediaStreamTrack (from AudioEngine.outputStreamTrack),
// and feeds a MediaRecorder. mp4 (H.264) is preferred where the browser can mux it
// (Safari, recent Chrome), WebM is the fallback. stop() resolves with the file and
// restores the renderer size / pixel ratio.
//
// Responsibilities that stay in main.js: styling the canvas as a centred square
// during recording (CSS only), setting camera.aspect = 1 (or pass `camera` in the
// constructor options and the recorder does it), and pausing the window-resize
// handler while `recorder.recording` is true.
//
// Safari notes handled here: Safari records mp4 natively, may ignore the timeslice
// and fire 'dataavailable' only on stop, and rejects unknown mimeType options —
// so we probe with isTypeSupported, never depend on periodic chunks, and retry
// the constructor without options when it throws.
//
// start()/stop() never throw; they return/resolve null and console.warn on failure.

import * as THREE from 'three';

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp8',
  'video/webm',
];

const VIDEO_BITS_PER_SECOND = 8_000_000;
const STOP_TIMEOUT_MS = 5000;     // never hang if the 'stop' event goes missing
const REVOKE_AFTER_MS = 10_000;

function hasMediaRecorder() {
  try {
    return typeof window !== 'undefined' && typeof window.MediaRecorder === 'function';
  } catch (e) {
    return false;
  }
}

function hasCaptureStream() {
  try {
    return typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function';
  } catch (e) {
    return false;
  }
}

/** A mime string "declares" audio when it names an audio codec or leaves codecs to the browser. */
function declaresAudio(mime) {
  if (!mime) return true; // browser default (webm+opus on Chrome/Firefox, mp4+aac on Safari)
  const m = /codecs=([^;]+)/i.exec(mime);
  if (!m) return true;    // container only: the browser picks default codecs, including audio
  return /opus|mp4a|aac|vorbis/i.test(m[1]);
}

function containerOf(mime) {
  return String(mime || '').split(';')[0].trim().toLowerCase();
}

function extFor(mime) {
  return /mp4/i.test(String(mime || '')) ? 'mp4' : 'webm';
}

/**
 * Choose a mime type from the supported list. mp4 stays preferred; when audio is wanted
 * and the first choice only names a video codec, prefer a sibling in the same container
 * that also names an audio codec (or the bare container, which lets the browser add audio).
 */
function pickMimeType(supported, wantAudio) {
  if (!supported.length) return '';
  const first = supported[0];
  if (!wantAudio || declaresAudio(first)) return first;
  const container = containerOf(first);
  const sibling = supported.find((m) => containerOf(m) === container && declaresAudio(m));
  return sibling || first;
}

export class BiteRecorder {
  /**
   * @param {{ renderer: THREE.WebGLRenderer, size?: number, fps?: number, camera?: THREE.Camera }} opts
   *   `camera` is optional: when given, its aspect is set to 1 while recording and restored after.
   */
  constructor({ renderer, size = 1080, fps = 30, camera = null } = {}) {
    this.renderer = renderer || null;
    this.size = Math.max(16, Math.floor(size) || 1080);
    this.fps = Math.max(1, fps || 30);
    this.camera = camera;

    /** Optional hook: called with the error event / Error when the MediaRecorder reports one. */
    this.onerror = null;

    this._recorder = null;
    this._stream = null;
    this._chunks = [];
    this._audioTrack = null;
    this._saved = null;         // { width, height, pixelRatio, aspect }
    this._mimeType = '';
    this._ext = 'webm';
    this._stopping = null;      // Promise while stop() is in flight
  }

  // ----------------------------------------------------------------- static

  /** True when the browser has both MediaRecorder and canvas.captureStream. */
  static isSupported() {
    return hasMediaRecorder() && hasCaptureStream();
  }

  /** The ordered candidates MediaRecorder.isTypeSupported accepts (mp4 first, webm fallback). */
  static supportedMimeTypes() {
    try {
      if (!hasMediaRecorder() || typeof MediaRecorder.isTypeSupported !== 'function') return [];
      return MIME_CANDIDATES.filter((m) => {
        try { return MediaRecorder.isTypeSupported(m) === true; } catch (e) { return false; }
      });
    } catch (e) {
      return [];
    }
  }

  /** First supported mime type, or '' when the browser should choose its default. */
  static preferredMimeType() {
    const list = BiteRecorder.supportedMimeTypes();
    return list.length ? list[0] : '';
  }

  /** File extension the recorder would produce right now ('mp4' | 'webm'). */
  static preferredExtension() {
    return extFor(BiteRecorder.preferredMimeType() || (isLikelySafari() ? 'video/mp4' : 'video/webm'));
  }

  // ------------------------------------------------------------------ state

  get recording() {
    try {
      return !!this._recorder && this._recorder.state === 'recording';
    } catch (e) {
      return false;
    }
  }

  /** Mime type of the current / last recording ('' when unknown). */
  get mimeType() { return this._mimeType; }

  get ext() { return this._ext; }

  // ---------------------------------------------------------------- control

  /**
   * Begin recording. Switches the renderer to a size×size drawing buffer (pixelRatio 1,
   * CSS untouched), captures the canvas and starts a MediaRecorder.
   * @param {{ audioTrack?: MediaStreamTrack|null }} opts
   * @returns {{ mimeType: string, ext: string } | null}
   */
  start({ audioTrack = null } = {}) {
    try {
      if (this.recording) return { mimeType: this._mimeType, ext: this._ext };
      if (this._stopping) {
        console.warn('BiteRecorder: previous recording is still finishing.');
        return null;
      }
      if (!BiteRecorder.isSupported()) {
        console.warn('BiteRecorder: MediaRecorder / canvas.captureStream not available in this browser.');
        return null;
      }
      const renderer = this.renderer;
      if (!renderer || !renderer.domElement) {
        console.warn('BiteRecorder: no renderer.');
        return null;
      }

      // 0. A previous session that ended on its own (MediaRecorder error) without a stop()
      //    call still holds its stream; drop it, but keep `_saved` — the renderer is still
      //    at the recording size, so the values captured back then are the ones to restore.
      this._discardStale();

      // 1. Fixed square drawing buffer (remember what we had).
      if (!this._saved) {
        const prev = new THREE.Vector2();
        renderer.getSize(prev);
        this._saved = {
          width: prev.x,
          height: prev.y,
          pixelRatio: renderer.getPixelRatio(),
          aspect: this.camera && Number.isFinite(this.camera.aspect) ? this.camera.aspect : null,
        };
      }
      renderer.setPixelRatio(1);
      renderer.setSize(this.size, this.size, false);
      if (this.camera && this._saved.aspect !== null) {
        this.camera.aspect = 1;
        if (typeof this.camera.updateProjectionMatrix === 'function') this.camera.updateProjectionMatrix();
      }

      // 2. Capture the canvas.
      const canvas = renderer.domElement;
      let stream;
      try {
        stream = canvas.captureStream(this.fps);
      } catch (e) {
        stream = canvas.captureStream();
      }
      if (!stream || typeof stream.getVideoTracks !== 'function' || stream.getVideoTracks().length === 0) {
        console.warn('BiteRecorder: captureStream produced no video track.');
        this.restore();
        return null;
      }

      // 3. Pick a container / codec.
      const supported = BiteRecorder.supportedMimeTypes();
      let mimeType = pickMimeType(supported, !!audioTrack);

      // 4. Mix in audio when the chosen type can carry it.
      this._audioTrack = null;
      if (audioTrack && declaresAudio(mimeType)) {
        try {
          if (audioTrack.readyState === 'live') {
            stream.addTrack(audioTrack);
            this._audioTrack = audioTrack;
          } else {
            console.warn('BiteRecorder: audio track is not live; recording video only.');
          }
        } catch (e) {
          console.warn('BiteRecorder: could not add the audio track; recording video only.', e);
          this._audioTrack = null;
        }
      }

      // 5. Create the MediaRecorder (retry with fewer options if the browser is picky).
      let recorder = null;
      const attempts = [];
      if (mimeType) attempts.push({ mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
      attempts.push({ videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
      attempts.push({});
      let lastError = null;
      for (const options of attempts) {
        try {
          recorder = new MediaRecorder(stream, options);
          break;
        } catch (e) {
          lastError = e;
          recorder = null;
          // If a codec string was refused and we had added audio, Safari may still be fine
          // with the default; keep the track and let the next attempt decide.
        }
      }
      if (!recorder) {
        console.warn('BiteRecorder: could not create a MediaRecorder.', lastError);
        this._detachAudio(stream);
        stopVideoTracks(stream);
        this.restore();
        return null;
      }

      const actual = recorder.mimeType || mimeType || '';
      this._mimeType = actual;
      this._ext = extFor(actual || (isLikelySafari() ? 'video/mp4' : 'video/webm'));
      this._chunks = [];
      this._stream = stream;
      this._recorder = recorder;

      recorder.ondataavailable = (ev) => {
        try {
          if (ev.data && ev.data.size > 0) this._chunks.push(ev.data);
        } catch (e) { /* ignore */ }
      };
      recorder.onerror = (ev) => {
        const err = (ev && ev.error) || ev;
        console.warn('BiteRecorder: MediaRecorder error.', err);
        try { if (typeof this.onerror === 'function') this.onerror(err); } catch (e) { /* ignore */ }
      };

      // 6. Go. Periodic chunks keep memory flat on Chrome; Safari may deliver one blob at stop.
      try {
        recorder.start(200);
      } catch (e) {
        try {
          recorder.start();
        } catch (e2) {
          console.warn('BiteRecorder: MediaRecorder.start() failed.', e2);
          this._recorder = null;
          this._stream = null;
          this._detachAudio(stream);
          stopVideoTracks(stream);
          this.restore();
          return null;
        }
      }

      return { mimeType: this._mimeType, ext: this._ext };
    } catch (e) {
      console.warn('BiteRecorder: start() failed.', e);
      try { this.restore(); } catch (e2) { /* ignore */ }
      return null;
    }
  }

  /**
   * Stop recording. Resolves after the recorder's 'stop' event with
   * { blob, mimeType, ext, url } — or null when nothing was recorded. Restores the renderer.
   */
  stop() {
    if (this._stopping) return this._stopping;
    this._stopping = new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        this._stopping = null;
        resolve(result);
      };

      try {
        const recorder = this._recorder;
        const stream = this._stream;
        if (!recorder) {
          this.restore();
          finish(null);
          return;
        }

        let timer = null;
        const finalize = () => {
          if (timer !== null) { clearTimeout(timer); timer = null; }
          let result = null;
          try {
            const chunks = this._chunks;
            this._chunks = [];
            this._recorder = null;
            this._stream = null;
            this._detachAudio(stream);
            stopVideoTracks(stream);

            const mimeType = recorder.mimeType || this._mimeType || '';
            const ext = extFor(mimeType || (isLikelySafari() ? 'video/mp4' : 'video/webm'));
            const blobType = containerOf(mimeType) || (ext === 'mp4' ? 'video/mp4' : 'video/webm');
            if (chunks.length) {
              const blob = new Blob(chunks, { type: blobType });
              if (blob.size > 0) {
                result = { blob, mimeType: mimeType || blobType, ext, url: URL.createObjectURL(blob) };
              }
            }
            if (!result) console.warn('BiteRecorder: recording produced no data.');
          } catch (e) {
            console.warn('BiteRecorder: could not assemble the recording.', e);
            result = null;
          }
          this.restore();
          finish(result);
        };

        timer = setTimeout(() => {
          console.warn('BiteRecorder: no stop event within ' + STOP_TIMEOUT_MS + ' ms; finishing anyway.');
          finalize();
        }, STOP_TIMEOUT_MS);

        if (recorder.state === 'inactive') {
          // Already stopped (e.g. after an error): whatever chunks we have are final.
          finalize();
          return;
        }

        recorder.onstop = finalize;
        try {
          recorder.stop(); // flushes a final 'dataavailable' before 'stop'
        } catch (e) {
          console.warn('BiteRecorder: MediaRecorder.stop() threw.', e);
          finalize();
        }
      } catch (e) {
        console.warn('BiteRecorder: stop() failed.', e);
        try { this.restore(); } catch (e2) { /* ignore */ }
        finish(null);
      }
    });
    return this._stopping;
  }

  /**
   * Put the renderer (and camera aspect, if one was given) back the way start() found them.
   * Called by stop(); safe to call any time. Returns true when something was restored.
   */
  restore() {
    try {
      const saved = this._saved;
      if (!saved) return false;
      this._saved = null;
      const renderer = this.renderer;
      if (renderer) {
        renderer.setPixelRatio(saved.pixelRatio);
        renderer.setSize(saved.width, saved.height, false);
      }
      if (this.camera && saved.aspect !== null) {
        this.camera.aspect = saved.aspect;
        if (typeof this.camera.updateProjectionMatrix === 'function') this.camera.updateProjectionMatrix();
      }
      return true;
    } catch (e) {
      console.warn('BiteRecorder: restore() failed.', e);
      return false;
    }
  }

  // ------------------------------------------------------------------ files

  /**
   * Trigger a file download for a stop() result. The object URL is revoked after 10 s.
   * @returns {boolean} true when the click was dispatched.
   */
  download(result, filename = 'dumpling-club-bite') {
    try {
      if (!result || !result.blob || typeof document === 'undefined') return false;
      const url = result.url || URL.createObjectURL(result.blob);
      const ext = result.ext || extFor(result.mimeType);
      const a = document.createElement('a');
      a.href = url;
      a.download = sanitizeFilename(filename) + '.' + ext;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try { a.remove(); } catch (e) { /* ignore */ }
        try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
      }, REVOKE_AFTER_MS);
      return true;
    } catch (e) {
      console.warn('BiteRecorder: download() failed.', e);
      return false;
    }
  }

  /** True when navigator.share can hand this clip to another app (mobile share sheet). */
  canShare(result) {
    try {
      if (!result || !result.blob || typeof navigator === 'undefined') return false;
      if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
      const file = this._toFile(result, 'dumpling-club-bite');
      return navigator.canShare({ files: [file] }) === true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Share via the Web Share API (must be called from a user gesture). Resolves true on
   * success, false when sharing was unavailable, cancelled or failed (never rejects).
   */
  async share(result, filename = 'dumpling-club-bite', { title = 'The Dumpling Club', text = '' } = {}) {
    try {
      if (!this.canShare(result)) return false;
      const file = this._toFile(result, filename);
      const data = { files: [file], title };
      if (text) data.text = text;
      await navigator.share(data);
      return true;
    } catch (e) {
      // AbortError = user dismissed the sheet; not worth a warning.
      if (!(e && e.name === 'AbortError')) console.warn('BiteRecorder: share() failed.', e);
      return false;
    }
  }

  /** Revoke the object URL of a stop() result once it is no longer needed. */
  release(result) {
    try {
      if (result && result.url) URL.revokeObjectURL(result.url);
    } catch (e) { /* ignore */ }
  }

  /** Stop any recording in flight and drop references. */
  dispose() {
    try {
      if (this._recorder) {
        const stream = this._stream;
        try { this._recorder.onstop = null; this._recorder.ondataavailable = null; } catch (e) { /* ignore */ }
        try { if (this._recorder.state !== 'inactive') this._recorder.stop(); } catch (e) { /* ignore */ }
        this._recorder = null;
        this._stream = null;
        this._chunks = [];
        this._detachAudio(stream);
        stopVideoTracks(stream);
      }
      this.restore();
    } catch (e) { /* ignore */ }
  }

  // -------------------------------------------------------------- internals

  _toFile(result, filename) {
    const ext = result.ext || extFor(result.mimeType);
    const type = containerOf(result.mimeType) || result.blob.type || (ext === 'mp4' ? 'video/mp4' : 'video/webm');
    return new File([result.blob], sanitizeFilename(filename) + '.' + ext, { type });
  }

  /**
   * Drop a recorder that is no longer recording but was never stop()ped (it went 'inactive'
   * after an error). Stops its capture, detaches the audio track, keeps `_saved` untouched.
   */
  _discardStale() {
    const recorder = this._recorder;
    const stream = this._stream;
    if (!recorder) return;
    this._recorder = null;
    this._stream = null;
    this._chunks = [];
    try { recorder.onstop = null; recorder.ondataavailable = null; recorder.onerror = null; } catch (e) { /* ignore */ }
    try { if (recorder.state !== 'inactive') recorder.stop(); } catch (e) { /* ignore */ }
    this._detachAudio(stream);
    stopVideoTracks(stream);
  }

  /** Remove (never stop) the shared audio track so the AudioEngine can reuse it later. */
  _detachAudio(stream) {
    const track = this._audioTrack;
    this._audioTrack = null;
    if (!track || !stream) return;
    try { stream.removeTrack(track); } catch (e) { /* ignore */ }
  }
}

function stopVideoTracks(stream) {
  try {
    if (!stream) return;
    for (const track of stream.getVideoTracks()) {
      try { track.stop(); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
}

function sanitizeFilename(name) {
  const clean = String(name || 'dumpling-club-bite').replace(/\.(mp4|webm)$/i, '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').trim();
  return clean || 'dumpling-club-bite';
}

function isLikelySafari() {
  try {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/i.test(ua);
  } catch (e) {
    return false;
  }
}

export default BiteRecorder;
