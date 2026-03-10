/**
 * Selection tool for selecting and manipulating objects
 */

import * as fabric from "fabric";
import type { Point } from "@giga-pdf/types";
import { SelectionBox } from "../objects/selection-box";

export interface SelectionOptions {
  multiSelect?: boolean;
  enableRotation?: boolean;
  enableScaling?: boolean;
}

/**
 * Selection tool class
 */
export class SelectTool {
  private canvas: fabric.Canvas;
  private selectionBox: SelectionBox | null = null;
  private isSelecting: boolean = false;
  private startPoint: Point | null = null;
  private options: SelectionOptions;

  constructor(canvas: fabric.Canvas, options: SelectionOptions = {}) {
    this.canvas = canvas;
    this.options = {
      multiSelect: true,
      enableRotation: true,
      enableScaling: true,
      ...options,
    };
  }

  /**
   * Activate selection tool
   */
  activate(): void {
    this.canvas.selection = true;
    this.canvas.defaultCursor = "default";
    this.canvas.hoverCursor = "move";

    // Enable object selection
    this.canvas.forEachObject((obj) => {
      obj.set({
        selectable: true,
        hasControls: this.options.enableScaling,
        hasRotatingPoint: this.options.enableRotation,
      });
    });

    this.attachEvents();
  }

  /**
   * Deactivate selection tool
   */
  deactivate(): void {
    this.detachEvents();
    this.clearSelection();
    if (this.selectionBox) {
      this.canvas.remove(this.selectionBox);
      this.selectionBox = null;
    }
  }

  /**
   * Attach event handlers
   */
  private attachEvents(): void {
    this.canvas.on("mouse:down", this.onMouseDown);
    this.canvas.on("mouse:move", this.onMouseMove);
    this.canvas.on("mouse:up", this.onMouseUp);
  }

  /**
   * Detach event handlers
   */
  private detachEvents(): void {
    this.canvas.off("mouse:down", this.onMouseDown);
    this.canvas.off("mouse:move", this.onMouseMove);
    this.canvas.off("mouse:up", this.onMouseUp);
  }

  /**
   * Handle mouse down
   */
  private onMouseDown = (e: fabric.IEvent): void => {
    if (!this.options.multiSelect) return;

    const pointer = this.canvas.getPointer(e.e);
    this.startPoint = { x: pointer.x, y: pointer.y };
    this.isSelecting = true;

    // Create selection box
    if (!this.selectionBox) {
      this.selectionBox = new SelectionBox();
      this.canvas.add(this.selectionBox);
    }

    this.selectionBox.set({
      left: pointer.x,
      top: pointer.y,
      width: 0,
      height: 0,
    });
    this.selectionBox.show();
  };

  /**
   * Handle mouse move
   */
  private onMouseMove = (e: fabric.IEvent): void => {
    if (!this.isSelecting || !this.startPoint || !this.selectionBox) return;

    const pointer = this.canvas.getPointer(e.e);
    const width = pointer.x - this.startPoint.x;
    const height = pointer.y - this.startPoint.y;

    this.selectionBox.set({
      width: Math.abs(width),
      height: Math.abs(height),
      left: width < 0 ? pointer.x : this.startPoint.x,
      top: height < 0 ? pointer.y : this.startPoint.y,
    });

    this.canvas.renderAll();
  };

  /**
   * Handle mouse up
   */
  private onMouseUp = (): void => {
    if (!this.isSelecting || !this.selectionBox) return;

    // Select objects within selection box
    const selectedObjects = this.selectionBox.getIntersectingObjects(this.canvas);

    if (selectedObjects.length > 0) {
      const selection = new fabric.ActiveSelection(selectedObjects, {
        canvas: this.canvas,
      });
      this.canvas.setActiveObject(selection);
    }

    this.selectionBox.hide();
    this.isSelecting = false;
    this.startPoint = null;
    this.canvas.renderAll();
  };

  /**
   * Select object
   */
  selectObject(obj: fabric.Object): void {
    this.canvas.setActiveObject(obj);
    this.canvas.renderAll();
  }

  /**
   * Select multiple objects
   */
  selectObjects(objects: fabric.Object[]): void {
    if (objects.length === 0) return;

    if (objects.length === 1) {
      this.selectObject(objects[0]);
    } else {
      const selection = new fabric.ActiveSelection(objects, {
        canvas: this.canvas,
      });
      this.canvas.setActiveObject(selection);
      this.canvas.renderAll();
    }
  }

