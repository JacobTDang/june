import { describe, expect, it } from "vitest";
import { isSilentFrame, spectrumColumns, type SpectrumConfig } from "../../src/audio/spectrum";

function bins(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function silentBins(length: number): Uint8Array {
  return new Uint8Array(length);
}

describe("spectrumColumns - log-spaced banding", () => {
  it("maps every bin to exactly one column, leaves no column empty, and gives column 0 fewer bins than column 7", () => {
    const totalBins = 64;
    const columns = 8;
    const config: SpectrumConfig = { columns, smoothing: 0 };

    // Isolate one bin at a time (255, rest 0) and read off which column
    // lit up - that column's value is 1/bandSize, which also reveals the
    // band's bin count.
    const columnOfBin: number[] = [];
    const bandSizeOfColumn: number[] = new Array(columns).fill(0);

    for (let i = 0; i < totalBins; i++) {
      const frame = new Uint8Array(totalBins);
      frame[i] = 255;
      const result = spectrumColumns(frame, null, config);

      const lit = result
        .map((value, column) => ({ value, column }))
        .filter(({ value }) => value > 0);

      expect(lit).toHaveLength(1); // every bin belongs to exactly one column
      const { value, column } = lit[0]!;
      columnOfBin.push(column);
      bandSizeOfColumn[column] = Math.round(1 / value);
    }

    // No column is empty.
    for (let c = 0; c < columns; c++) {
      expect(columnOfBin).toContain(c);
    }

    expect(bandSizeOfColumn[0]).toBeLessThan(bandSizeOfColumn[7]!);
  });
});

describe("spectrumColumns - column values", () => {
  it("is the mean of the column's bins divided by 255", () => {
    const config: SpectrumConfig = { columns: 1, smoothing: 0 };
    const frame = bins(0, 85, 170, 255); // mean 127.5

    const result = spectrumColumns(frame, null, config);

    expect(result).toEqual([127.5 / 255]);
  });

  it("stays within 0..1 for the loudest and quietest possible frames", () => {
    const config: SpectrumConfig = { columns: 4, smoothing: 0 };

    expect(spectrumColumns(silentBins(16), null, config)).toEqual([0, 0, 0, 0]);
    expect(spectrumColumns(new Uint8Array(16).fill(255), null, config)).toEqual([1, 1, 1, 1]);
  });
});

describe("spectrumColumns - smoothing", () => {
  it("returns the current frame unchanged when there is no previous frame", () => {
    const config: SpectrumConfig = { columns: 1, smoothing: 0.9 };
    const frame = bins(0, 255); // mean 127.5

    const result = spectrumColumns(frame, null, config);

    expect(result).toEqual([127.5 / 255]);
  });

  it("returns the current frame unchanged when smoothing is 0", () => {
    const config: SpectrumConfig = { columns: 1, smoothing: 0 };
    const frame = bins(0, 255);

    const result = spectrumColumns(frame, [0.9], config);

    expect(result).toEqual([127.5 / 255]);
  });

  it("blends previous and current by the smoothing factor", () => {
    const config: SpectrumConfig = { columns: 1, smoothing: 0.5 };
    const frame = bins(255, 255); // current = 1

    const result = spectrumColumns(frame, [0.2], config);

    expect(result[0]).toBeCloseTo(0.2 * 0.5 + 1 * 0.5, 10);
  });

  it("does not mutate the bins or previous inputs", () => {
    const config: SpectrumConfig = { columns: 1, smoothing: 0.5 };
    const frame = bins(255, 255);
    const previous = Object.freeze([0.2]);

    expect(() => spectrumColumns(frame, previous, config)).not.toThrow();
    expect(frame).toEqual(bins(255, 255));
  });
});

describe("spectrumColumns - validation", () => {
  it("throws on zero-length bins", () => {
    const config: SpectrumConfig = { columns: 4, smoothing: 0 };
    expect(() => spectrumColumns(new Uint8Array(0), null, config)).toThrow();
  });

  it("throws when columns is less than 1", () => {
    const frame = silentBins(8);
    expect(() => spectrumColumns(frame, null, { columns: 0, smoothing: 0 })).toThrow();
    expect(() => spectrumColumns(frame, null, { columns: -1, smoothing: 0 })).toThrow();
  });

  it("throws when columns exceeds bins.length, naming both numbers", () => {
    const frame = silentBins(4);
    expect(() => spectrumColumns(frame, null, { columns: 8, smoothing: 0 })).toThrow(/8/);
    expect(() => spectrumColumns(frame, null, { columns: 8, smoothing: 0 })).toThrow(/4/);
  });

  it("throws when smoothing is negative", () => {
    const frame = silentBins(8);
    expect(() => spectrumColumns(frame, null, { columns: 1, smoothing: -0.01 })).toThrow();
  });

  it("throws when smoothing is 1 or greater", () => {
    const frame = silentBins(8);
    expect(() => spectrumColumns(frame, null, { columns: 1, smoothing: 1 })).toThrow();
    expect(() => spectrumColumns(frame, null, { columns: 1, smoothing: 1.5 })).toThrow();
  });

  it("accepts smoothing at the lower bound (0) and just under the upper bound", () => {
    const frame = silentBins(8);
    expect(() => spectrumColumns(frame, null, { columns: 1, smoothing: 0 })).not.toThrow();
    expect(() => spectrumColumns(frame, null, { columns: 1, smoothing: 0.999 })).not.toThrow();
  });
});

describe("isSilentFrame", () => {
  it("is true when every bin is zero", () => {
    expect(isSilentFrame(silentBins(32))).toBe(true);
  });

  it("is false when any bin is non-zero", () => {
    const frame = silentBins(32);
    frame[17] = 1;
    expect(isSilentFrame(frame)).toBe(false);
  });

  it("throws on empty input", () => {
    expect(() => isSilentFrame(new Uint8Array(0))).toThrow();
  });
});
