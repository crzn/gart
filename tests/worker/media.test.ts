import { describe, expect, it } from "vitest";
import { sniffImage } from "../../apps/worker/src/routes/media";

const bytes = (...n: number[]) => Uint8Array.from(n);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe("sniffImage", () => {
  it("recognises PNG, JPEG and WebP", () => {
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImage(bytes(...ascii("RIFF"), 1, 0, 0, 0, ...ascii("WEBP")))).toBe("image/webp");
  });
  it("refuses SVG, HTML, GIF and empty input", () => {
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<script>alert(1)</script>"))).toBeNull();
    expect(sniffImage(bytes(...ascii("GIF89a"), 0, 0))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
  it("refuses RIFF containers that are not WebP", () => {
    expect(sniffImage(bytes(...ascii("RIFF"), 1, 0, 0, 0, ...ascii("WAVE")))).toBeNull();
  });
});
