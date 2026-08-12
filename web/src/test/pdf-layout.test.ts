import { describe, expect, it } from "vitest";

import { findTabularRows, isNearTabularRow, type GeometryLine } from "@/lib/documents/pdf-geometry";

describe("PDF table extraction", () => {
  it("detects cells only in the half of the page that contains the table", () => {
    const line = (x: number, y: number, width: number): GeometryLine => ({ x, y, right: x + width, fontSize: 8 });
    const lines = [
      line(50, 700, 70),
      line(220, 700, 25),
      line(50, 688, 45),
      line(220, 688, 30),
      line(330, 700, 210),
      line(330, 688, 210),
    ];
    const rows = findTabularRows(lines, 300);

    expect(isNearTabularRow(lines[0], 300, rows)).toBe(true);
    expect(isNearTabularRow(lines[2], 300, rows)).toBe(true);
    expect(isNearTabularRow(lines[4], 300, rows)).toBe(false);
    expect(isNearTabularRow(lines[5], 300, rows)).toBe(false);
  });
});
