export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export function lowPassCoefficients(
  cutoffHz: number,
  q: number,
  sampleRate: number,
): BiquadCoefficients {
  const cutoff = Math.max(10, Math.min(cutoffHz, sampleRate * 0.49));
  const resolvedQ = Math.max(0.05, q);
  const omega = (2 * Math.PI * cutoff) / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * resolvedQ);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cosine) / 2 / a0,
    b1: (1 - cosine) / a0,
    b2: (1 - cosine) / 2 / a0,
    a1: (-2 * cosine) / a0,
    a2: (1 - alpha) / a0,
  };
}

export class BiquadLowPass {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private readonly coefficients: BiquadCoefficients;

  constructor(cutoffHz: number, q: number, sampleRate: number) {
    this.coefficients = lowPassCoefficients(cutoffHz, q, sampleRate);
  }

  process(input: number): number {
    const { b0, b1, b2, a1, a2 } = this.coefficients;
    const output =
      b0 * input + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = input;
    this.y2 = this.y1;
    this.y1 = output;
    return output;
  }
}
