// Transcribes an offline-model recording in pieces while the person is still
// talking, so stopping leaves only the last few seconds to decode. Pieces are
// cut at pauses (never mid-word) and decoded one at a time, in order. Any
// failure, cancel or gap in the audio makes finish() return null, and the
// caller decodes the whole recording the old way: nothing is ever lost.
import { buildWav } from "../utils/wavBuilder";

const SAMPLE_RATE = 16000;
const FRAME = 320; // 20 ms
const MIN_PIECE_S = 14; // never cut sooner: fewer cuts keep the words around them accurate
const MAX_PIECE_S = 30; // cut by now even without a clear pause
const PAUSE_FRAMES = 12; // 240 ms of quiet counts as a pause
const EDGE_FRAMES = 10; // keep 200 ms after a pause so the next word isn't clipped
const CHECK_EVERY_S = 0.5;
const SILENT_RMS = 0.004; // ~-48 dB: a piece this quiet holds no speech
const COVERAGE_TOLERANCE_S = 0.5;

function frameRms(samples) {
  const frames = Math.floor(samples.length / FRAME);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * FRAME, end = i + FRAME; i < end; i++) {
      const v = samples[i] / 0x7fff;
      sum += v * v;
    }
    out[f] = Math.sqrt(sum / FRAME);
  }
  return out;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

// Where to cut `pending` (sample index), or -1 to keep listening.
export function findCut(pending) {
  const rms = frameRms(pending);
  const frames = rms.length;
  const minFrames = (MIN_PIECE_S * SAMPLE_RATE) / FRAME;
  const maxFrames = (MAX_PIECE_S * SAMPLE_RATE) / FRAME;
  if (frames < minFrames) return -1;

  // A pause is quiet next to this person's own speaking level, so a quiet mic works too.
  const speech = percentile(rms, 0.7);
  const quiet = Math.max(SILENT_RMS, speech * 0.3);
  const first = Math.floor(minFrames / 2);
  const last = frames - PAUSE_FRAMES - EDGE_FRAMES;
  let windowSum = 0;
  let bestLate = -1;
  let quietest = -1;
  let quietestMean = Infinity;
  for (let f = 0; f < frames; f++) {
    windowSum += rms[f];
    if (f >= PAUSE_FRAMES) windowSum -= rms[f - PAUSE_FRAMES];
    const start = f - PAUSE_FRAMES + 1;
    if (start < first || start > last) continue;
    const mean = windowSum / PAUSE_FRAMES;
    if (mean <= quiet) bestLate = start; // keep the latest pause: longer pieces decode better
    if (mean < quietestMean) {
      quietestMean = mean;
      quietest = start;
    }
  }
  const pick = bestLate >= 0 ? bestLate : frames >= maxFrames ? quietest : -1;
  if (pick < 0) return -1;
  return (pick + Math.floor(PAUSE_FRAMES / 2)) * FRAME;
}

export class LiveCommitter {
  /**
   * @param {{ transcribe: (wav: Blob) => Promise<{success?: boolean, text?: string}>,
   *           onText?: (textSoFar: string) => void, log?: (msg: string, data?: object) => void }} opts
   */
  constructor({ transcribe, onText, log }) {
    this._transcribe = transcribe;
    this._onText = onText;
    this._log = log || (() => {});
    this._chunks = [];
    this._pendingSamples = 0;
    this._sinceCheck = 0;
    this._received = 0;
    this._texts = [];
    this._pieces = 0;
    this._chain = Promise.resolve();
    this._failed = false;
    this._aborted = false;
  }

  push(chunk) {
    if (this._aborted || this._failed || !chunk?.length) return;
    this._chunks.push(chunk);
    this._pendingSamples += chunk.length;
    this._received += chunk.length;
    this._sinceCheck += chunk.length;
    if (this._sinceCheck < CHECK_EVERY_S * SAMPLE_RATE) return;
    this._sinceCheck = 0;
    const pending = this._pending();
    const cut = findCut(pending);
    if (cut <= 0) return;
    this._queue(pending.subarray(0, cut));
    const rest = pending.slice(cut);
    this._chunks = [rest];
    this._pendingSamples = rest.length;
  }

  _pending() {
    if (this._chunks.length === 1) return this._chunks[0];
    const all = new Int16Array(this._pendingSamples);
    let offset = 0;
    for (const c of this._chunks) {
      all.set(c, offset);
      offset += c.length;
    }
    this._chunks = [all];
    return all;
  }

  _queue(samples) {
    const index = this._pieces++;
    const seconds = +(samples.length / SAMPLE_RATE).toFixed(1);
    if (percentile(frameRms(samples), 0.95) < SILENT_RMS) {
      this._texts[index] = "";
      return;
    }
    const wav = buildWav(samples, SAMPLE_RATE);
    this._chain = this._chain.then(async () => {
      if (this._aborted || this._failed) return;
      const started = performance.now();
      try {
        const result = await this._transcribe(wav);
        // A piece of breathing or room noise is a normal part of a recording.
        const noSpeech = result?.success === false && result.message === "No audio detected";
        if (!result?.success && !noSpeech) {
          throw new Error(result?.error || result?.message || "no result");
        }
        this._texts[index] = noSpeech ? "" : (result.text || "").trim();
        this._log("Live piece decoded", { index, seconds, ms: Math.round(performance.now() - started) });
        if (!this._aborted) this._onText?.(this.text());
      } catch (error) {
        this._failed = true;
        this._log("Live piece failed, will decode the whole recording", { index, error: error.message });
      }
    });
  }

  text() {
    return this._texts.filter(Boolean).join(" ");
  }

  /**
   * Call after the last audio chunk arrived. Returns the full transcript, or
   * null when the caller should decode the whole recording instead.
   */
  async finish({ expectedSeconds } = {}) {
    if (this._aborted) return null;
    // Short recordings never got cut: the normal path handles them the same way.
    if (this._pieces === 0) {
      this.abort();
      return null;
    }
    if (
      Number.isFinite(expectedSeconds) &&
      this._received < (expectedSeconds - COVERAGE_TOLERANCE_S) * SAMPLE_RATE
    ) {
      this._log("Live audio has a gap, will decode the whole recording", {
        receivedSeconds: +(this._received / SAMPLE_RATE).toFixed(1),
        expectedSeconds,
      });
      this.abort();
      return null;
    }
    if (this._pendingSamples > 0) this._queue(this._pending());
    this._chunks = [];
    this._pendingSamples = 0;
    await this._chain;
    if (this._failed || this._aborted) return null;
    const text = this.text();
    return text || null;
  }

  abort() {
    this._aborted = true;
    this._chunks = [];
    this._pendingSamples = 0;
  }
}
