import qrcode from "qrcode-generator";
import { useMemo } from "react";

/** A QR code drawn as one SVG path. Generated entirely in the browser: no network call, no service. */
export default function QrCode({ text, size, label }: { text: string; size: number; label: string }) {
  const { d, n } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let path = "";
    for (let r = 0; r < count; r++) {
      let c = 0;
      while (c < count) {
        if (!qr.isDark(r, c)) { c++; continue; }
        const start = c;
        while (c < count && qr.isDark(r, c)) c++;
        path += `M${start + 4} ${r + 4}h${c - start}v1h-${c - start}z`; // 4 modules of quiet zone around the code
      }
    }
    return { d: path, n: count + 8 };
  }, [text]);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges" className="rounded-2xl bg-white" data-testid="qr" data-url={text}>
      <path d={d} fill="#0f172a" />
    </svg>
  );
}
