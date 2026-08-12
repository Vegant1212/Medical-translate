import { describe, expect, it } from "vitest";

import { isBibliographicReference, protectBibliographySegments } from "@/lib/documents/types";

describe("bibliography protection", () => {
  it("recognizes common medical reference formats", () => {
    expect(isBibliographicReference("1. Smith J, et al. Lancet. 2024;12:22-31." )).toBe(true);
    expect(isBibliographicReference("García L, et al. Rev Med. 2023;18(2):10-19. doi:10.1000/test")).toBe(true);
    expect(isBibliographicReference("El paciente presentó mejoría clínica progresiva.")).toBe(false);
  });

  it("protects the complete references section", () => {
    const result = protectBibliographySegments([
      { id: "a", text: "Clinical results", container: "Cuerpo" },
      { id: "b", text: "References", container: "Cuerpo" },
      { id: "c", text: "Smith J. Example study. 2024.", container: "Cuerpo" },
    ]);
    expect(result[0].protectedReason).toBeUndefined();
    expect(result[1].protectedReason).toBe("bibliography");
    expect(result[2].protectedReason).toBe("bibliography");
  });
});
