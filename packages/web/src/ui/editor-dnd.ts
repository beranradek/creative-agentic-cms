import type React from "react";

export type DragPayload =
  | { kind: "section"; sectionId: string }
  | { kind: "component"; sectionId: string; componentId: string };

const DRAG_MIME = "application/x-cac";
let inMemoryDragPayload: DragPayload | null = null;

export function setDragPayload(e: React.DragEvent, payload: DragPayload) {
  inMemoryDragPayload = payload;
  e.dataTransfer.effectAllowed = "move";
  const raw = JSON.stringify(payload);
  e.dataTransfer.setData(DRAG_MIME, raw);
  e.dataTransfer.setData("text/plain", raw);
}

export function clearDragPayload() {
  inMemoryDragPayload = null;
}

export function getDragPayload(e: React.DragEvent): DragPayload | null {
  const candidates = [e.dataTransfer.getData(DRAG_MIME), e.dataTransfer.getData("text/plain")].filter(
    (value) => value && value.trim().length
  );
  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") continue;
      const record = parsed as Record<string, unknown>;
      if (
        record.kind === "section" &&
        typeof record.sectionId === "string"
      ) {
        return { kind: "section", sectionId: record.sectionId };
      }
      if (
        record.kind === "component" &&
        typeof record.sectionId === "string" &&
        typeof record.componentId === "string"
      ) {
        return {
          kind: "component",
          sectionId: record.sectionId,
          componentId: record.componentId,
        };
      }
    } catch {
      // ignore invalid DnD payloads
    }
  }
  return inMemoryDragPayload;
}
