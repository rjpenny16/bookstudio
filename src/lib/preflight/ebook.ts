import { bytesToMb, ebookRoyalty } from "@/lib/kdp/ebook";
import { EBOOK_MAX_FILE_MB, EBOOK_ROYALTY_US, FILL_IN_TYPES, MOSTLY_BLANK_TYPES } from "@/lib/kdp/rules-ebook";
import { ebookLayoutOf, sectionsToBlocks } from "@/lib/export/ebookBlocks";
import { editionOf } from "@/lib/schema/formats";
import type { Project } from "@/lib/schema/project";
import { round } from "@/lib/util/ids";
import type { Check, Issue } from "./index";

/** The measured eBook size, when it was built from the current page count. */
export function measuredEbookMb(p: Project): number | null {
  const s = editionOf(p, "ebook").ebookSize;
  return s && s.pages === p.interior.pages.length && (s.layout ?? "fixed") === ebookLayoutOf(p) ? bytesToMb(s.bytes) : null;
}

/**
 * The Kindle eBook edition, when it is turned on: a price KDP allows at the chosen royalty
 * rate, a file size that keeps the 70% delivery fee worthwhile, and the warnings for books
 * readers write in, which a Kindle can only show.
 */
export function ebookCheck(project: Project): Check | null {
  const e = editionOf(project, "ebook");
  if (!e.enabled) return null;
  const fails: Issue[] = [];
  const warns: Issue[] = [];
  const mb = measuredEbookMb(project);
  const price = e.listPriceUsd;

  if (mb == null) warns.push({ area: "spec", message: "Build the eBook once on the Export tab so BookStudio can measure its size (the 70% rate charges a delivery fee per MB)." });
  else if (mb > EBOOK_MAX_FILE_MB) fails.push({ area: "spec", message: `The eBook is ${round(mb, 1)} MB; KDP's limit is ${EBOOK_MAX_FILE_MB} MB. Use the Standard image size.` });

  if (price == null) warns.push({ area: "listing", message: "Set an eBook list price." });
  else {
    const r = ebookRoyalty(price, mb ?? 0);
    const plan = e.royaltyPlan ?? r.best;
    if (plan === "70" && !r.seventy.eligible) fails.push({ area: "listing", message: `The 70% rate needs a list price from $${EBOOK_ROYALTY_US.highMinUsd} to $${EBOOK_ROYALTY_US.highMaxUsd}; the eBook is $${price.toFixed(2)}.` });
    if (plan === "35" && price < r.thirtyFive.minPriceUsd) fails.push({ area: "listing", message: `At this file size KDP's lowest eBook price is $${r.thirtyFive.minPriceUsd.toFixed(2)}.` });
    if (price > EBOOK_ROYALTY_US.lowMaxUsd) fails.push({ area: "listing", message: `KDP's highest eBook price is $${EBOOK_ROYALTY_US.lowMaxUsd}.` });
    if (mb != null && plan === "70" && r.seventy.eligible && r.best === "35")
      warns.push({ area: "listing", message: `At ${round(mb, 1)} MB the delivery fee ($${r.seventy.deliveryUsd.toFixed(2)}) makes 35% pay more: $${r.thirtyFive.royaltyUsd.toFixed(2)} vs $${r.seventy.royaltyUsd.toFixed(2)} a sale.` });
  }

  const layout = ebookLayoutOf(project);
  if (layout === "text") {
    const plan = sectionsToBlocks(project);
    for (const b of plan.blocks) if (b.type === "chapter" && !b.paragraphs.length) warns.push({ area: "interior", message: `"${b.title || b.kicker}" has no text for the eBook.` });
    if (plan.omitted.length) warns.push({ area: "spec", message: `Left out of the text eBook (nobody can write on a Kindle): ${plan.omitted.join(", ")}.` });
  }

  if (MOSTLY_BLANK_TYPES.includes(project.bookType)) warns.push({ area: "spec", message: "Mostly blank books make poor eBooks, and KDP may reject them. Consider print formats only for this book." });
  else if (FILL_IN_TYPES.includes(project.bookType)) warns.push({ area: "listing", message: "Kindle readers can't write in an eBook. Say so in the eBook description (for example \"view or print the pages\") to avoid returns and bad reviews." });

  if (fails.length) return { id: "ebook", title: "Kindle eBook", status: "fail", summary: `${fails.length} eBook problem(s)`, issues: [...fails, ...warns] };
  if (warns.length) return { id: "ebook", title: "Kindle eBook", status: "warn", summary: `${warns.length} eBook item(s) to check`, issues: warns };
  return { id: "ebook", title: "Kindle eBook", status: "pass", summary: `${layout === "text" ? "Text" : "Fixed-layout"} eBook, ${round(mb ?? 0, 1)} MB; no ISBN needed`, issues: [] };
}
