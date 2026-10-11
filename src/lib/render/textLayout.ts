/**
 * Text layout shared by the PDF renderer and preflight. It mirrors Fabric.js
 * Textbox metrics (line box = fontSize * 1.13 * lineHeight, baseline at
 * 0.879 * fontSize below the line top) so print output matches the editor.
 */

export const FONT_SIZE_MULT = 1.13;
const FONT_SIZE_FRACTION = 0.222;
export const BASELINE_RATIO = FONT_SIZE_MULT * (1 - FONT_SIZE_FRACTION);

export type MeasureFn = (text: string) => number;

export function wrapText(text: string, maxWidth: number, measure: MeasureFn): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ");
    let current = "";
    for (const word of words) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (current !== "" && measure(candidate) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

export function lineAdvance(fontSize: number, lineHeight: number): number {
  return fontSize * FONT_SIZE_MULT * lineHeight;
}

export function textBlockHeight(lineCount: number, fontSize: number, lineHeight: number): number {
  if (lineCount <= 0) return 0;
  return (lineCount - 1) * lineAdvance(fontSize, lineHeight) + fontSize * FONT_SIZE_MULT;
}

export function baselineOffset(lineIndex: number, fontSize: number, lineHeight: number): number {
  return lineIndex * lineAdvance(fontSize, lineHeight) + fontSize * BASELINE_RATIO;
}

/** Rough width estimate when real font metrics are unavailable. */
export const approxMeasure = (fontSize: number): MeasureFn => (s) => s.length * fontSize * 0.55;
