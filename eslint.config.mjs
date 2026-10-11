import webVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  ...webVitals,
  ...typescript,
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  {
    rules: {
      // Inch marks (6" x 9") are everywhere in print UIs.
      "react/no-unescaped-entities": "off",
      // Previews are generated data/blob URLs; next/image adds nothing there.
      "@next/next/no-img-element": "off",
    },
  },
];

export default config;
