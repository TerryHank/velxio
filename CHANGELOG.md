# Changelog

All notable changes to Velxio will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [3.0.0] - 2026-06-11

### Added
- Custom retro CPU chips (Z80, 8080, 4004, 4040, 8086) with programmable ROM, board-less operation, and in-editor assembly support
- MicroSD card emulation over SPI for AVR, RP2040, and ESP32 with FAT16 image and upload panel
- Library Manager with per-board manifests, content-addressed cache, version management, uninstall, and autocomplete
- ePaper display emulation for SSD168x (B/W, tri-colour), UC8159c (ACeP 7-colour), and UC8179 (mono) panels
- Undo/redo for canvas operations (components, wires, moves, rotations, property changes)
- PinResolver abstraction enabling SPICE-resolved digital inputs for mixed-mode simulation
- Full ngspice WASM migration: one solver path across browser and Node tests
- SignalRouter for ESP32 GPIO Matrix routing, replacing the per‑peripheral ad‑hoc cache
- Oscilloscope trigger modes (Auto / Normal / Single) with edge selection and position control
- RP2040 real-time performance: IdleSpinDetector elides busy‑wait loops, WFI sleeps are bounded
- ESP32‑CAM emulation with real webcam frame bridge via QEMU
- Multi‑board wire‑aware interconnect (UART, I2C, SPI, digital pins) across all supported boards
- GitHub Sync, Share/Embed modal, BOM CSV export, schematic PNG export (Pro features)
- Desktop app welcome page, grace/license gating, native menubar bridge, in‑app update toast
- i18n support for 9 locales (en, es, pt‑br, it, fr, zh‑cn, de, ja, ru) across the UI
- Extension hooks for private overlays: auth/DB split, session, save action, agent chat slot
- .vlx project export/import for stateless OSS self‑hosters
- Board options modal, per‑target compilation console with status grouping
- Live compile log streaming for ESP‑IDF (cmake/ninja output) and arduino‑cli
- Visual LED test harness (CDP‑driven) and netlist snapshot tests for all gallery examples
- Over 100 new gallery examples (Pico Doom, ESP32‑CAM preview, ePaper dashboards, retro CPU demos, 100 Days of IoT, analog circuits, etc.)

### Changed
- Library Manager redesigned: single unified tab with state‑aware row actions (Add to project, In project toggle, Uninstall/Remove)
- Compilation system: async job model with status polling, request dedup, concurrency semaphore, persistent ESP‑IDF build directory
- ESP‑IDF builds now use ccache with 8 GB cap, per‑variant persistent directories, and graceful fallback for incomplete manifests
- Server‑side library resolution scoped to content‑addressed cache; global volume retired
- ePaper rendering improved: native‑window compose, proper rotation, byte‑aware orientation, paged window union
- Canvas interactions enhanced: wires follow component rotation, minimap with draggable viewport, drag‑to‑move parts during simulation
- Bundle size reduced via manualChunks: main entry dropped from ~23 MB to ~2.68 MB; wokwi‑elements, PiTerminal, mcu‑emulators split
- Landing page refreshed with AI agent section, updated pricing tiers, licensing cards, and live editor hero screenshot
- Pricing copy updated to multiplier messaging (Pro = 20×, Pro Max = 50×)
- Desktop app hides marketing nav, redirects / → /editor, shows splash screen during boot
- CHANGELOG.md entries reflect all new features and changes for v3.0.0

### Fixed
- ESP32: WiFi/HTTP client link by enabling mbedTLS PSK; BLE stack switched to Bluedroid; LEDC duty routing for multi‑servo; flash image trimming (10× smaller JSON); sdkconfig defaults for cleaner serial output
- RP2040: delay()‑based sketches now run in real‑time on slow hosts; SPI0 routing fixed for Arduino init; UART TX waveform synthesized
- AVR: serial RX queue so `Serial.readStringUntil` sees full input; UART TX waveform at bit level; INPUT_PULLUP pin state; LED visualization through SPICE
- Multi‑board: initSimulator no longer wipes Interconnect’s UART wrapper; board removal reconciles `running` flag
- Canvas: wires follow component rotation; undo/redo state restored; component deletion cascades to wires; sensor panel opens on desktop click; wire color palette works
- i18n: index.html SEO fallback div removed after mount; missing locale keys for admin/user pages added
- Desktop: openExternal works via cascade of IPC paths; native menu routes navigate in‑window
- CI: Frontend Tests restored by patching RP2040 mocks and install‑libraries payload; backend e2e re‑enabled; worker heap limit bumped; cache storage growth limited
- Library: ArduinoJson and other src/‑layout libraries compile correctly by preserving directory structure
- ePaper: BUSY polarity per controller family; RAM Y‑counter wraps at window end; orientation correct across all boards
- Visual LED: RGB LED, 7‑segment, and PWM fade now correctly driven through SPICE‑resolved pins
- PinManager: updatePort respects DDR mask so INPUT_PULLUP does not falsely mark pin as output
- Many other bug fixes across compilation, simulation, UI, and platform compatibility

### Performance
- Bundle size reduced by 88% for main entry via manualChunks
- ESP‑IDF warm compiles drop from 5–7 min to 5–30 s with ccache + persistent build dir
- Compilation dedup prevents multiple ninja jobs from racing on the same sketch
- Spice/I2C waveform rendering speed improved by batching SPI bytes in the worker
- Minimap and canvas rendering optimised for mid‑range hardware

