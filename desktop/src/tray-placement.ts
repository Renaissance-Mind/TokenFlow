import type { Point, Rectangle } from "electron";

export function trayAnchor(bounds: Rectangle, click: Point | undefined, display: Rectangle): Rectangle {
  // A duplicated macOS menu bar can report the icon bounds on another display.
  // Keep the actual click as the anchor in that case, including negative origins.
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const valid = bounds.width > 0 && bounds.height > 0 && center.x >= display.x && center.x < display.x + display.width && center.y >= display.y && center.y < display.y + display.height;
  if (click && !valid) {
    return { ...click, width: 0, height: 0 };
  }
  return { ...bounds };
}

export function trayPopupBounds(anchor: Rectangle, area: Rectangle, desiredHeight: number): Rectangle {
  const width = Math.min(420, area.width);
  const height = Math.min(Math.max(260, desiredHeight), 760, Math.max(1, area.height - 18));
  const below = anchor.y < area.y + area.height / 2;
  const clamp = (value: number, start: number, length: number, size: number) => Math.round(Math.min(Math.max(value, start), start + length - size));
  return {
    x: clamp(anchor.x + anchor.width / 2 - width / 2, area.x, area.width, width),
    y: clamp(below ? anchor.y + anchor.height + 6 : anchor.y - height - 6, area.y, area.height, height),
    width, height: Math.round(height),
  };
}
