import { PALETTE_CHOICES, TEMPLATE_CHOICES, type CoverStyleOutput } from "@/lib/ai/tasks";

/**
 * Offline answer to "restyle the cover": map words in the publisher's
 * feedback to a template and palette. When nothing matches, step to the next
 * palette so the button always produces a visible change.
 */

type Template = (typeof TEMPLATE_CHOICES)[number];
type PaletteId = (typeof PALETTE_CHOICES)[number];

const TEMPLATE_WORDS: [RegExp, Template][] = [
  [/playful|fun|kid|child|cute|whimsical/i, "playful"],
  [/minimal|clean|simple|modern|less busy|cluttered|space/i, "minimal"],
  [/classic|elegant|timeless|traditional|serif|frame/i, "framed"],
  [/bold|strong|punchy|stand out/i, "band"],
  [/geometric|shapes|abstract|circles/i, "geometric"],
  [/puzzle|grid/i, "puzzle"],
  [/flower|floral|botanical|garden/i, "botanical"],
  [/large print|senior|big print|starburst/i, "starburst"],
  [/series|volume|collection/i, "series"],
  [/spiral|notebook look|coil/i, "spiral"],
  [/rainbow|arcs|boho/i, "rainbow"],
  [/vintage|retro|label|antique/i, "label"],
  [/mosaic|blocks|colou?rful grid/i, "color-blocks"],
  [/sticker|confetti|loud/i, "kids-bold"],
];

const PALETTE_WORDS: [RegExp, PaletteId][] = [
  [/dark|navy|night|moody/i, "midnight"],
  [/calm|soft|green|natural|gentle|muted/i, "sage"],
  [/pink|feminine|warm|romantic/i, "blush"],
  [/blue|ocean|sea|cool|fresh/i, "ocean"],
  [/bright|cheerful|yellow|sunny|happy|colou?rful/i, "sunny"],
  [/forest|outdoor|earthy|deep green/i, "forest"],
  [/grey|gray|serious|masculine|red/i, "charcoal"],
  [/cream|neutral|beige|vintage|light/i, "cream"],
  [/purple|lavender|lilac/i, "lavender"],
  [/terracotta|clay|rust|autumn|orange/i, "terracotta"],
  [/mint|teal|spring/i, "mint"],
  [/plum|wine|luxur/i, "plum"],
];

const asTemplate = (id: string): Template | null => ((TEMPLATE_CHOICES as readonly string[]).includes(id) ? (id as Template) : null);
const asPalette = (id: string): PaletteId | null => ((PALETTE_CHOICES as readonly string[]).includes(id) ? (id as PaletteId) : null);

export function restyleOffline(feedback: string, currentTemplate: string, currentPalette: string): CoverStyleOutput {
  const template = TEMPLATE_WORDS.find(([re]) => re.test(feedback))?.[1];
  const palette = PALETTE_WORDS.find(([re]) => re.test(feedback))?.[1];
  const curT = asTemplate(currentTemplate) ?? "band";
  const curP = asPalette(currentPalette) ?? "midnight";
  if (!template && !palette) {
    const next = PALETTE_CHOICES[(PALETTE_CHOICES.indexOf(curP) + 1) % PALETTE_CHOICES.length];
    return { template: curT, palette: next, reason: "Offline: no style words recognized in the feedback, so the next palette was tried." };
  }
  return {
    template: template ?? curT,
    palette: palette ?? curP,
    reason: `Offline: matched ${[template && `"${template}" template`, palette && `"${palette}" palette`].filter(Boolean).join(" and ")} from the feedback.`,
  };
}
