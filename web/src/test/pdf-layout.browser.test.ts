import { PDFDocument, StandardFonts } from "pdf-lib";

import { parsePdf } from "@/lib/documents/pdf";

test("keeps table cells separate without splitting the neighboring text column", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 800]);
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  page.drawText("Patient age", { x: 50, y: 700, size: 8, font });
  page.drawText("44.5", { x: 220, y: 700, size: 8, font });
  page.drawText("Gender", { x: 50, y: 688, size: 8, font });
  page.drawText("Male", { x: 220, y: 688, size: 8, font });
  page.drawText("This paragraph belongs to the right column.", { x: 330, y: 700, size: 8, font });
  page.drawText("It must remain a paragraph instead of a table cell.", { x: 330, y: 688, size: 8, font });

  const bytes = await pdf.save();
  const parsed = await parsePdf(new File([bytes], "table.pdf", { type: "application/pdf" }));
  const texts = parsed.segments.map((segment) => segment.text);

  expect(texts).toContain("Patient age");
  expect(texts).toContain("Gender");
  expect(texts).not.toContain("Patient age Gender");
  expect(texts).toContain(
    "This paragraph belongs to the right column. It must remain a paragraph instead of a table cell.",
  );
});
