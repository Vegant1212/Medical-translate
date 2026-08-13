import { describe, expect, it } from "vitest";

import { detectLanguageLocally } from "@/lib/language-detection";

describe("detectLanguageLocally", () => {
  it("detects common medical Spanish and English", () => {
    expect(detectLanguageLocally("El paciente presenta dolor y recibe tratamiento para la hipertensión.")).toBe("es");
    expect(detectLanguageLocally("The patient received treatment for the disease and improved with therapy.")).toBe("en");
  });

  it("waits when there is not enough evidence", () => {
    expect(detectLanguageLocally("Dolor")).toBeUndefined();
  });
});
