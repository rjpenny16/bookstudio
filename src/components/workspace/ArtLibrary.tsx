"use client";

import { useEffect, useState } from "react";
import type { ArtTemplateId } from "@/lib/cover/art";
import { GOOD_FIT, rankLibrary, type LibraryArt, type LibraryArtSummary } from "@/lib/cover/artLibrary";
import type { GenreId } from "@/lib/cover/genres";
import type { CoverGeometry } from "@/lib/kdp/geometry";
import { deleteLibraryArt, listLibrary, loadLibraryArt, setLibraryFavorite } from "@/lib/storage/artLibrary";

/** Browse every cover image generated so far, in any project, and add one to this book without generating. */
export function ArtLibrary({ layout, cg, genre, exclude, onAdd, disabled }: { layout: ArtTemplateId; cg: CoverGeometry; genre: GenreId; exclude: ReadonlySet<string>; onAdd: (art: LibraryArt) => void; disabled: boolean }) {
  const [entries, setEntries] = useState<LibraryArtSummary[] | null>(null);
  const [error, setError] = useState("");
  const [sameGenreOnly, setSameGenreOnly] = useState(false);
  const [goodFitOnly, setGoodFitOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  const reload = () =>
    listLibrary()
      .then(setEntries)
      .catch((e) => setError(`Could not open the art library: ${e instanceof Error ? e.message : e}`));
  useEffect(() => {
    reload();
  }, []);

  const act = (fn: () => Promise<void>) => fn().then(reload, (e) => setError(e instanceof Error ? e.message : String(e)));

  const add = async (id: string) => {
    setAdding(id);
    try {
      const art = await loadLibraryArt(id);
      if (!art) throw new Error("That image is no longer in the library.");
      onAdd(art);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(null);
    }
  };

  if (error) return <div className="notice notice-fail">{error}</div>;
  if (!entries) return null;
  const matches = rankLibrary(entries, { layout, cg, genre, sameGenreOnly, goodFitOnly, favoritesOnly, exclude });

  return (
    <div className="stack" aria-label="Art library" style={{ gap: 6 }}>
      <p className="field-hint" style={{ margin: 0 }}>
        {entries.length} image(s) saved from every book you&apos;ve generated art for. Adding one costs nothing and takes no time.
      </p>
      <div className="row" style={{ gap: 12 }}>
        <label className="check">
          <input type="checkbox" checked={sameGenreOnly} onChange={(e) => setSameGenreOnly(e.target.checked)} /> Same kind of book
        </label>
        <label className="check">
          <input type="checkbox" checked={goodFitOnly} onChange={(e) => setGoodFitOnly(e.target.checked)} /> Fits this layout
        </label>
        <label className="check">
          <input type="checkbox" checked={favoritesOnly} onChange={(e) => setFavoritesOnly(e.target.checked)} /> Favorites
        </label>
      </div>
      {matches.length === 0 ? (
        <p className="field-hint" style={{ margin: 0 }}>
          {entries.length ? "Nothing matches these filters; try clearing one." : "Nothing saved yet. Every image you generate from now on is kept here, picked or not."}
        </p>
      ) : (
        <div className="grid grid-2" role="list" aria-label="Library images" style={{ gap: 8 }}>
          {matches.map(({ entry: e, kept, dpi }) => (
            <div key={e.id} role="listitem" aria-label={e.name} className="stack" style={{ gap: 4, border: "1px solid var(--line)", borderRadius: 8, padding: 4 }}>
              {e.thumbUrl ? (
                <img src={e.thumbUrl} alt={`Library art: ${e.name}`} title={e.prompt} style={{ width: "100%", aspectRatio: `${e.widthPx} / ${e.heightPx}`, objectFit: "cover", borderRadius: 4 }} />
              ) : (
                <div title={e.prompt} style={{ aspectRatio: `${e.widthPx} / ${e.heightPx}`, background: "var(--line)", borderRadius: 4 }} />
              )}
              <span style={{ fontSize: 11 }}>
                {e.name}
                {e.used ? " · used" : ""}
                <br />
                <span className="field-hint">
                  From {e.projectTitle} · {Math.round(dpi)} DPI{kept < GOOD_FIT ? ` · crop keeps ${Math.round(kept * 100)}%` : ""}
                </span>
              </span>
              <div className="row" style={{ gap: 4 }}>
                <button className="btn btn-sm" onClick={() => add(e.id)} disabled={disabled || !!adding}>
                  {adding === e.id && <span className="spinner" />} Add to this book
                </button>
                <button className="btn btn-sm btn-ghost" aria-label={e.favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={e.favorite} onClick={() => act(() => setLibraryFavorite(e.id, !e.favorite))}>
                  {e.favorite ? "★" : "☆"}
                </button>
                <button className="btn btn-sm btn-ghost" aria-label="Delete from library" onClick={() => confirm(`Delete "${e.name}" from the art library? Books already using it keep their copy.`) && act(() => deleteLibraryArt(e.id))}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