  /**
   * Get selected objects
   */
  getSelectedObjects(): fabric.Object[] {
    const activeObject = this.canvas.getActiveObject();
    if (!activeObject) return [];

    if (activeObject instanceof fabric.ActiveSelection) {
      return activeObject.getObjects();
    }

    return [activeObject];
  }

  /**
   * Clear selection
   */
  clearSelection(): void {
    this.canvas.discardActiveObject();
    this.canvas.renderAll();
  }

  /**
   * Select all objects
   */
  selectAll(): void {
    const objects = this.canvas.getObjects();
    this.selectObjects(objects);
  }

  /**
   * Delete selected objects
   */
  deleteSelected(): void {
    const selected = this.getSelectedObjects();
    selected.forEach((obj) => this.canvas.remove(obj));
    this.canvas.renderAll();
  }

  /**
   * Duplicate selected objects
   */
  async duplicateSelected(): Promise<fabric.Object[]> {
    const selected = this.getSelectedObjects();
    const duplicates: fabric.Object[] = [];

    for (const obj of selected) {
      const clone = await this.cloneObject(obj);
      clone.set({
        left: (clone.left || 0) + 10,
        top: (clone.top || 0) + 10,
      });
      this.canvas.add(clone);
      duplicates.push(clone);
    }

    this.selectObjects(duplicates);
    this.canvas.renderAll();

    return duplicates;
  }

  /**
   * Clone object
   */
  private async cloneObject(obj: fabric.Object): Promise<fabric.Object> {
    return new Promise((resolve) => {
      obj.clone((cloned: fabric.Object) => {
        resolve(cloned);
      });
    });
  }

  /**
   * Group selected objects
   */
  groupSelected(): fabric.Group | null {
    const selected = this.getSelectedObjects();
    if (selected.length < 2) return null;

    const group = new fabric.Group(selected, {
      canvas: this.canvas,
    });

    selected.forEach((obj) => this.canvas.remove(obj));
    this.canvas.add(group);
    this.canvas.setActiveObject(group);
    this.canvas.renderAll();

    return group;
  }

  /**
   * Ungroup selected group
   */
  ungroupSelected(): fabric.Object[] | null {
    const activeObject = this.canvas.getActiveObject();
    if (!(activeObject instanceof fabric.Group)) return null;

    const objects = activeObject.getObjects();
    activeObject.destroy();
    this.canvas.remove(activeObject);

    objects.forEach((obj) => this.canvas.add(obj));
    this.selectObjects(objects);
    this.canvas.renderAll();

    return objects;
  }

  /**
   * Bring selected to front
   */
  bringToFront(): void {
    const selected = this.getSelectedObjects();
    selected.forEach((obj) => this.canvas.bringToFront(obj));
    this.canvas.renderAll();
  }

  /**
   * Send selected to back
   */
  sendToBack(): void {
    const selected = this.getSelectedObjects();
    selected.forEach((obj) => this.canvas.sendToBack(obj));
    this.canvas.renderAll();
  }

  /**
   * Align selected objects
   */
  align(alignment: "left" | "center" | "right" | "top" | "middle" | "bottom"): void {
    const selected = this.getSelectedObjects();
    if (selected.length < 2) return;

    const bounds = selected.map((obj) => obj.getBoundingRect());
    const minX = Math.min(...bounds.map((b) => b.left));
    const maxX = Math.max(...bounds.map((b) => b.left + b.width));
    const minY = Math.min(...bounds.map((b) => b.top));
    const maxY = Math.max(...bounds.map((b) => b.top + b.height));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    selected.forEach((obj) => {
      const objBounds = obj.getBoundingRect();

      switch (alignment) {
        case "left":
          obj.set({ left: minX });
          break;
        case "center":
          obj.set({ left: centerX - objBounds.width / 2 });
          break;
        case "right":
          obj.set({ left: maxX - objBounds.width });
          break;
        case "top":
          obj.set({ top: minY });
          break;
        case "middle":
          obj.set({ top: centerY - objBounds.height / 2 });
          break;
        case "bottom":
          obj.set({ top: maxY - objBounds.height });
          break;
      }
      obj.setCoords();
    });

    this.canvas.renderAll();
  }
}
