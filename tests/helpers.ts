import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FontBytesLoader } from "@/lib/render/fonts";

export const nodeFontLoader: FontBytesLoader = async (file) => new Uint8Array(await readFile(path.join(process.cwd(), "public/fonts", file)));
