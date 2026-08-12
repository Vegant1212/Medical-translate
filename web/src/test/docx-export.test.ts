import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { textToDocx, validateDocx } from "@/lib/docx-export";

describe("Word export", () => {
  it("creates a complete package and removes invalid PDF control characters", async () => {
    const paragraphs = Array.from({ length: 1200 }, (_, index) => `Segmento ${index + 1}: texto clínico ${index}.`);
    paragraphs[500] += "\u0000\u0007";
    const blob = await textToDocx(paragraphs.join("\n"), { title: "Traducción completa", lang: "es-MX" });

    await expect(validateDocx(blob)).resolves.toBeUndefined();
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const stylesXml = await zip.file("word/styles.xml")?.async("string");
    const contentTypesXml = await zip.file("[Content_Types].xml")?.async("string");

    expect(documentXml).toContain("Segmento 1: texto clínico 0.");
    expect(documentXml).toContain("Segmento 1200: texto clínico 1199.");
    // eslint-disable-next-line no-control-regex
    expect(documentXml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    expect(stylesXml).toContain('w:lang w:val="es-MX"');
    expect(contentTypesXml).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    );
  });
});
