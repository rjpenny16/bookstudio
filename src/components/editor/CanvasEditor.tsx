"use client";

import { Canvas, Ellipse, FabricImage, Group, Line, Path, Point, Rect, Textbox, util, type FabricObject, type TPointerEventInfo } from "fabric";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Box } from "@/lib/kdp/geometry";
import { ensureFonts } from "@/lib/render/canvas";
import { cssFamily } from "@/lib/render/fonts";
import { expandPattern } from "@/lib/render/patterns";
import type { Asset, Element, PatternElement } from "@/lib/schema/project";

export interface Guide {
  box: Box;
  color: string;
  dash?: number[];
  fill?: string;
  label?: string;
}

export interface CanvasEditorProps {
  /** Region of model space to show (e.g. trim + bleed + pasteboard). */
  world: Box;
  /** Area painted as paper / cover background. */
  paper: Box;
  background: string;
  elements: Element[];
  assets: Asset[];
  guides: Guide[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** `silent` changes (measurement corrections) should not create undo steps. */
  onChange: (elements: Element[], opts?: { silent?: boolean }) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  label: string;
}

type Tagged = FabricObject & { __id?: string; __bg?: boolean };

const SNAP_PX = 6;

function patternPaths(el: PatternElement): FabricObject[] {
  const groups = new Map<string, { d: string[]; width: number; dash?: number[] }>();
  let dots = "";
  for (const p of expandPattern(el)) {
    if (p.kind === "line") {
      const key = `${p.width}|${p.dash?.join(",") ?? ""}`;
      if (!groups.has(key)) groups.set(key, { d: [], width: p.width, dash: p.dash });
      groups.get(key)!.d.push(`M${el.x + p.x1} ${el.y + p.y1}L${el.x + p.x2} ${el.y + p.y2}`);
    } else {
      const cx = el.x + p.cx;
      const cy = el.y + p.cy;
      dots += `M${cx - p.r} ${cy}a${p.r} ${p.r} 0 1 0 ${p.r * 2} 0a${p.r} ${p.r} 0 1 0 ${-p.r * 2} 0`;
    }
  }
  const out: FabricObject[] = [];
  for (const g of groups.values()) out.push(new Path(g.d.join(""), { stroke: el.stroke, strokeWidth: g.width, strokeDashArray: g.dash, fill: "", objectCaching: false }));
  if (dots) out.push(new Path(dots, { fill: el.stroke, stroke: "", strokeWidth: 0, objectCaching: false }));
  return out;
}

async function toFabric(el: Element, assets: Map<string, Asset>): Promise<Tagged> {
  const center = { left: el.x + el.width / 2, top: el.y + el.height / 2 };
  const common = {
    originX: "center" as const,
    originY: "center" as const,
    angle: el.rotation,
    opacity: el.opacity ?? 1,
    strokeUniform: true,
    lockMovementX: !!el.locked,
    lockMovementY: !!el.locked,
    lockRotation: !!el.locked,
    lockScalingX: !!el.locked,
    lockScalingY: !!el.locked,
    hasControls: !el.locked,
    borderColor: "#0f6e63",
    cornerColor: "#0f6e63",
    cornerStrokeColor: "#ffffff",
    transparentCorners: false,
    cornerSize: 9,
  };
  let obj: Tagged;
  switch (el.type) {
    case "rect":
      obj = new Rect({ ...common, ...center, width: el.width, height: el.height, fill: el.fill ?? "transparent", stroke: el.stroke ?? undefined, strokeWidth: el.stroke ? el.strokeWidth : 0, rx: el.cornerRadius, ry: el.cornerRadius });
      break;
    case "ellipse":
      obj = new Ellipse({ ...common, ...center, rx: el.width / 2, ry: el.height / 2, fill: el.fill ?? "transparent", stroke: el.stroke ?? undefined, strokeWidth: el.stroke ? el.strokeWidth : 0 });
      break;
    case "line":
      obj = new Line([el.x, el.y, el.x + el.width, el.y + el.height], { ...common, angle: 0, stroke: el.stroke, strokeWidth: Math.max(el.strokeWidth, 0.25), strokeLineCap: el.cap ?? "butt", strokeDashArray: el.dash, padding: 3 });
      break;
    case "text": {
      const outline = el.strokeColor && el.strokeWidth ? { stroke: el.strokeColor, strokeWidth: el.strokeWidth * 2, paintFirst: "stroke" as const, strokeLineJoin: "round" as const } : {};
      // Fabric's charSpacing is in thousandths of an em.
      const tb = new Textbox(el.text, { ...common, ...center, width: el.width, fontSize: el.fontSize, fontFamily: cssFamily(el.fontFamily, el.bold), fill: el.color, textAlign: el.align, lineHeight: el.lineHeight, splitByGrapheme: false, charSpacing: (el.letterSpacing ?? 0) * 1000, ...outline });
      tb.setPositionByOrigin(new Point(el.x + el.width / 2, el.y + tb.height / 2), "center", "center");
      obj = tb;
      break;
    }
    case "image": {
      const asset = assets.get(el.assetId);
      if (!asset) {
        obj = new Rect({ ...common, ...center, width: el.width, height: el.height, fill: "#f3d6d6", stroke: "#c62828", strokeWidth: 1 });
        break;
      }
      const img = await FabricImage.fromURL(asset.dataUrl);
      img.set({ ...common, ...center, scaleX: el.width / (img.width || 1), scaleY: el.height / (img.height || 1) });
      obj = img;
      break;
    }
    case "path":
    case "pattern": {
      const frame = new Rect({ left: el.x, top: el.y, width: el.width, height: el.height, fill: "rgba(0,0,0,0)", strokeWidth: 0, originX: "left", originY: "top" });
      let content: FabricObject[];
      if (el.type === "pattern") content = patternPaths(el);
      else {
        const sx = el.width / (el.viewBoxW || 1);
        const sy = el.height / (el.viewBoxH || 1);
        const p = new Path(el.d, { fill: el.fill ?? "", stroke: el.stroke ?? "", strokeWidth: el.strokeWidth / ((sx + sy) / 2), strokeLineCap: "round", strokeLineJoin: "round", scaleX: sx, scaleY: sy, objectCaching: false });
        const minX = p.pathOffset.x - p.width / 2;
        const minY = p.pathOffset.y - p.height / 2;
        p.set({ originX: "left", originY: "top", left: el.x + minX * sx - (p.strokeWidth * sx) / 2, top: el.y + minY * sy - (p.strokeWidth * sy) / 2 });
        content = [p];
      }
      const g = new Group([frame, ...content], { subTargetCheck: false, interactive: false });
      g.set({ ...common, angle: 0 });
      g.setPositionByOrigin(new Point(el.x + el.width / 2, el.y + el.height / 2), "center", "center");
      g.set({ angle: el.rotation });
      obj = g;
      break;
    }
  }
  obj.__id = el.id;
  return obj;
}

/** Read an edited Fabric object back into the model. */
function fromFabric(obj: Tagged, el: Element): Element {
  const c = obj.getCenterPoint();
  const sx = obj.scaleX ?? 1;
  const sy = obj.scaleY ?? 1;
  const touched = el.provenance && el.provenance.origin !== "human" ? { provenance: { ...el.provenance, humanEdited: true } } : {};
  const box = (w: number, h: number) => ({ x: c.x - w / 2, y: c.y - h / 2, width: w, height: h, rotation: Math.round((obj.angle ?? 0) * 100) / 100 });
  switch (el.type) {
    case "line": {
      const l = obj as Line;
      const pts = l.calcLinePoints();
      const m = l.calcTransformMatrix();
      const a = util.transformPoint(new Point(pts.x1, pts.y1), m);
      const b = util.transformPoint(new Point(pts.x2, pts.y2), m);
      return { ...el, ...touched, x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y, rotation: 0 };
    }
    case "text": {
      const t = obj as Textbox;
      const uniform = Math.abs(sx - sy) < 0.001 && Math.abs(sx - 1) > 0.001;
      const fontSize = uniform ? Math.round(el.fontSize * sy * 10) / 10 : el.fontSize;
      return { ...el, ...touched, ...box(t.width * sx, t.height * sy), text: t.text ?? el.text, fontSize };
    }
    case "rect":
    case "image":
      return { ...el, ...touched, ...box(obj.width * sx, obj.height * sy) };
    case "ellipse":
      return { ...el, ...touched, ...box((obj as Ellipse).rx * 2 * sx, (obj as Ellipse).ry * 2 * sy) };
    case "path":
    case "pattern":
      return { ...el, ...touched, ...box(el.width * sx, el.height * sy) };
  }
}

export default function CanvasEditor(props: CanvasEditorProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const objects = useRef(new Map<string, { el: Element; obj: Tagged }>());
  const expected = useRef(new Map<string, Element>());
  const bgRef = useRef<Rect | null>(null);
  const propsRef = useRef(props);
  const buildToken = useRef(0);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const zoomRef = useRef<number | "fit">("fit");
  const [effectiveZoom, setEffectiveZoom] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    propsRef.current = props;
  });

  const applyViewport = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const { world } = propsRef.current;
    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;
    if (canvas.width !== cw || canvas.height !== ch) canvas.setDimensions({ width: cw, height: ch });
    const fit = Math.min((cw - 32) / world.width, (ch - 32) / world.height);
    const z = zoomRef.current === "fit" ? fit : zoomRef.current;
    const ox = (cw - world.width * z) / 2 - world.x * z;
    const oy = zoomRef.current === "fit" || world.height * z < ch ? (ch - world.height * z) / 2 - world.y * z : 16 - world.y * z;
    canvas.setViewportTransform([z, 0, 0, z, ox, oy]);
    setEffectiveZoom(z);
    canvas.requestRenderAll();
  }, []);

  const commit = useCallback((obj: Tagged) => {
    const id = obj.__id;
    if (!id) return;
    const entry = objects.current.get(id);
    if (!entry) return;
    const next = fromFabric(obj, entry.el);
    entry.el = next;
    expected.current.set(id, next);
    const p = propsRef.current;
    p.onChange(p.elements.map((e) => (e.id === id ? next : e)));
  }, []);

  // Mount
  useEffect(() => {
    if (!canvasElRef.current) return;
    const canvas = new Canvas(canvasElRef.current, { preserveObjectStacking: true, selection: false, controlsAboveOverlay: true, uniformScaling: false, stopContextMenu: true });
    canvasRef.current = canvas;
    const bg = new Rect({ selectable: false, evented: false, excludeFromExport: true, originX: "left", originY: "top", strokeWidth: 0, objectCaching: false });
    (bg as Tagged).__bg = true;
    bgRef.current = bg;
    canvas.add(bg);

    canvas.on("after:render", ({ ctx }) => {
      const v = canvas.viewportTransform;
      ctx.save();
      ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
      const z = v[0];
      for (const g of propsRef.current.guides) {
        if (g.fill) {
          ctx.fillStyle = g.fill;
          ctx.fillRect(g.box.x, g.box.y, g.box.width, g.box.height);
        }
        ctx.strokeStyle = g.color;
        ctx.lineWidth = 1 / z;
        ctx.setLineDash((g.dash ?? []).map((d) => d / z));
        ctx.strokeRect(g.box.x, g.box.y, g.box.width, g.box.height);
        if (g.label) {
          ctx.setLineDash([]);
          ctx.fillStyle = g.color;
          ctx.font = `${10 / z}px system-ui, sans-serif`;
          ctx.fillText(g.label, g.box.x + 3 / z, g.box.y + 12 / z);
        }
      }
      ctx.restore();
    });

    const select = () => {
      const a = canvas.getActiveObject() as Tagged | undefined;
      propsRef.current.onSelect(a?.__id ?? null);
    };
    canvas.on("selection:created", select);
    canvas.on("selection:updated", select);
    canvas.on("selection:cleared", () => propsRef.current.onSelect(null));
    canvas.on("object:modified", ({ target }) => commit(target as Tagged));
    canvas.on("text:editing:exited", ({ target }) => commit(target as Tagged));

    // Snap moving objects to guide edges and centers.
    canvas.on("object:moving", ({ target }) => {
      const tol = SNAP_PX / canvas.getZoom();
      const r = target.getBoundingRect();
      const xs: number[] = [];
      const ys: number[] = [];
      for (const g of propsRef.current.guides) {
        xs.push(g.box.x, g.box.x + g.box.width / 2, g.box.x + g.box.width);
        ys.push(g.box.y, g.box.y + g.box.height / 2, g.box.y + g.box.height);
      }
      const snap = (edges: number[], targets: number[]) => {
        let best: number | null = null;
        for (const e of edges) for (const t of targets) if (Math.abs(t - e) < tol && (best === null || Math.abs(t - e) < Math.abs(best))) best = t - e;
        return best ?? 0;
      };
      const dx = snap([r.left, r.left + r.width / 2, r.left + r.width], xs);
      const dy = snap([r.top, r.top + r.height / 2, r.top + r.height], ys);
      if (dx || dy) target.set({ left: target.left + dx, top: target.top + dy });
    });

    canvas.on("mouse:wheel", (opt: TPointerEventInfo<WheelEvent>) => {
      const e = opt.e;
      if (!e.ctrlKey && !e.metaKey) {
        const v = canvas.viewportTransform.slice() as typeof canvas.viewportTransform;
        v[5] -= e.deltaY;
        v[4] -= e.deltaX;
        canvas.setViewportTransform(v);
        e.preventDefault();
        return;
      }
      let z = canvas.getZoom() * 0.999 ** e.deltaY;
      z = Math.min(8, Math.max(0.1, z));
      canvas.zoomToPoint(new Point(e.offsetX, e.offsetY), z);
      zoomRef.current = z;
      setZoom(z);
      setEffectiveZoom(z);
      e.preventDefault();
      e.stopPropagation();
    });

    const map = objects.current;
    const ro = new ResizeObserver(() => applyViewport());
    if (wrapRef.current) ro.observe(wrapRef.current);
    applyViewport();
    return () => {
      ro.disconnect();
      canvas.dispose();
      canvasRef.current = null;
      map.clear();
    };
  }, [applyViewport, commit]);

  // Paper, world and guides
  useEffect(() => {
    const bg = bgRef.current;
    if (!bg) return;
    bg.set({ left: props.paper.x, top: props.paper.y, width: props.paper.width, height: props.paper.height, fill: props.background });
    bg.setCoords();
    applyViewport();
  }, [props.paper, props.background, props.world, props.guides, applyViewport]);

  // Sync model -> canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const token = ++buildToken.current;
    const assets = new Map(props.assets.map((a) => [a.id, a]));
    const elements = props.elements;
    (async () => {
      await ensureFonts();
      if (token !== buildToken.current) return;
      const pending = elements.filter((el) => {
        const cur = objects.current.get(el.id);
        if (cur && cur.el === el) return false;
        if (cur && expected.current.get(el.id) === el) {
          cur.el = el;
          return false;
        }
        return true;
      });
      if (pending.length > 40) setBusy(true);
      const built = await Promise.all(pending.map(async (el) => [el, await toFabric(el, assets)] as const));
      if (token !== buildToken.current) return;
      const keep = new Set(elements.map((e) => e.id));
      for (const [id, entry] of objects.current) {
        if (!keep.has(id)) {
          canvas.remove(entry.obj);
          objects.current.delete(id);
        }
      }
      for (const [el, obj] of built) {
        const old = objects.current.get(el.id);
        if (old) canvas.remove(old.obj);
        objects.current.set(el.id, { el, obj });
        canvas.add(obj);
      }
      expected.current.clear();
      elements.forEach((el, i) => {
        const entry = objects.current.get(el.id);
        if (entry && canvas.getObjects().indexOf(entry.obj) !== i + 1) canvas.moveObjectTo(entry.obj, i + 1);
      });
      // Text heights come from real font metrics; feed corrections back silently.
      const corrections = new Map<string, Element>();
      for (const el of elements) {
        if (el.type !== "text") continue;
        const obj = objects.current.get(el.id)?.obj as Textbox | undefined;
        if (obj && Math.abs(obj.height - el.height) > 0.5) corrections.set(el.id, { ...el, height: obj.height, y: el.y });
      }
      const sel = propsRef.current.selectedId;
      const active = canvas.getActiveObject() as Tagged | undefined;
      if (sel && active?.__id !== sel) {
        const target = objects.current.get(sel)?.obj;
        if (target) canvas.setActiveObject(target);
      }
      canvas.requestRenderAll();
      setBusy(false);
      if (corrections.size) {
        for (const [id, el] of corrections) {
          const entry = objects.current.get(id);
          if (entry) entry.el = el;
          expected.current.set(id, el);
        }
        propsRef.current.onChange(
          elements.map((e) => corrections.get(e.id) ?? e),
          { silent: true },
        );
      }
    })();
  }, [props.elements, props.assets]);

  // Selection from outside (layer list, preflight links)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject() as Tagged | undefined;
    if (props.selectedId === (active?.__id ?? null)) return;
    if (!props.selectedId) canvas.discardActiveObject();
    else {
      const t = objects.current.get(props.selectedId)?.obj;
      if (t) canvas.setActiveObject(t);
    }
    canvas.requestRenderAll();
  }, [props.selectedId]);

  useEffect(() => {
    zoomRef.current = zoom;
    applyViewport();
  }, [zoom, applyViewport]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const canvas = canvasRef.current;
    const active = canvas?.getActiveObject() as (Tagged & { isEditing?: boolean }) | undefined;
    if (!canvas || !active?.__id || active.isEditing) return;
    const id = active.__id;
    const step = e.shiftKey ? 9 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      if (active.lockMovementX) return;
      active.set({ left: active.left + moves[e.key][0], top: active.top + moves[e.key][1] });
      active.setCoords();
      commit(active);
      canvas.requestRenderAll();
      e.preventDefault();
    } else if ((e.key === "Delete" || e.key === "Backspace") && props.onDelete) {
      props.onDelete(id);
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && props.onDuplicate) {
      props.onDuplicate(id);
      e.preventDefault();
    } else if (e.key === "Escape") {
      canvas.discardActiveObject();
      canvas.requestRenderAll();
    }
  };

  return (
    <div className="studio-col" style={{ flex: 1 }}>
      <div ref={wrapRef} className="canvas-wrap" tabIndex={0} onKeyDown={onKeyDown} aria-label={`${props.label} canvas. Select elements in the layer list; arrow keys nudge, Delete removes, Ctrl+D duplicates.`} role="application">
        <canvas ref={canvasElRef} />
        {busy && (
          <div style={{ position: "absolute", top: 10, right: 10 }} className="badge">
            <span className="spinner" /> Rendering…
          </div>
        )}
      </div>
      <div className="canvas-status">
        <div className="btn-group" role="group" aria-label="Zoom">
          <button className="btn btn-sm" onClick={() => setZoom(Math.max(0.1, effectiveZoom / 1.25))} aria-label="Zoom out">
            −
          </button>
          <button className="btn btn-sm" onClick={() => setZoom("fit")} aria-pressed={zoom === "fit"}>
            {Math.round((effectiveZoom / (96 / 72)) * 100)}%
          </button>
          <button className="btn btn-sm" onClick={() => setZoom(Math.min(8, effectiveZoom * 1.25))} aria-label="Zoom in">
            +
          </button>
        </div>
        {props.guides
          .filter((g) => g.label)
          .map((g) => (
            <span key={g.label}>
              <span className="legend-swatch" style={{ borderColor: g.color }} />
              {g.label}
            </span>
          ))}
        <span className="spacer" />
        <span>Ctrl+scroll to zoom · double-click text to edit</span>
      </div>
    </div>
  );
}
