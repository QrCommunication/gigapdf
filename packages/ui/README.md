# @giga-pdf/ui

Shared UI component library for GigaPDF, built with React, TypeScript, Radix UI, and Tailwind CSS.

## Features

- **Base UI Components**: Built on Radix UI primitives following shadcn/ui patterns
  - Button, Input, Dialog, Dropdown Menu, Select, Tabs, Tooltip
  - Slider, Switch, Popover, Separator, Scroll Area, Skeleton
  - Toast notifications with custom hook

- **Layout Components**: Structural components for application layout
  - Header, Sidebar, Footer

- **Editor Components**: Specialized components for PDF editing
  - Toolbar and ToolbarButton
  - ColorPicker with preset colors and custom input
  - FontPicker with common fonts
  - PageNavigator for PDF navigation
  - ZoomControls with preset levels
  - LayersPanel for managing document layers

## Installation

```bash
npm install @giga-pdf/ui
```

## Usage

### Import Styles

Import the global styles in your application:

```tsx
import "@giga-pdf/ui/styles";
```

### Using Components

```tsx
import { Button, Header, Toolbar, ColorPicker } from "@giga-pdf/ui";

function App() {
  return (
    <div>
      <Header
        logo={<span>GigaPDF</span>}
        actions={<Button>Sign In</Button>}
      />
      <Toolbar>
        <ColorPicker
          value="#000000"
          onChange={(color) => console.log(color)}
        />
      </Toolbar>
    </div>
  );
}
```

### Toast Notifications

```tsx
import { useToast, Toaster } from "@giga-pdf/ui";

function Component() {
  const { toast } = useToast();

  return (
    <>
      <Button
        onClick={() => {
          toast({
            title: "Success",
            description: "Your changes have been saved.",
          });
        }}
      >
        Show Toast
      </Button>
      <Toaster />
    </>
  );
}
```

## Development

```bash
# Build the package
npm run build

# Watch mode for development
npm run dev

# Lint
npm run lint
```

## Exports

All components are exported from the main entry point:

```tsx
import {
  // UI Components
  Button,
  Input,
  Dialog,
  Select,
  Tabs,
  Tooltip,
  // ... and more

  // Layout Components
  Header,
  Sidebar,
  Footer,

  // Editor Components
  Toolbar,
  ColorPicker,
  FontPicker,
  PageNavigator,
  ZoomControls,
  LayersPanel,

  // Utilities
  cn,
} from "@giga-pdf/ui";
```

## License

MIT
