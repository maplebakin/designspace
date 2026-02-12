# Design Space

## Ritualistic Zine-Maker Philosophy Meets Print-First Architecture

Design Space is a digital canvas that embraces the spirit of ritualistic zine-making while maintaining a robust, print-ready foundation. This tool honors the tactile, intentional process of zine creation—where each cut, paste, and mark carries meaning—while leveraging modern web technologies to ensure your creations transition seamlessly from screen to print.

### Philosophy

In the tradition of zine culture, Design Space champions:
- **DIY Aesthetics**: Embrace imperfection and handmade qualities
- **Intentional Process**: Every element placed has purpose and meaning
- **Accessibility**: Tools that empower creators regardless of technical background
- **Community Sharing**: Open, remixable templates and collaborative workflows

### Technical Architecture

Built with a print-first mindset using:

- **Fabric.js v6**: Powerful canvas manipulation with vector precision
- **Zustand**: Lightweight state management for responsive interactions
- **Apocapalette Tokens**: Consistent, accessible color system for print and screen

#### Key Features
- High-resolution canvas rendering (300 DPI ready)
- Grid-based layout system with customizable guides
- Advanced selection and grouping tools
- Export to multiple formats (PDF, PNG, SVG)
- Version history and collaboration features

### Getting Started

1. Clone the repository
2. Install dependencies: `npm install`
3. Start the development server: `npm run dev`
4. Open your browser to `http://localhost:5173`

### Development

This project follows a component-driven architecture with clear separation between:
- Editor components (`/src/editor/components`)
- Fabric.js integration (`/src/editor/fabric`)
- State management (`/src/editor/state`)
- Utility functions (`/src/editor/utils`)

### Contributing

We welcome contributions that align with the zine-maker philosophy. Please submit pull requests with clear explanations of how your changes enhance the creative process.

### License

MIT License - Free to use, modify, and distribute for personal and commercial projects.