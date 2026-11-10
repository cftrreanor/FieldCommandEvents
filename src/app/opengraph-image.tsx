import { ImageResponse } from "next/og";
import { brand } from "@/lib/brand";

// The picture shown when the site is shared in a text, email or social post.
export const alt = `${brand.name}: event sign-ups, registration, and check-in`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #071a31 0%, #0b3558 55%, #1f5a8c 100%)",
          color: "white",
        }}
      >
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", opacity: 0.85 }}>{brand.name}</div>
        <div style={{ marginTop: 28, fontSize: 76, fontWeight: 600, lineHeight: 1.05 }}>Events, without the clipboards.</div>
        <div style={{ marginTop: 32, fontSize: 27, opacity: 0.8 }}>
          Sign-up sheets · contests · festivals · volunteers · check-in
        </div>
      </div>
    ),
    size,
  );
}
