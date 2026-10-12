/** Bundled open fonts (SIL OFL 1.1). Every font is embedded in exported PDFs. */

export interface FontDef {
  family: string;
  label: string;
  category: "sans" | "serif" | "display" | "script" | "mono";
  regular: string;
  bold?: string;
  copyright: string;
}

export const FONTS: FontDef[] = [
  { family: "Inter", label: "Inter", category: "sans", regular: "Inter_400Regular.ttf", bold: "Inter_700Bold.ttf", copyright: "Copyright 2020 The Inter Project Authors" },
  { family: "Montserrat", label: "Montserrat", category: "sans", regular: "Montserrat_400Regular.ttf", bold: "Montserrat_700Bold.ttf", copyright: "Copyright 2024 The Montserrat Project Authors" },
  { family: "Oswald", label: "Oswald", category: "display", regular: "Oswald_400Regular.ttf", bold: "Oswald_700Bold.ttf", copyright: "Copyright 2016 The Oswald Project Authors" },
  { family: "Anton", label: "Anton", category: "display", regular: "Anton_400Regular.ttf", copyright: "Copyright 2020 The Anton Project Authors" },
  { family: "Merriweather", label: "Merriweather", category: "serif", regular: "Merriweather_400Regular.ttf", bold: "Merriweather_700Bold.ttf", copyright: "Copyright 2020 The Merriweather Project Authors" },
  { family: "Lora", label: "Lora", category: "serif", regular: "Lora_400Regular.ttf", bold: "Lora_700Bold.ttf", copyright: "Copyright 2011 The Lora Project Authors" },
  { family: "Playfair Display", label: "Playfair Display", category: "serif", regular: "PlayfairDisplay_400Regular.ttf", bold: "PlayfairDisplay_700Bold.ttf", copyright: "Copyright 2017 The Playfair Display Project Authors" },
  { family: "Pacifico", label: "Pacifico", category: "script", regular: "Pacifico_400Regular.ttf", copyright: "Copyright 2018 The Pacifico Project Authors" },
  { family: "Caveat", label: "Caveat", category: "script", regular: "Caveat_400Regular.ttf", bold: "Caveat_700Bold.ttf", copyright: "Copyright 2014 The Caveat Project Authors" },
  { family: "Roboto Mono", label: "Roboto Mono", category: "mono", regular: "RobotoMono_400Regular.ttf", bold: "RobotoMono_700Bold.ttf", copyright: "Copyright 2015 The Roboto Mono Project Authors" },
  { family: "Bebas Neue", label: "Bebas Neue", category: "display", regular: "BebasNeue_400Regular.ttf", copyright: "Copyright 2019 The Bebas Neue Project Authors" },
  { family: "Archivo Black", label: "Archivo Black", category: "display", regular: "ArchivoBlack_400Regular.ttf", copyright: "Copyright 2017 The Archivo Black Project Authors" },
  { family: "Fredoka", label: "Fredoka", category: "display", regular: "Fredoka_600SemiBold.ttf", bold: "Fredoka_700Bold.ttf", copyright: "Copyright 2016 The Fredoka Project Authors" },
  { family: "Lilita One", label: "Lilita One", category: "display", regular: "LilitaOne_400Regular.ttf", copyright: "Copyright 2011 Juan Montoreano, with Reserved Font Names \"Lilita One\"" },
  { family: "DM Serif Display", label: "DM Serif Display", category: "serif", regular: "DMSerifDisplay_400Regular.ttf", copyright: "Copyright 2014-2017 Adobe Systems Incorporated, with Reserved Font Name 'Source'. Copyright 2019 Google LLC." },
  { family: "Abril Fatface", label: "Abril Fatface", category: "display", regular: "AbrilFatface_400Regular.ttf", copyright: "Copyright 2011 TypeTogether, with Reserved Font Names \"Abril\" and \"Abril Fatface\"" },
  { family: "Roboto Slab", label: "Roboto Slab", category: "serif", regular: "RobotoSlab_400Regular.ttf", bold: "RobotoSlab_700Bold.ttf", copyright: "Copyright 2018 The Roboto Slab Project Authors" },
  { family: "Raleway", label: "Raleway", category: "sans", regular: "Raleway_400Regular.ttf", bold: "Raleway_700Bold.ttf", copyright: "Copyright 2010 The Raleway Project Authors" },
];

export const DEFAULT_FONT = "Inter";

export function fontDef(family: string): FontDef {
  return FONTS.find((f) => f.family === family) ?? FONTS[0];
}

/** Font file for a family/weight. Families without a bold cut fall back to regular. */
export function fontFile(family: string, bold: boolean): string {
  const def = fontDef(family);
  return bold && def.bold ? def.bold : def.regular;
}

/** CSS family name used on the canvas. Bold is a separate face so canvas and PDF match. */
export function cssFamily(family: string, bold: boolean): string {
  const def = fontDef(family);
  return bold && def.bold ? `${def.family} Bold` : def.family;
}

export function fontFaceCss(basePath = "/fonts"): string {
  return FONTS.flatMap((f) => {
    const faces = [`@font-face{font-family:"${f.family}";src:url("${basePath}/${f.regular}") format("truetype");font-display:block;}`];
    if (f.bold) faces.push(`@font-face{font-family:"${f.family} Bold";src:url("${basePath}/${f.bold}") format("truetype");font-display:block;}`);
    return faces;
  }).join("\n");
}

export type FontBytesLoader = (file: string) => Promise<Uint8Array>;

export const browserFontLoader: FontBytesLoader = async (file) => {
  const res = await fetch(`/fonts/${file}`);
  if (!res.ok) throw new Error(`Font ${file} failed to load (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
};
