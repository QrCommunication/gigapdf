# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-12-18

### Added

#### Core Features
- Initial release of @giga-pdf/logger package
- Logger class with full type safety (TypeScript strict mode)
- Five log levels: debug, info, warn, error, fatal
- Context management for request tracing (requestId, userId, documentId)
- Child logger support with context inheritance

#### Transports
- ConsoleTransport for browser console output
  - Pretty formatting for development
  - JSON formatting for production
  - Log level filtering
- RemoteTransport for backend API integration
  - Batch logging (configurable batch size and interval)
  - Automatic flushing on page unload
  - POST to /api/v1/logs endpoint
  - Custom headers support
  - Error-level filtering by default

#### Formatters
- JsonFormatter for structured JSON output
- PrettyFormatter for colorized console output with emojis
- Circular reference handling

#### Performance Tracking
- `startTimer()` - Manual performance timers
- `measureAsync()` - Async operation measurement
- `measure()` - Sync operation measurement
- Performance API integration

#### React Integration
- `useLogger` hook for component-level logging
- `usePerformanceTracking` hook for render tracking
- `useComponentLifecycle` hook for lifecycle events

#### Developer Experience
- Comprehensive README with examples
- Extensive examples file with 10 real-world scenarios
- Full TypeScript type definitions
- Browser-compatible (no Node.js dependencies)
- Error serialization with stack traces

#### Build System
- tsup for building CJS and ESM bundles
- Type declaration generation
- Clean build process
- Dev mode with watch

### Configuration

#### Environment Variables
- `NEXT_PUBLIC_LOG_LEVEL` - Minimum log level (default: "info" in production, "debug" in development)
- `NODE_ENV` - Used to determine environment defaults

#### Package Exports
- Main entry point with all exports
- Default logger factory (`createDefaultLogger`)
- Global logger instance for convenience

### Dependencies

#### Peer Dependencies
- react ^18.0.0 || ^19.0.0 (optional for hooks)

#### Dev Dependencies
- @giga-pdf/typescript-config - TypeScript configuration
- @types/react - React type definitions
- tsup - Build tool
- typescript - TypeScript compiler

[0.1.0]: https://github.com/yourusername/gigapdf/releases/tag/logger-v0.1.0
