import { describe, expect, it } from "vitest";

import { ACCEPTED_EXTENSIONS, kindFromFile } from "@/lib/documents/types";

describe("document upload formats", () => {
  it("accepts modern Word files regardless of filename case", () => {
    expect(kindFromFile({ name: "informe.docx" } as File)).toBe("docx");
    expect(kindFromFile({ name: "INFORME.DOCX" } as File)).toBe("docx");
    expect(ACCEPTED_EXTENSIONS).toContain(".docx");
  });

  it("does not mistake legacy .doc files for .docx", () => {
    expect(kindFromFile({ name: "informe.doc" } as File)).toBeUndefined();
  });
});
