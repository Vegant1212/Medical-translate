export interface GeometryLine {
  x: number;
  y: number;
  right: number;
  fontSize: number;
}

export interface TabularRow {
  baseline: number;
  leftHalf: boolean;
}

/** Finds rows containing two or more horizontally separated cells. */
export function findTabularRows(lines: GeometryLine[], pageMidpoint: number): TabularRow[] {
  const result: TabularRow[] = [];
  const baselineRows = new Map<number, GeometryLine[]>();
  for (const line of lines) {
    const baseline = Math.round(line.y);
    const row = baselineRows.get(baseline) ?? [];
    row.push(line);
    baselineRows.set(baseline, row);
  }
  for (const [baseline, row] of baselineRows) {
    for (const leftHalf of [true, false]) {
      const half = row.filter((line) => (line.x < pageMidpoint) === leftHalf);
      const hasSeparateCells = half.some((line, index) => half.slice(index + 1).some((other) => {
        const gap = Math.max(other.x - line.right, line.x - other.right);
        return gap > Math.max(4, Math.min(line.fontSize, other.fontSize) * 0.55);
      }));
      if (hasSeparateCells) result.push({ baseline, leftHalf });
    }
  }
  return result;
}

/** Includes wrapped labels immediately adjacent to a detected table row. */
export function isNearTabularRow(
  line: GeometryLine,
  pageMidpoint: number,
  rows: TabularRow[],
): boolean {
  return rows.some(({ baseline, leftHalf }) =>
    leftHalf === (line.x < pageMidpoint) &&
    Math.abs(baseline - line.y) <= Math.max(10, line.fontSize * 1.45));
}
