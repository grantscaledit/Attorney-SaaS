import { describe, expect, it } from "vitest";
import { textPdf } from "../../tests/integration/pdf";
import { fromBlocks, sniffFileKind, TextLayerReader } from ".";

describe("text layer reader", () => {
  it("reads each page of a PDF with embedded text", async () => {
    const bytes = textPdf([
      ["Department of the Treasury", "Notice CP2000 (test)"],
      ["Second page with enough text to read"],
    ]);
    expect(sniffFileKind(bytes)?.mime).toBe("application/pdf");
    const r = await new TextLayerReader().read({ bytes, mime: "application/pdf" });
    expect(r.pages).toHaveLength(2);
    expect(r.pages[0]).toContain("Notice CP2000 (test)");
    expect(r.unreadablePages).toEqual([]);
  });
  it("flags pages with no text, and images it cannot read", async () => {
    const r = await new TextLayerReader().read({
      bytes: textPdf([["x"], ["A page that has a readable line of text"]]),
      mime: "application/pdf",
    });
    expect(r.unreadablePages).toEqual([1]);
    const img = await new TextLayerReader().read({
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0]),
      mime: "image/jpeg",
    });
    expect(img.unreadablePages).toEqual([1]);
  });
});

describe("file sniffing", () => {
  it("trusts bytes, not names", () => {
    expect(sniffFileKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))?.mime).toBe("image/png");
    expect(sniffFileKind(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull(); // a Windows executable
    expect(sniffFileKind(new TextEncoder().encode("<html>"))).toBeNull();
  });
});

describe("Textract blocks", () => {
  it("groups lines by page and flags low confidence", () => {
    const r = fromBlocks([
      { BlockType: "PAGE", Page: 1 },
      { BlockType: "LINE", Page: 1, Text: "Internal Revenue Service notice", Confidence: 99 },
      { BlockType: "LINE", Page: 2, Text: "smudged text that is hard to read", Confidence: 40 },
    ]);
    expect(r.pages).toEqual([
      "Internal Revenue Service notice",
      "smudged text that is hard to read",
    ]);
    expect(r.unreadablePages).toEqual([2]);
    expect(r.confidence).toBeCloseTo(0.695);
  });
});