### Removed
- Legacy SpiceEngine (eecircuit‑engine) and CircuitScheduler replaced by ngspice WASM
- Dead auth/DB dependencies from OSS image (SQLAlchemy, JWT, etc.)
- Per‑board LEDC update fallback after SignalRouter rollout
- Unused files: `wireOffsetCalculator`, `wirePathGenerator`, `wireSegments`
- Global arduino‑libraries volume no longer needed for library resolution

## [2.0.1] - 2026-04-22

### Added
- Enhanced electrical simulation with ngspice-WASM engine for accurate analog circuit analysis
- Expanded component catalog with 44 SPICE-compatible parts including logic gates, transistors, op-amps, regulators, and electromechanical components
- Added 40 new circuit examples demonstrating analog, digital, and electromechanical concepts
- Introduced custom web components for electronic elements (relays, resistors, capacitors, inductors, transistors)
- Implemented ESP32 ADC waveform simulation with periodic 12-bit waveform look-up tables and interpolation
- Added voltmeter and ammeter instrument components for real-time circuit measurements
- Created comprehensive end-to-end tests for electrical simulation including capacitor charging, rectifier behavior, and waveform analysis
- Added GitHub Actions workflow for circuit simulation testing on every push and PR

### Changed
- Renamed all components to use 'velxio-' prefix for consistency
- Enabled electrical simulation by default (always-on SPICE mode) instead of requiring manual activation
- Enhanced LED brightness simulation to reflect actual current flow from SPICE calculations
- Updated backend to handle unhandled asyncio exceptions and prevent process crashes
- Improved component metadata generation to prevent CI drift and enforce up-to-date metadata
- Refactored property synchronization in simulation parts to use event-based system
- Expanded ADC pin mapping to support all 18 board types for full microcontroller integration

### Fixed
- Fixed sitemap generation to include all circuit examples for better SEO visibility
- Resolved floating input node issues in RC low-pass filter circuits that caused SPICE singular matrix errors
- Updated proxy configuration to use 127.0.0.1 for improved compatibility
- Fixed metadata regeneration to properly include custom components in the component picker
- Improved backend entrypoint script to ensure clean container restarts when processes die

## [2.0.1] - 2026-04-17

### Added
- Added ATtiny85 support with examples and simulation tests
- Added BMP280 sensor component with circuit preview and SVG representation
- Added example detail pages with improved SEO and sitemap generation
- Added MicroPython support for RP2040 (Pico), ESP32, ESP32-S3, and ESP32-C3 boards
- Added ability to upload precompiled firmware files (.hex, .bin, .elf) directly into the emulator
- Added ability to remove boards from workspace with confirmation dialog
- Added I2C sensor support with slave emulation for MPU6050, BMP280, DS1307, and DS3231 sensors
- Added ESP32 WiFi/BLE emulation with ESP-IDF compilation pipeline
- Added VS Code extension skeleton for local simulation
- Added comprehensive documentation for ESP32 GPIO sensor simulation, Docker infrastructure, and MicroPython implementation
- Added auto-compile feature that triggers compilation when pressing Play if code changed or no firmware loaded
- Added share functionality for projects and examples with visibility toggle
- Added component metadata overrides and enhanced property controls
- Added new CI/CD workflows for backend unit tests, end-to-end tests, and automated Discord release notifications
- Added Docker multi-architecture support (amd64 + arm64) and pre-built ESP-IDF toolchain image

### Changed
- Enhanced auto-compile to use board's file group for WiFi detection instead of legacy global files
- Updated CircuitPreview component and implemented ShareModal using createPortal
- Enhanced Arduino pin tracing in DynamicComponent and updated LittleFS WASM initialization
- Enhanced ESP-IDF compiler library resolution logic and added support for dynamic library detection
- Enhanced wire connection handling and GND checks for components
- Enhanced logging for library loading and WiFi progress
- Updated Docker build processes with optimized build contexts and multi-architecture support
- Changed WiFi SSID normalization to match QEMU access points for reliable ESP32 WiFi connection
- Refactored I2C slave tests for ESP32 with improved event handling and ACK/NACK responses

### Fixed
- Fixed container restart issue by monitoring both backend and nginx processes
- Fixed project saving to use active board files/kind and improved error messages
- Fixed ESP32 boot stability with deterministic instruction counting
- Fixed ESP32 Run button to auto-compile and recover firmware after page refresh
- Fixed LED ground check to require cathode wired to GND (or LOW GPIO) to light up
- Fixed MPU6050Slave I2C handling with improved WHO_AM_I read tracking
- Fixed ESP32 WiFi SSID/channel alignment with QEMU access_points array
- Fixed RISC-V toolchain paths for ESP32-C3 compilation
- Fixed ESP-IDF Python requirements installation in Docker
- Fixed SaveProjectModal to prevent saving to `/api/projects/none` when project ID is invalid
- Fixed ESP32 compilation by adding missing dependencies (cmake, ninja-build, git, packaging, libusb)

[2.0.1]: https://github.com/davidmonterocrespo24/velxio/releases/tag/v2.0.1

[3.0.0]: https://github.com/davidmonterocrespo24/velxio/releases/tag/v3.0.0