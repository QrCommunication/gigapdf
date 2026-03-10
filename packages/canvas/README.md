# @giga-pdf/canvas

Fabric.js-based canvas package for PDF rendering and editing in the Giga-PDF platform.

## Features

- **PDF Rendering**: Integration with PDF.js for rendering PDF pages
- **Custom Objects**: Fabric.js objects for PDF elements (text, images, shapes, annotations)
- **Tools System**: Complete toolset for different editing modes
- **React Hooks**: Custom hooks for canvas management
- **Zoom & Pan**: Built-in zoom and pan controls
- **Export Utilities**: Export canvas to various formats (PNG, JPEG, SVG)
- **TypeScript**: Full TypeScript support with strict mode

## Installation

```bash
pnpm add @giga-pdf/canvas
```

## Usage

### Basic Canvas Setup

```tsx
import { FabricCanvas } from "@giga-pdf/canvas";
import type { PageObject } from "@giga-pdf/types";

function PDFEditor() {
  const canvasRef = useRef<FabricCanvasRef>(null);
  const [pages, setPages] = useState<PageObject[]>([]);

  return (
    <FabricCanvas
      ref={canvasRef}
      pages={pages}
      width={800}
      height={600}
      tool="select"
      enableZoom
      onObjectModified={(obj) => console.log("Modified:", obj)}
    />
  );
}
```

### Using Custom Hooks

```tsx
import { useCanvas, useSelection, useZoom } from "@giga-pdf/canvas";

function CustomCanvas() {
  const { canvasRef, canvas, isReady } = useCanvas({
    width: 800,
    height: 600,
  });

  const { selectedObjects, deleteSelected } = useSelection(canvas);
  const { zoom, zoomIn, zoomOut } = useZoom(canvas);

  return (
    <div>
      <canvas ref={canvasRef} />
      <button onClick={zoomIn}>Zoom In</button>
      <button onClick={zoomOut}>Zoom Out</button>
      <button onClick={deleteSelected}>Delete</button>
    </div>
  );
}
```

### Using Tools

```tsx
import { SelectTool, TextTool, ShapeTool } from "@giga-pdf/canvas";

// Selection tool
const selectTool = new SelectTool(canvas);
selectTool.activate();

// Text tool
const textTool = new TextTool(canvas);
textTool.createText(100, 100, "Hello World");

// Shape tool
const shapeTool = new ShapeTool(canvas, {
  shapeType: "rectangle",
  fillColor: "transparent",
  strokeColor: "#000000",
});
shapeTool.activate();
```

### PDF Rendering

```tsx
import { PDFRenderer } from "@giga-pdf/canvas";

async function renderPDF() {
  const renderer = new PDFRenderer();
  await renderer.loadDocument("/path/to/document.pdf");

  const canvas = document.createElement("canvas");
  await renderer.renderPage(canvas, 1, { scale: 1.5 });

  // Create thumbnail
  const thumbnail = await renderer.createThumbnail(1, 200, 300);
}
```

### Custom Objects

```tsx
import { PDFText, PDFImage, PDFShape } from "@giga-pdf/canvas";

// Create text object from element
const textElement: TextElement = { /* ... */ };
const textObject = PDFText.fromElement(textElement);
canvas.add(textObject);

// Create image object
const imageElement: ImageElement = { /* ... */ };
const imageObject = await PDFImage.fromElement(imageElement);
canvas.add(imageObject);

// Create shape object
const shapeElement: ShapeElement = { /* ... */ };
const shapeObject = PDFShape.fromElement(shapeElement);
canvas.add(shapeObject);
```

### Export Canvas

```tsx
import { exportToDataURL, exportToBlob, downloadCanvas } from "@giga-pdf/canvas";

// Export to data URL
const dataURL = exportToDataURL(canvas, { format: "png", quality: 1 });

// Export to blob
const blob = await exportToBlob(canvas, { format: "jpeg", quality: 0.8 });

// Download canvas
await downloadCanvas(canvas, "canvas.png", { format: "png" });
```

## API Reference

### Components

#### FabricCanvas

Main React component wrapping Fabric.js canvas.

**Props:**
- `pages?: PageObject[]` - PDF pages to render
- `width?: number` - Canvas width
- `height?: number` - Canvas height
- `backgroundColor?: string` - Background color
- `tool?: Tool` - Active tool
- `enableZoom?: boolean` - Enable zoom
- `enablePan?: boolean` - Enable pan
- `onObjectAdded?: (obj) => void` - Object added callback
- `onObjectModified?: (obj) => void` - Object modified callback
- `onObjectRemoved?: (obj) => void` - Object removed callback
- `onSelectionChanged?: (objects) => void` - Selection changed callback

**Ref Methods:**
- `getCanvas()` - Get Fabric.js canvas instance
- `renderPage(page)` - Render a page
- `addElement(element)` - Add an element
- `removeElement(elementId)` - Remove an element
- `clearCanvas()` - Clear canvas
- `exportToDataURL(format)` - Export to data URL
- `exportToBlob(format)` - Export to blob
- `getSelectedObjects()` - Get selected objects
- `selectObject(obj)` - Select an object
- `clearSelection()` - Clear selection
- `zoom(level)` - Set zoom level
- `zoomIn()` - Zoom in
- `zoomOut()` - Zoom out
- `zoomToFit()` - Zoom to fit
- `resetZoom()` - Reset zoom

### Hooks

#### useCanvas(options)

Create and manage a Fabric.js canvas.

#### useSelection(canvas)

Manage canvas selection.

#### useZoom(canvas, options)

Manage canvas zoom.

#### useCanvasEvents(canvas, handlers)

Handle canvas events.

### Tools

#### SelectTool

Selection and manipulation tool.

#### TextTool

Text creation and editing tool.

#### DrawTool

Freehand drawing tool.

#### ShapeTool

Shape creation tool.

#### AnnotationTool

Annotation creation tool.

#### PanTool

Canvas panning tool.

#### ZoomTool

Canvas zoom tool.

### Renderers

#### PDFRenderer

PDF.js integration for rendering PDF pages.

#### TextRenderer

Text element rendering.

#### ImageRenderer

Image element rendering.

#### ShapeRenderer

Shape element rendering.

#### AnnotationRenderer

Annotation element rendering.

### Utilities

#### Transform Utilities
- `pdfToCanvas()` - Convert PDF coordinates to canvas
- `canvasToPdf()` - Convert canvas coordinates to PDF
- `transformToFabric()` - Convert Transform to Fabric
- `fabricToTransform()` - Convert Fabric to Transform

#### Bounds Utilities
- `getObjectBounds()` - Get object bounds
- `unionBounds()` - Union multiple bounds
- `expandBounds()` - Expand bounds
- `constrainBounds()` - Constrain bounds

#### Export Utilities
- `exportToDataURL()` - Export to data URL
- `exportToBlob()` - Export to blob
- `exportToSVG()` - Export to SVG
- `downloadCanvas()` - Download canvas

## License

MIT
