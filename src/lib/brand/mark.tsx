import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

const fontPath = path.join(
  process.cwd(),
  "node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff",
);

export function Mark({ px }: { px: number }) {
  const s = px / 64;
  return (
    <div
      style={{
        width: px,
        height: px,
        display: "flex",
        position: "relative",
        background: "#0c0c0a",
        borderRadius: 15 * s,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 13 * s,
          top: 0,
          fontFamily: "Plex",
          fontWeight: 700,
          fontSize: 56 * s,
          lineHeight: 1,
          color: "#f4f3ee",
        }}
      >
        t
      </div>
      <div
        style={{
          position: "absolute",
          left: 40 * s,
          top: 42 * s,
          width: 10 * s,
          height: 10 * s,
          borderRadius: 999,
          background: "#facc15",
        }}
      />
    </div>
  );
}

export async function renderMark(px: number) {
  return new ImageResponse(<Mark px={px} />, {
    width: px,
    height: px,
    fonts: [
      {
        name: "Plex",
        data: await readFile(fontPath),
        weight: 700,
        style: "normal",
      },
    ],
  });
}
