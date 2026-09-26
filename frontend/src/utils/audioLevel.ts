/**
 * Compute audio level using only voice-frequency bins (80Hz–4000Hz).
 *
 * The default approach of averaging ALL FFT bins dilutes voice energy
 * because most high-frequency bins are near zero for speech. Restricting
 * to the voice band produces levels of ~30-60 for normal speech instead
 * of ~5-15, making the sensitivity slider usable across its full range.
 */
export function computeVoiceLevel(
  analyser: AnalyserNode,
  dataArray: Uint8Array<ArrayBuffer>,
): number {
  analyser.getByteFrequencyData(dataArray);

  const sampleRate = analyser.context.sampleRate;
  const binHz = sampleRate / (analyser.fftSize || 256);
  const startBin = Math.max(1, Math.floor(80 / binHz));
  const endBin = Math.min(dataArray.length, Math.ceil(4000 / binHz));
  const binCount = endBin - startBin;

  if (binCount <= 0) {
    // Fallback: average all bins if sample rate / fftSize don't give valid range
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    return (sum / dataArray.length / 255) * 100;
  }

  let sum = 0;
  for (let i = startBin; i < endBin; i++) {
    sum += dataArray[i];
  }

  return (sum / binCount / 255) * 100;
}
