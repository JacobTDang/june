/**
 * A read-only tap on the room's audio, for anything that wants to react to it.
 *
 * Extracted from the old pixel visualiser so the album-art bloom can use it
 * without carrying that component's dot-grid along with it.
 */

/** Power of two; 512 bins is plenty for a bloom that only reads broad energy. */
const FFT_SIZE = 512;

export interface AudioGraph {
  context: AudioContext;
  analyser: AnalyserNode;
  bins: Uint8Array<ArrayBuffer>;
}

/** captureStream isn't in the standard lib DOM types for HTMLAudioElement
 * yet. Firefox only ever shipped it under the legacy-prefixed
 * mozCaptureStream name rather than the unprefixed method other non-Safari
 * engines use, so both must be feature-detected; this is the narrowest way
 * to do that without reaching for `any`. */
type CaptureCapableAudio = HTMLAudioElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

/**
 * Build a read-only *copy* of the element's audio for the analyser, never a
 * reroute. `captureStream` clones the element's output into a MediaStream;
 * feeding that (not the element itself) into the AudioContext means the
 * element keeps playing through its own native output path untouched. A
 * suspended AudioContext (iOS backgrounding, tab throttling, etc.) can then
 * only freeze the analyser's data — it can never silence audible playback,
 * which `createMediaElementSource` risked because it reroutes the element's
 * actual output through the (suspendable) context graph.
 *
 * Returns null when there is no usable tap: Safari implements neither
 * captureStream nor the Firefox-prefixed mozCaptureStream on <audio>
 * elements, so it's the one engine that gets the shimmer fallback — which
 * is the correct trade either way, since it costs only the visualizer,
 * never the audio, because playback must never depend on the visualizer
 * working.
 */
/**
 * One tap per element, for as long as the element lives.
 *
 * A browser allows only a handful of AudioContexts per page, and this used to
 * build a fresh one on every call — so a component that re-ran its effect a
 * few times (a new track, a state change) quietly exhausted the budget and
 * every later call failed the same way a browser without captureStream does.
 * The tap is a property of the element, so it is cached against it.
 */
const taps = new WeakMap<HTMLAudioElement, AudioGraph>();

export function getAudioGraph(audio: HTMLAudioElement): AudioGraph | null {
  const existing = taps.get(audio);
  if (existing) return existing;

  const captureCapable = audio as CaptureCapableAudio;
  const captureStream = captureCapable.captureStream ?? captureCapable.mozCaptureStream;
  if (typeof captureStream !== "function") {
    return null;
  }
  try {
    const stream = captureStream.call(captureCapable);
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    // Deliberately never connected to context.destination — see the
    // function doc: this graph is a tap, not a playback path.
    const graph: AudioGraph = {
      context,
      analyser,
      bins: new Uint8Array(analyser.frequencyBinCount),
    };
    taps.set(audio, graph);
    return graph;
  } catch {
    // Deliberate best-effort path: AudioContext/tap construction can throw
    // outright in some environments (no Web Audio support, a restrictive
    // embed context). The caller falls back to the pulse shimmer for the
    // rest of the session — playback itself is unaffected, since nothing
    // here ever touches the element's normal output path.
    return null;
  }
}
