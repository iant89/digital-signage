===============================================================================
APPLICATION DESIGN SPECIFICATION
DIGITAL SIGNAGE STUDIO
===============================================================================

TECHNOLOGY:
  - React
  - TypeScript
  - HTML5 / CSS3
  - Canvas 2D / SVG
  - Web Animations API
  - Custom binary archive format (.signage)
  - Optional Electron or Tauri desktop host
  - Windows and Linux kiosk deployments

===============================================================================
1. APPLICATION OVERVIEW
===============================================================================

Digital Signage Studio is a browser-based digital signage authoring and
playback platform. It allows users to create visually rich signage
presentations, arrange media and animated elements on a canvas, package
complete signage projects into a compressed custom binary archive, and
play those packages in a dedicated full-screen kiosk environment.

The application must support:

  - Digital signage creation and editing.
  - Drag-and-drop visual design.
  - Images, videos, text, shapes, audio, and animations.
  - Multi-scene presentations and playlists.
  - Timeline-based animation editing.
  - Custom widgets and restricted scripts.
  - A custom compressed binary archive format.
  - Standalone package import and export.
  - Full-screen playback.
  - Operating-system kiosk integration.
  - Protected administrative access.
  - Offline playback.
  - Playback scheduling and automatic recovery.

PRIMARY OBJECTIVE:

A user must be able to create a signage project, export a single .signage
file, transfer it to another compatible device, and play it without
manually transferring individual assets.

The application consists of four primary subsystems:

  1. SIGNAGE DESIGNER
     - Visual editor and canvas.
     - Asset library.
     - Layer management.
     - Animation timeline.
     - Scene and playlist management.

  2. SIGNAGE PLAYER
     - Full-screen rendering.
     - Media playback.
     - Animation execution.
     - Scene sequencing.
     - Playlist scheduling.
     - Error recovery.

  3. PACKAGE BUILDER
     - Custom binary archive generation.
     - Asset collection.
     - Compression.
     - Manifest generation.
     - Integrity verification.
     - Package import and export.

  4. KIOSK AND DEVICE CONTROLS
     - Full-screen enforcement.
     - Startup launch.
     - Restricted user access.
     - Administrative authentication.
     - Watchdog recovery.
     - Device diagnostics.


===============================================================================
2. TECHNOLOGY STACK
===============================================================================

USER INTERFACE:
  - React
  - TypeScript
  - CSS3
  - Responsive component architecture

RENDERING:
  - DOM and CSS for text and standard UI elements.
  - Canvas 2D for suitable high-volume visual content.
  - SVG for vector graphics.
  - HTML5 Video API for video playback.
  - Web Animations API for supported animations.
  - Custom TypeScript timeline engine.

STATE MANAGEMENT:
  - Zustand or Redux Toolkit.
  - Immutable project state.
  - Undo/redo command history.
  - Autosave and crash recovery.

PERSISTENCE:
  - IndexedDB for browser-based project storage.
  - File System Access API where supported.
  - Standard file-picker fallback for other browsers.

BINARY PROCESSING:
  - Uint8Array.
  - DataView.
  - Web Workers.
  - CompressionStream where supported.
  - Compatible compression fallback.

DESKTOP HOST:
  - Electron or Tauri.
  - Native startup integration.
  - Full-screen window management.
  - Operating-system kiosk integration.

TESTING:
  - Vitest.
  - React Testing Library.
  - Playwright.
  - Archive fuzz testing.
  - Long-running playback tests.


===============================================================================
3. APPLICATION MODES
===============================================================================

3.1 STUDIO MODE

Provides the complete content creation environment.

Features:
  - Project management.
  - Visual design editor.
  - Asset library.
  - Text and shape tools.
  - Animation editor.
  - Timeline.
  - Scene management.
  - Playlist management.
  - Package export.
  - Preview and playback testing.

3.2 PLAYBACK MODE

Provides a dedicated signage playback experience.

Features:
  - Full-screen rendering.
  - Automatic scene sequencing.
  - Media playback.
  - Animation execution.
  - Playlist scheduling.
  - Offline operation.
  - Error recovery.
  - Performance monitoring.

3.3 DEVICE ADMINISTRATION

Provides authorized access to playback configuration.

Features:
  - Device configuration.
  - Display assignment.
  - Package selection.
  - Startup behavior.
  - Kiosk settings.
  - Maintenance access.
  - Playback diagnostics.
  - Recovery controls.

3.4 PACKAGE MANAGER

Provides archive management.

Features:
  - Import packages.
  - Export packages.
  - Validate archives.
  - Inspect package contents.
  - Verify integrity.
  - Compare package versions.
  - Display compression statistics.
  - Report compatibility issues.


===============================================================================
4. SIGNAGE DESIGNER
===============================================================================

The designer must provide a professional visual editing environment
similar to a combination of a presentation designer and a motion-graphics
editor.

4.1 EDITOR LAYOUT

TOP TOOLBAR:
  - Project name.
  - Save status.
  - Undo.
  - Redo.
  - Cut, copy, and paste.
  - Duplicate.
  - Zoom controls.
  - Preview.
  - Playback.
  - Export.
  - Application settings.

LEFT SIDEBAR:
  - Asset library.
  - Images.
  - Videos.
  - Audio.
  - Text.
  - Shapes.
  - Widgets.
  - Templates.
  - Components.
  - Layer hierarchy.

CENTER CANVAS:
  - Visual composition.
  - Drag-and-drop editing.
  - Selection handles.
  - Rotation handles.
  - Resize handles.
  - Alignment guides.
  - Grid and snapping.
  - Zoom and pan.
  - Safe-area overlays.
  - Aspect-ratio preview.

RIGHT INSPECTOR:
  - Position.
  - Size.
  - Rotation.
  - Opacity.
  - Colors.
  - Typography.
  - Borders.
  - Shadows.
  - Media properties.
  - Animation properties.
  - Element-specific settings.

BOTTOM TIMELINE:
  - Scene duration.
  - Animation tracks.
  - Keyframes.
  - Audio tracks.
  - Video tracks.
  - Scene transitions.
  - Timeline zoom.
  - Playback controls.
  - Scrubbing.

STATUS BAR:
  - Canvas resolution.
  - Frame rate.
  - Current selection.
  - Save status.
  - Package size estimate.
  - Project validation status.

4.2 CANVAS SYSTEM

Supported presets:

  - Full HD landscape: 1920 x 1080.
  - 4K UHD landscape: 3840 x 2160.
  - HD portrait: 1080 x 1920.
  - Square: 1080 x 1080.
  - Custom dimensions.

Required functionality:

  - Pixel-accurate positioning.
  - X/Y coordinates.
  - Width and height.
  - Rotation.
  - Scaling.
  - Aspect-ratio locking.
  - Alignment and distribution.
  - Grouping and nested groups.
  - Layer ordering.
  - Element locking.
  - Element visibility.
  - Copy and paste.
  - Multiple selection.
  - Snap-to-grid.
  - Snap-to-element.
  - Rulers and guides.
  - Responsive layout rules.
  - Portrait and landscape support.
  - Fit, fill, stretch, contain, and crop modes.
  - Preview at target display resolutions.

Use a logical coordinate system based on the project's reference resolution.
Scale the composition to the actual display without unintentionally
changing element proportions or typography.

4.3 SUPPORTED ELEMENTS

TEXT:
  - Rich-text formatting.
  - Font family.
  - Font size and weight.
  - Text color.
  - Gradients.
  - Alignment.
  - Letter spacing.
  - Line height.
  - Outlines and shadows.
  - Background fills.
  - Text wrapping.
  - Auto-fit.
  - Scrolling text.
  - Dynamic placeholders.
  - Unicode and RTL support.

IMAGES:
  - PNG.
  - JPEG.
  - WebP.
  - GIF.
  - SVG.
  - Cropping.
  - Scaling.
  - Opacity.
  - Masks.
  - Rotation.
  - Filters.
  - Shadows.

VIDEO:
  - MP4 where browser codecs permit.
  - WebM where browser codecs permit.
  - Playback range.
  - Looping.
  - Muting.
  - Volume.
  - Poster frames.
  - Aspect-ratio handling.
  - Playback speed where supported.
  - Scene synchronization.

AUDIO:
  - Background music.
  - Audio clips.
  - Volume control.
  - Fade-in and fade-out.
  - Muting.
  - Timeline synchronization.

SHAPES:
  - Rectangles.
  - Rounded rectangles.
  - Circles.
  - Ellipses.
  - Lines.
  - Polygons.
  - Borders.
  - Gradients.
  - Shadows.

WIDGETS:
  - Clock.
  - Date.
  - Countdown.
  - QR code.
  - Scrolling ticker.
  - Configured data feed.
  - Weather.
  - Custom widget.

GROUPS AND COMPONENTS:
  - Nested groups.
  - Reusable components.
  - Shared styles.
  - Parameterized components.
  - Master layouts.
  - Component-specific properties.

SCRIPTED ELEMENTS:
  - Restricted custom behavior.
  - Event handlers.
  - Timed updates.
  - Animation triggers.
  - Dynamic text.
  - Authorized scene transitions.

4.4 MEDIA LIBRARY

Required features:

  - Drag-and-drop importing.
  - Batch importing.
  - Thumbnail generation.
  - Video poster generation.
  - File metadata.
  - Dimensions and duration.
  - Codec information.
  - File-size reporting.
  - Search and filtering.
  - Tags and folders.
  - Duplicate detection using content hashes.
  - Missing-asset detection.
  - Asset relinking.
  - Unused-asset detection.
  - Optional media transcoding.
  - Package size estimates.

Store original assets separately from optional optimized derivatives.
The package builder determines which versions are included in the export.


===============================================================================
5. ANIMATION AND TIMELINE ENGINE
===============================================================================

5.1 ANIMATABLE PROPERTIES

Support animation of:

  - X and Y position.
  - Width and height.
  - Scale.
  - Rotation.
  - Opacity.
  - Colors where supported.
  - Background properties.
  - Text reveal.
  - Masks and clipping.
  - Crop properties.
  - Audio volume.
  - Custom component properties.

5.2 BUILT-IN ANIMATIONS

  - Fade in/out.
  - Slide from any direction.
  - Zoom in/out.
  - Pan and drift.
  - Bounce.
  - Rotate.
  - Flip.
  - Typewriter text.
  - Scrolling ticker.
  - Wipe.
  - Reveal.
  - Staggered entrance.
  - Ken Burns effect.
  - Crossfade transitions.

Allow users to save custom animations as reusable presets.

5.3 KEYFRAME SYSTEM

Each animation track supports:

  - Keyframe position.
  - Keyframe value.
  - Interpolation mode.
  - Easing function.
  - Duration.
  - Delay.
  - Repeat count.
  - Reverse playback.
  - Fill behavior.

5.4 TIMELINE

Required features:

  - Time-based and frame-based editing.
  - Configurable frame rate.
  - 30 FPS default authoring target.
  - Play, pause, stop, and seek.
  - Scrubbing.
  - Timeline zoom.
  - Horizontal scrolling.
  - Track locking.
  - Track visibility.
  - Track muting.
  - Snap-to-keyframe.
  - Loop regions.
  - Audio waveform visualization.
  - Multi-track animation.
  - Keyframe copy and paste.

The production player must use the same animation semantics as the editor
preview, while accounting for actual device performance and browser timing.


===============================================================================
6. PROJECT MODEL
===============================================================================

A project is the editable source of a signage presentation.

PROJECT HIERARCHY:

  Project
    |
    +-- Project Settings
    |
    +-- Theme
    |
    +-- Asset Registry
    |
    +-- Scene Collection
    |     |
    |     +-- Scene: Welcome
    |     |     +-- Background
    |     |     +-- Heading
    |     |     +-- Video
    |     |     +-- Logo
    |     |     +-- Animation Tracks
    |     |
    |     +-- Scene: Promotion
    |           +-- Background
    |           +-- Promotional Image
    |           +-- Price
    |           +-- Transition
    |
    +-- Playlist Definitions
    |
    +-- Playback Schedules
    |
    +-- Script Modules
    |
    +-- Script Permissions

6.1 SCENE CONFIGURATION

Each scene defines:

  - Unique ID.
  - Scene name.
  - Reference resolution.
  - Responsive layout rules.
  - Duration.
  - Layer collection.
  - Element ordering.
  - Animation timelines.
  - Entry transition.
  - Exit transition.
  - Background audio.
  - Script modules.
  - Script permissions.
  - Completion behavior.
  - Failure behavior.

6.2 PROJECT PERSISTENCE

Implement:

  - Automatic saving.
  - IndexedDB persistence.
  - Incremental changes.
  - Periodic recovery snapshots.
  - Undo/redo history.
  - Crash recovery.
  - Save-status indicator.
  - Project import/export.
  - Schema versioning.
  - Schema migrations.
  - Asset integrity checks.


===============================================================================
7. CUSTOM BINARY ARCHIVE FORMAT
===============================================================================

7.1 FORMAT IDENTITY

Default extension:
  .signage

Proposed MIME type:
  application/vnd.digital-signage.package

Magic signature:
  SIGNAGE\0

The format must be versioned and documented.

The archive must contain everything required for playback, including:

  - Project manifest.
  - Scene definitions.
  - Element definitions.
  - Images.
  - Videos.
  - Audio.
  - Fonts.
  - Animation data.
  - Scripts.
  - Component definitions.
  - Theme resources.
  - Required dependencies.
  - Entry directory.
  - Integrity information.

The player must not require the original project folder.

7.2 CONTAINER ARCHITECTURE

  +------------------------------------------+
  | SIGNAGE HEADER                           |
  | Magic Signature                          |
  | Format Version                           |
  | Flags                                    |
  | Directory Location                       |
  +------------------------------------------+
  | PROJECT MANIFEST                         |
  | Project Metadata                         |
  | Scene Graph                              |
  | Asset Registry                           |
  | Playlist Definitions                     |
  | Script Permissions                       |
  +------------------------------------------+
  | COMPRESSED ENTRY DATA                    |
  |                                          |
  | Images                                   |
  | Videos                                   |
  | Audio                                    |
  | Fonts                                    |
  | Scripts                                  |
  | Animation Data                           |
  | Themes and Components                    |
  +------------------------------------------+
  | ENTRY DIRECTORY                          |
  | Entry IDs                                |
  | Entry Types                              |
  | Data Offsets                             |
  | Stored Lengths                           |
  | Original Lengths                         |
  | Compression Methods                      |
  | Content Hashes                           |
  +------------------------------------------+

The directory must be readable without decompressing every entry.

Entries must be independently compressed to support:

  - Random access.
  - Lazy loading.
  - Partial reads.
  - Independent integrity verification.
  - Reduced startup time.
  - Bounded memory usage.

7.3 PROPOSED 64-BYTE HEADER

  Offset  Size  Field
  ------  ----  ---------------------------------
  0       8     Magic signature
  8       2     Format version
  10      2     Header size
  12      4     Feature flags
  16      8     Directory offset
  24      8     Directory length
  32      4     Manifest entry ID
  36      4     Entry count
  40      24    Reserved; initially zero
  ------  ----  ---------------------------------
  Total   64    Bytes

All multibyte numeric fields use little-endian encoding.

Use 64-bit offsets and lengths, with configurable application-level size
limits and overflow-safe bounds checking.

7.4 DIRECTORY ENTRY FIELDS

Each directory entry should contain:

  - Entry ID.
  - Entry type.
  - Logical asset path or manifest reference.
  - Data offset.
  - Stored length.
  - Uncompressed length.
  - Compression method.
  - Compression parameters.
  - Content hash.
  - MIME type or media subtype.
  - Optional flags.

Define the exact binary encoding and alignment rules in the format
specification before implementation.

7.5 COMPRESSION STRATEGY

JSON AND METADATA:
  - Deflate or Brotli.

TEXT SCRIPTS:
  - Deflate or Brotli.

PNG, JPEG, WEBP:
  - Store unchanged by default.

MP4 AND WEBM:
  - Store unchanged by default.

WOFF2 FONTS:
  - Store unchanged.

UNCOMPRESSED AUDIO:
  - Optional compression.

OTHER BINARY DATA:
  - Select compression based on measured benefit.

Provide two export profiles:

FAST EXPORT:
  - Prioritize export speed.
  - Minimize unnecessary compression work.

COMPACT EXPORT:
  - Optimize compressible entries.
  - Report progress and estimated savings.

Do not recompress already-compressed media without a demonstrated benefit.

7.6 MANIFEST

Use a versioned, schema-validated manifest.

Conceptual example:

{
  "format": "SIGNAGE",
  "manifestVersion": 1,
  "project": {
    "id": "project-001",
    "name": "Lobby Display",
    "width": 1920,
    "height": 1080,
    "frameRate": 30
  },
  "entrySceneId": "scene-welcome",
  "scenes": [],
  "assets": [],
  "playlists": [],
  "schedules": [],
  "scripts": [],
  "permissions": []
}

The arrays must contain validated project data.

Never automatically evaluate arbitrary executable configuration during
package import or validation.

7.7 INTEGRITY AND VALIDATION

The package manager must:

  1. Validate the magic signature.
  2. Validate the format version.
  3. Validate header bounds.
  4. Validate directory offsets and lengths.
  5. Reject overlapping or out-of-range entries.
  6. Enforce entry-count limits.
  7. Enforce decompressed-size limits.
  8. Verify entry hashes when entries are read.
  9. Validate the manifest schema.
  10. Verify asset and script references.
  11. Report unsupported features.
  12. Reject malformed packages safely.

Use SHA-256 for content integrity.

Use digital signatures when publisher authenticity is required. Hashes
alone do not establish publisher identity.

Protect against:

  - Decompression bombs.
  - Malformed directory records.
  - Integer overflow.
  - Path traversal.
  - Excessive allocation.
  - Corrupted media.
  - Malicious scripts.

Never execute scripts during archive validation.

7.8 ENCRYPTION

Optional package encryption may be added for confidentiality.

Requirements:

  - Use established cryptographic libraries.
  - Never store encryption keys in the archive.
  - Define key management separately.
  - Authenticate encrypted content.
  - Do not confuse encryption with script security.
  - Do not use custom cryptographic algorithms.


===============================================================================
8. SIGNAGE PLAYBACK ENGINE
===============================================================================

The playback engine must be independent of the editor UI.

Its responsibilities include:

  - Loading packages.
  - Validating manifests.
  - Preparing assets.
  - Initializing scenes.
  - Rendering elements.
  - Executing animations.
  - Synchronizing media.
  - Scheduling transitions.
  - Managing playlists.
  - Recovering from errors.

8.1 PLAYBACK LIFECYCLE

  1. Load package.
  2. Read header and directory.
  3. Validate package structure.
  4. Validate manifest and permissions.
  5. Prepare required assets.
  6. Initialize scene graph.
  7. Initialize clocks and animation tracks.
  8. Start playback.
  9. Monitor runtime health.
  10. Recover from supported errors.

8.2 RENDERING STRATEGY

Use a hybrid renderer:

  DOM/CSS:
    - Text.
    - Standard layout.
    - Interactive widgets.

  Canvas 2D:
    - Suitable high-volume visual elements.
    - Selected visual effects.

  SVG:
    - Vector graphics.
    - Scalable shapes.

  Native video elements:
    - Hardware-assisted video decoding where supported.

  Web Animations API:
    - Suitable element-level animations.

  Custom timeline scheduler:
    - Scene timing.
    - Animation coordination.
    - Audio synchronization.
    - Timed events.

Do not force every visual element through Canvas.

8.3 PLAYBACK REQUIREMENTS

  - Full-screen playback.
  - Landscape and portrait layouts.
  - Automatic scene sequencing.
  - Configurable transitions.
  - Multiple media elements.
  - Audio control.
  - Preloading of upcoming scenes.
  - Lazy loading.
  - Offline playback.
  - Looping playlists.
  - Indefinite-duration scenes.
  - Schedule-aware playback.
  - Codec failure handling.
  - Memory-aware caching.
  - Media resource disposal.
  - Recovery after media errors.
  - Frame-rate and dropped-frame estimates.

8.4 INITIAL PERFORMANCE TARGETS

  Animation:
    - 30 FPS target.
    - 60 FPS where appropriate and supported.

  Startup:
    - Begin playback when the manifest and essential first-scene
      assets are ready.

  Memory:
    - Keep media caching bounded.

  Reliability:
    - Complete at least 72 hours of unattended soak testing.

  Recovery:
    - Return to a valid scene after recoverable errors.

  Offline:
    - All packaged content remains available without a network.

Validate these targets on reference hardware, including 4K displays and
systems with limited memory or video decoding capabilities.


===============================================================================
9. PLAYLISTS AND SCHEDULING
===============================================================================

PLAYLIST FEATURES:

  - Ordered scenes.
  - References to external signage packages.
  - Scene duration overrides.
  - Loop mode.
  - Shuffle mode.
  - Transition selection.
  - Priority announcements.
  - Scheduled content groups.
  - Default fallback playlist.
  - Failure behavior.
  - Optional playback logs.

SCHEDULING FEATURES:

  - Start date.
  - End date.
  - Time of day.
  - Days of the week.
  - Date-specific overrides.
  - Priority.
  - Device assignment.
  - Time zone.
  - Recurrence.
  - Expiration.

When schedules overlap, use documented priority rules and deterministic
tie-breaking.

If scheduling data is invalid or unavailable, use a configured fallback
playlist.


===============================================================================
10. FULL-SCREEN AND KIOSK LOCKOUT
===============================================================================

IMPORTANT:

A browser webpage cannot reliably prevent users from accessing browser
settings, switching applications, closing the browser, or using operating
system controls.

Reliable kiosk behavior requires a desktop host or managed browser
combined with operating-system restrictions.

10.1 RECOMMENDED DEPLOYMENT

  +------------------------------------------+
  | PHYSICAL DISPLAY                         |
  | Television / Monitor / Kiosk Screen      |
  +------------------------------------------+
                     |
                     v
  +------------------------------------------+
  | OPERATING SYSTEM KIOSK CONTROLS          |
  | Restricted Account                       |
  | Startup Launch                            |
  | Application Restrictions                 |
  +------------------------------------------+
                     |
                     v
  +------------------------------------------+
  | DEDICATED PLAYBACK HOST                  |
  | Managed Browser or Desktop Wrapper       |
  | Full-Screen Management                   |
  | Watchdog and Recovery                   |
  +------------------------------------------+
                     |
                     v
  +------------------------------------------+
  | TYPESCRIPT PLAYBACK ENGINE               |
  | Package Loader                           |
  | Renderer                                 |
  | Timeline                                 |
  | Playlist Controller                      |
  +------------------------------------------+

10.2 DEPLOYMENT OPTIONS

ORDINARY BROWSER:
  Advantages:
    - Simple deployment.
    - No desktop installation.

  Disadvantages:
    - Cannot reliably enforce OS-level lockout.
    - Limited control over startup and window management.

MANAGED BROWSER KIOSK:
  Advantages:
    - Suitable for managed devices.
    - Browser-level kiosk policies.

  Disadvantages:
    - Requires platform-specific configuration.
    - Depends on device management.

ELECTRON:
  Advantages:
    - Broad ecosystem.
    - Native integration.
    - Local file access.
    - Window management.
    - Startup integration.

  Disadvantages:
    - Larger installation.
    - Requires desktop runtime maintenance.

TAURI:
  Advantages:
    - Smaller native shell.
    - OS integration.
    - Web-based application UI.

  Disadvantages:
    - More native integration work.
    - Platform-specific implementation.

RECOMMENDATION:

Build the application as a React/TypeScript web application and provide
a dedicated desktop playback host for Windows and Linux.

Use Electron for the simplest implementation path or Tauri when minimizing
the native application footprint is a higher priority.

10.3 FULL-SCREEN CONTROLS

Provide configurable options for:

  - Launch in full-screen mode.
  - Start playback automatically.
  - Launch assigned package on startup.
  - Hide application chrome.
  - Hide navigation.
  - Disable the context menu in the playback window.
  - Restrict developer tools in production.
  - Hide cursor after inactivity.
  - Keep display awake where supported.
  - Configure orientation through OS integration.
  - Configure supported display resolution.
  - Restore playback after restart.
  - Select default package.
  - Select default playlist.
  - Enable or disable maintenance access.

Browser full-screen recovery is best-effort. OS policies and native host
controls enforce restrictions outside the webpage.

10.4 ADMINISTRATIVE ACCESS

Implement:

  - Protected administrator authentication.
  - Device-bound administrative authorization where appropriate.
  - Configurable maintenance hotkey or hidden multi-step gesture.
  - Time-limited maintenance sessions.
  - Automatic return to playback after maintenance.
  - Audit logging.
  - Emergency recovery procedure.
  - Authorized kiosk exit procedure.

Do not rely solely on hiding settings controls.

Do not use hardcoded PINs or universal secret passwords.

Run the player under a restricted operating-system account. The renderer
must not have unnecessary administrative privileges.

10.5 WATCHDOG AND RECOVERY

The playback host must:

  1. Detect crashes or an unresponsive renderer.
  2. Restart the playback process with bounded retries.
  3. Reopen the last known valid package.
  4. Restore the active playlist or fallback playlist.
  5. Record diagnostic information.
  6. Enter a safe recovery screen if repeated restarts fail.

Prevent corrupted packages from creating infinite restart loops.


===============================================================================
11. SCRIPT AND CUSTOM BEHAVIOR SYSTEM
===============================================================================

11.1 SCRIPT CAPABILITIES

Support restricted scripts for:

  - Scene initialization.
  - Scene cleanup.
  - Timed events.
  - Scene transitions.
  - Text updates.
  - Visibility control.
  - Animation control.
  - Authorized playlist selection.
  - Interactive displays.
  - Clock widgets.
  - Countdown widgets.
  - Configured data feeds.
  - Custom widget behavior.
  - Diagnostic logging.

11.2 SANDBOX SECURITY

Use a restricted runtime with explicit APIs.

Do not execute package scripts through unrestricted eval() or
new Function().

Requirements:

  - Isolated execution context where supported.
  - Explicit API permissions.
  - No arbitrary filesystem access.
  - No process creation.
  - No operating-system command execution.
  - Controlled network access.
  - CPU and instruction limits.
  - Memory limits.
  - Event-rate limits.
  - Runtime error containment.
  - Script permission declarations.
  - Permission review during import.
  - Runtime validation of messages.

A worker alone is not a complete security boundary.

Enforce permissions at the host boundary and validate every message
received from a script.

11.3 SCRIPT API

Provide a signage-specific API for:

  - Scene access.
  - Element access.
  - Text changes.
  - Visibility changes.
  - Animation requests.
  - Scene transition requests.
  - Timers.
  - Authorized events.
  - Logging.

Use serializable messages for cross-worker communication.

11.4 SCRIPT LIFECYCLE

  initialize:
    - Establish script state.
    - Register permitted handlers.

  onSceneEnter:
    - Initialize scene-specific behavior.

  onTick:
    - Perform bounded periodic updates.

  onEvent:
    - Respond to authorized events.

  onSceneExit:
    - Release scene resources.

  dispose:
    - Cancel timers.
    - Remove handlers.
    - Release references.

Ensure that scene changes do not accumulate timers, event listeners,
or media references.


===============================================================================
12. DEVICE ADMINISTRATION AND DIAGNOSTICS
===============================================================================

DEVICE OVERVIEW:

  - Device name.
  - Assigned display.
  - Operating system.
  - Player version.
  - Current package.
  - Current scene.
  - Playback state.
  - Last successful startup.
  - Package integrity status.
  - Memory and storage information where supported.
  - Estimated frame rate.
  - Media errors.
  - Last heartbeat.
  - Active schedule.
  - Pending maintenance actions.

PLAYBACK STATES:

  - Running.
  - Paused.
  - Loading.
  - Recovering.
  - Offline.
  - Maintenance.
  - Error.

LOCAL DIAGNOSTICS:

  - Application version.
  - Runtime version.
  - Package validation results.
  - Media decoding failures.
  - Script exceptions.
  - Playback interruptions.
  - Restart history.
  - Cache status.
  - Kiosk configuration status.
  - Recent administrative changes.

Avoid logging private content, credentials, or sensitive feed data.

OPTIONAL REMOTE MANAGEMENT:

  - Assign packages to devices.
  - Upload package updates.
  - Schedule deployments.
  - Track device health.
  - Request diagnostic reports.
  - Roll back packages.
  - Manage device groups.

Remote commands must be authenticated, authorized, auditable, and
protected against replay. Never expose unrestricted command execution
through the management interface.


===============================================================================
13. PACKAGE MANAGER
===============================================================================

13.1 EXPORT WORKFLOW

  1. Choose export scope.
     - Entire project.
     - Selected scenes.
     - Prepared playlist.

  2. Run preflight checks.
     - Missing assets.
     - Unsupported codecs.
     - Invalid scripts.
     - Missing fonts.
     - Unresolved dependencies.

  3. Select export profile.
     - Fast export.
     - Compact export.
     - Optional digital signature.

  4. Build archive.
     - Generate manifest.
     - Collect assets.
     - Compress eligible entries.
     - Build directory.
     - Calculate hashes.

  5. Validate output.
     - Reopen archive.
     - Verify directory.
     - Validate manifest.
     - Verify required entries.

  6. Save package.
     - Export one .signage file.
     - Display package size.
     - Display version.
     - Display validation status.

13.2 IMPORT WORKFLOW

  1. Select a .signage file.
  2. Validate the header.
  3. Validate archive structure.
  4. Inspect manifest.
  5. Inspect requested script permissions.
  6. Verify required entries and assets.
  7. Display warnings.
  8. Import into the editor or playback environment.
  9. Apply supported schema migrations where necessary.
  10. Preserve the original package unchanged.

13.3 PACKAGE COMPARISON

Compare package versions by:

  - Added assets.
  - Removed assets.
  - Modified assets.
  - Scene changes.
  - Animation changes.
  - Script changes.
  - Permission changes.
  - Package size changes.
  - Format compatibility.
  - Publisher signature status.


===============================================================================
14. USER EXPERIENCE AND VISUAL DESIGN
===============================================================================

STUDIO THEME:

  - Dark theme by default.
  - Optional light theme.
  - Neutral editor chrome.
  - Canvas-focused workspace.
  - Consistent icons.
  - Contextual inspectors.
  - Resizable panels.
  - Keyboard shortcuts.
  - Clear selection states.
  - Nonintrusive notifications.
  - Accessible contrast.
  - Visible focus indicators.

RESPONSIVE LAYOUT:

DESKTOP:
  - Full editor.
  - Canvas.
  - Asset browser.
  - Inspector.
  - Timeline.

TABLET:
  - Canvas-first interface.
  - Collapsible panels.
  - Touch-friendly controls.

MOBILE:
  - Project management.
  - Asset importing.
  - Basic text editing.
  - Simplified layout editing.
  - Preview.

DEDICATED DISPLAY:
  - Full-screen playback.
  - No editor chrome.
  - No public settings controls.

ACCESSIBILITY:

  - Keyboard navigation.
  - Screen-reader labels.
  - High-contrast options.
  - Reduced-motion support.
  - Visible focus.
  - Accessible errors.
  - Alternative text for media where applicable.

Use pointer events to support mouse, touch, and stylus. Maintain
comfortable touch targets and prevent unwanted mobile input zoom.


===============================================================================
15. APPLICATION ARCHITECTURE
===============================================================================

Suggested project structure:

digital-signage-studio/
|
+-- apps/
|   +-- studio/
|   |   +-- React authoring application
|   |
|   +-- player/
|   |   +-- Playback application
|   |
|   +-- desktop-host/
|       +-- Electron or Tauri integration
|
+-- packages/
|   +-- project-model/
|   |   +-- Project schemas
|   |   +-- Scene schemas
|   |   +-- Element schemas
|   |
|   +-- editor-core/
|   |   +-- Selection
|   |   +-- Transforms
|   |   +-- Commands
|   |
|   +-- editor-ui/
|   |   +-- Canvas
|   |   +-- Panels
|   |   +-- Timeline
|   |   +-- Inspector
|   |
|   +-- media-library/
|   |   +-- Asset import
|   |   +-- Metadata
|   |   +-- Thumbnails
|   |
|   +-- animation-engine/
|   |   +-- Timelines
|   |   +-- Interpolation
|   |   +-- Transitions
|   |
|   +-- playback-engine/
|   |   +-- Scene graph
|   |   +-- Rendering
|   |   +-- Playback orchestration
|   |
|   +-- signage-format/
|   |   +-- Binary reader
|   |   +-- Binary writer
|   |   +-- Directory
|   |   +-- Validation
|   |
|   +-- compression/
|   |   +-- Compression
|   |   +-- Decompression
|   |
|   +-- script-runtime/
|   |   +-- Sandboxed execution
|   |   +-- Script API
|   |
|   +-- playlist-engine/
|   |   +-- Playlist management
|   |   +-- Scheduling
|   |
|   +-- kiosk-integration/
|   |   +-- Full-screen handling
|   |   +-- Host integration
|   |
|   +-- diagnostics/
|   |   +-- Logging
|   |   +-- Recovery
|   |
|   +-- shared/
|       +-- Shared types
|       +-- Utilities
|
+-- tests/
|   +-- unit/
|   +-- integration/
|   +-- browser/
|   +-- archive-fuzz/
|   +-- playback-soak/
|
+-- docs/
|   +-- architecture.md
|   +-- signage-file-format.md
|   +-- script-api.md
|   +-- kiosk-deployment.md
|   +-- security-model.md
|
+-- README.md

ARCHITECTURAL RULES:

  1. The project model must not depend on React.
  2. The playback engine must not depend on editor components.
  3. The archive implementation must not depend on the UI.
  4. Scripts must use a restricted runtime API.
  5. The desktop host must enforce OS-level restrictions.
  6. Preview and production playback must share rendering semantics.
  7. Packages must remain portable across compatible versions.
  8. Untrusted inputs must be validated at runtime.

This is a logical architecture. Start with a small workspace and split
modules into separate packages as interfaces stabilize.


===============================================================================
16. IMPLEMENTATION ROADMAP
===============================================================================

PHASE 1: CORE PROJECT MODEL AND EDITOR

  - Define project schemas.
  - Implement scene management.
  - Implement canvas.
  - Implement element selection and transforms.
  - Implement layers.
  - Implement property inspector.
  - Implement undo/redo.
  - Implement project persistence.

DELIVERABLE:
  Create and save a simple signage composition.

PHASE 2: MEDIA AND TYPOGRAPHY

  - Implement image importing.
  - Implement video importing.
  - Implement text editing.
  - Implement shapes.
  - Implement font handling.
  - Implement media metadata.
  - Implement previews.
  - Implement missing-asset detection.

DELIVERABLE:
  Compose a complete static and video-based sign.

PHASE 3: ANIMATION AND TIMELINE

  - Implement animation clock.
  - Implement keyframes.
  - Implement interpolation.
  - Implement easing.
  - Implement transitions.
  - Implement audio tracks.
  - Implement timeline editing.

DELIVERABLE:
  Animated multi-scene signage with synchronized media.

PHASE 4: BINARY PACKAGE FORMAT

  - Implement binary header.
  - Implement manifest.
  - Implement entry directory.
  - Implement compression.
  - Implement content hashing.
  - Implement validation.
  - Implement export.
  - Implement import.

DELIVERABLE:
  One portable .signage file containing all required content.

PHASE 5: PRODUCTION PLAYBACK ENGINE

  - Implement package loading.
  - Implement media preparation.
  - Implement scene sequencing.
  - Implement playlists.
  - Implement scheduling.
  - Implement offline operation.
  - Implement error recovery.

DELIVERABLE:
  Play an exported package independently of the editor.

PHASE 6: KIOSK DEPLOYMENT AND SECURITY

  - Integrate desktop host.
  - Implement startup launch.
  - Configure restricted accounts.
  - Implement maintenance access.
  - Implement watchdog recovery.
  - Implement script sandbox.
  - Implement diagnostics.

DELIVERABLE:
  An unattended, restricted signage player for Windows and Linux.

PHASE 7: HARDENING AND RELEASE

  - Implement archive fuzz testing.
  - Conduct long-running playback tests.
  - Profile rendering performance.
  - Test accessibility.
  - Validate package migrations.
  - Test recovery scenarios.
  - Create installation documentation.

DELIVERABLE:
  A tested release suitable for real-world signage deployment.


===============================================================================
17. TESTING AND QUALITY ASSURANCE
===============================================================================

PROJECT MODEL:
  - Schema validation.
  - Migration testing.
  - Reference validation.
  - Serialization and deserialization.

EDITOR:
  - Selection.
  - Transforms.
  - Layer operations.
  - Undo/redo.
  - Keyboard shortcuts.

MEDIA:
  - Import failures.
  - Unsupported codecs.
  - Large files.
  - Corrupted assets.

ANIMATION:
  - Timing.
  - Interpolation.
  - Looping.
  - Scene transitions.
  - Audio synchronization.

BINARY FORMAT:
  - Round-trip tests.
  - Header validation.
  - Offset validation.
  - Compression.
  - Integrity verification.
  - Compatibility testing.

ARCHIVE SECURITY:
  - Malformed headers.
  - Oversized entries.
  - Decompression bombs.
  - Invalid paths.
  - Integer overflow.

SCRIPT SECURITY:
  - Unauthorized APIs.
  - Resource exhaustion.
  - Invalid messages.
  - Runtime isolation.

PLAYBACK:
  - Long-running operation.
  - Missing media.
  - Scene recovery.
  - Memory stability.
  - Offline playback.

KIOSK:
  - Startup.
  - Full-screen behavior.
  - Unauthorized access.
  - Watchdog recovery.

RESPONSIVE UI:
  - Desktop.
  - Tablet.
  - Mobile.

PERFORMANCE:
  - Full HD.
  - 4K.
  - Multiple video streams.
  - Complex animations.

ACCESSIBILITY:
  - Keyboard navigation.
  - Contrast.
  - Focus management.
  - Reduced motion.

17.1 ESSENTIAL END-TO-END TEST

  1. Create a project at 1920 x 1080.
  2. Add an image, video, text, and logo.
  3. Animate the text and logo.
  4. Create two scenes.
  5. Configure their transition.
  6. Export a .signage package.
  7. Close the editor.
  8. Load the package into the production player.
  9. Verify media playback.
  10. Verify animation timing.
  11. Verify scene transitions.
  12. Disconnect the network.
  13. Verify continued offline playback.
  14. Restart the player.
  15. Verify recovery.
  16. Reimport the package into the editor.
  17. Verify project content.
  18. Corrupt a copy of the package.
  19. Verify that the player rejects the corrupted package safely.


===============================================================================
18. ACCEPTANCE CRITERIA
===============================================================================

[ ] Users can create and edit projects without manually editing JSON.

[ ] Images, videos, text, shapes, audio, and animations are supported.

[ ] The editor includes a canvas, layers, inspector, and timeline.

[ ] Projects support multiple scenes, playlists, and transitions.

[ ] Projects can be saved and recovered after a crash.

[ ] All required assets and scripts can be bundled into one .signage file.

[ ] The archive uses a documented, versioned binary format.

[ ] The package builder supports compression and integrity verification.

[ ] The package directory supports independent entry access.

[ ] The player loads packages independently of the editor.

[ ] Packaged content plays offline.

[ ] The player recovers from common media and application failures.

[ ] Custom scripts run through a restricted runtime.

[ ] Full-screen playback is supported.

[ ] OS-level kiosk restrictions are supported through the deployment host.

[ ] Administrative maintenance access is protected.

[ ] Malformed and unsupported packages are handled safely.

[ ] Automated unit, integration, and end-to-end tests are available.


===============================================================================
19. KEY DESIGN DECISIONS
===============================================================================

DECISION 1: CUSTOM BINARY ARCHIVE

Use a directory-based binary container with independently compressed
entries rather than a monolithic binary stream.

REASONS:
  - Random-access asset loading.
  - Portable single-file distribution.
  - Integrity verification.
  - Efficient lazy loading.
  - Better memory management.
  - Forward-compatible format evolution.

DECISION 2: SEPARATE PLAYBACK ENGINE

Keep playback independent of the editor while sharing the project model,
renderer, and animation semantics.

REASONS:
  - Better reliability.
  - Reduced unnecessary UI overhead.
  - Independent deployment.
  - Easier testing.
  - Consistent preview and production behavior.

DECISION 3: NATIVE KIOSK HOST

Use a desktop host and operating-system restrictions for production
displays that must operate unattended.

REASONS:
  - Browser-only lockout is unreliable.
  - Better startup control.
  - Better process recovery.
  - Stronger administrative separation.
  - More predictable deployment.

DECISION 4: RESTRICTED SCRIPT RUNTIME

Do not execute package scripts with unrestricted application privileges.

REASONS:
  - Packages may originate from untrusted sources.
  - Scripts must not access arbitrary files or execute commands.
  - Runtime limits protect long-running playback.
  - Explicit permissions improve security and auditability.

DECISION 5: FORMAT SPECIFICATION FIRST

Document the .signage format before implementing the complete editor.

DOCUMENT:
  - Header layout.
  - Directory records.
  - Compression methods.
  - Manifest schema.
  - Asset references.
  - Integrity rules.
  - Version compatibility.
  - Security constraints.

REASONS:
  - Easier compatibility testing.
  - Independent player implementations.
  - Safer format evolution.
  - More reliable package validation.


===============================================================================
FINAL OBJECTIVE
===============================================================================

Build a complete digital signage production system consisting of:

  1. A React and TypeScript visual design studio.
  2. A professional media and animation editor.
  3. A custom compressed binary archive format.
  4. A standalone signage playback engine.
  5. A playlist and scheduling system.
  6. A restricted script runtime.
  7. A full-screen kiosk deployment host.
  8. Protected administrative controls.
  9. Playback diagnostics and automatic recovery.
 10. A comprehensive testing and compatibility framework.

The final application must allow users to design a presentation, package
all required resources into one .signage file, transfer that file to a
compatible device, and play it in a secure, full-screen environment
without requiring the original editor or an active network connection.

The architecture must prioritize portability, playback reliability,
performance, security, maintainability, and future extensibility.
===============================================================================


===============================================================================
APPLICATION DESIGN SPECIFICATION ADDENDUM
NETWORK SERVER AND SYNCHRONIZED SIGNAGE PLAYERS
===============================================================================

PURPOSE
===============================================================================

Extend Digital Signage Studio with a centralized network server capable of
managing multiple signage players, distributing packages, coordinating
playback, synchronizing multiple displays, and monitoring the health of
connected devices.

The system must support deployments ranging from two displays on a local
network to large installations containing hundreds or thousands of players.

The network server must be optional. A player must remain capable of
playing locally cached signage packages when the server is unavailable.

CORE OBJECTIVES
===============================================================================

  - Centralized player management.
  - Remote package distribution.
  - Synchronized playback across multiple displays.
  - Device groups and display walls.
  - Centralized playlists and schedules.
  - Remote configuration.
  - Player health monitoring.
  - Playback state monitoring.
  - Automatic recovery and reconnection.
  - Package version management.
  - Offline playback.
  - Secure network communications.
  - Local network deployment without cloud dependencies.
  - Optional remote access for geographically distributed displays.

The network system must integrate with the existing React/TypeScript
application, custom .signage binary archive format, and standalone player.


===============================================================================
20. NETWORK ARCHITECTURE
===============================================================================

20.1 SYSTEM OVERVIEW

  +-----------------------------------------------------------------------+
  |                     DIGITAL SIGNAGE STUDIO                            |
  |                                                                       |
  |  Project Editor  |  Package Builder  |  Playlist Designer             |
  +-----------------------------------+-----------------------------------+
                                      |
                                      | HTTPS
                                      v
  +-----------------------------------------------------------------------+
  |                      SIGNAGE MANAGEMENT SERVER                        |
  |                                                                       |
  |  REST API              Authentication and Authorization               |
  |  WebSocket Gateway     Device Registry                                |
  |  Package Repository    Playlist and Schedule Manager                 |
  |  Synchronization       Clock Coordination                             |
  |  Command Queue         Health Monitoring                              |
  |  Event Logging         Deployment Manager                             |
  |                                                                       |
  |  Database              Package and Asset Storage                      |
  +-------------------------------+---------------------------------------+
                                  |
                  +---------------+---------------+
                  |               |               |
                  v               v               v
          +---------------+ +---------------+ +---------------+
          | PLAYER GROUP A| | PLAYER GROUP B| | PLAYER GROUP C|
          |               | |               | |               |
          | Player 01     | | Player 04     | | Player 07     |
          | Player 02     | | Player 05     | | Player 08     |
          | Player 03     | | Player 06     | | Player 09     |
          +---------------+ +---------------+ +---------------+
                  |               |               |
                  v               |               v
          +---------------+ +---------------+ +---------------+
          | Display Wall  | | Menu Boards   | | Lobby Displays|
          +---------------+ +---------------+ +---------------+

All players communicate with the server over authenticated network
connections.

The server coordinates playback and management. The players perform
local rendering and media decoding.

20.2 NETWORK DEPLOYMENT MODES

MODE A: LOCAL NETWORK

  - Server runs on a local Windows or Linux machine.
  - Players connect using the local network.
  - Packages are distributed over the LAN.
  - No external internet connection is required after provisioning.
  - Playback synchronization operates within the capabilities of the LAN.

MODE B: REMOTE MANAGEMENT

  - Server is accessible through a secured network connection.
  - Players may be located at multiple physical sites.
  - Packages and schedules are distributed remotely.
  - Players cache content locally.
  - Playback continues during temporary WAN outages.

MODE C: HYBRID

  - Central management server coordinates deployments.
  - Local site servers or gateways cache packages.
  - Local players communicate with their site gateway.
  - The gateway continues serving content during WAN outages.
  - Central configuration changes propagate when connectivity returns.

RECOMMENDATION:

Implement local-network and hybrid-compatible architecture first.
Keep the server API independent of deployment topology so remote
management can be introduced without redesigning the playback engine.


===============================================================================
21. SERVER TECHNOLOGY STACK
===============================================================================

RECOMMENDED SERVER:

  Runtime:
    - Node.js.
    - TypeScript.

  HTTP API:
    - Fastify.
    - REST/JSON.

  Real-Time Communication:
    - WebSockets.

  Database:
    - SQLite for initial single-server deployments.
    - PostgreSQL as an optional future backend for larger installations.

  Package Storage:
    - Filesystem-based object storage.
    - Content-addressed package storage.
    - Optional S3-compatible storage for larger deployments.

  Authentication:
    - Device credentials.
    - Administrator authentication.
    - Role-based authorization.

  Network Security:
    - HTTPS.
    - WSS.
    - TLS certificate management.
    - Signed update manifests.
    - Optional mutual TLS for managed installations.

  Background Tasks:
    - Persistent database-backed task queue.
    - Retry and expiration policies.

  Deployment:
    - Native Node.js service.
    - Optional Docker deployment.
    - Reverse proxy support.
    - Windows and Linux server support.

The server must not require Kubernetes, Kafka, Redis, or a microservice
architecture for the initial implementation.

Start with a modular monolithic server. Separate services only when
deployment scale or operational requirements justify the additional
complexity.


===============================================================================
22. PLAYER REGISTRY AND DEVICE MANAGEMENT
===============================================================================

22.1 DEVICE REGISTRATION

Every player must have a unique, persistent device ID.

Registration workflow:

  1. Install the signage player.
  2. Open the device enrollment interface.
  3. Generate a registration request.
  4. Administrator approves the device or supplies a valid enrollment code.
  5. Server issues device credentials.
  6. Player establishes an authenticated connection.
  7. Player downloads its configuration.
  8. Player reports its initial status.

Enrollment codes must expire and be protected against reuse.

Device credentials must be stored securely using operating-system
facilities where available.

22.2 DEVICE METADATA

Each registered device must report:

  - Device ID.
  - Device name.
  - Assigned location.
  - Assigned display.
  - Operating system.
  - Player version.
  - Supported capabilities.
  - Current package ID.
  - Current package version.
  - Current scene ID.
  - Current playlist ID.
  - Playback state.
  - Last successful synchronization.
  - Last heartbeat.
  - Available storage where supported.
  - Estimated memory usage where supported.
  - Estimated frame rate.
  - Media errors.
  - Network connection state.

22.3 DEVICE STATES

  ONLINE:
    Device is connected and reporting health.

  OFFLINE:
    Device has not communicated within the configured timeout.

  CONNECTING:
    Device is establishing a server connection.

  SYNCING:
    Device is synchronizing its clock or playback state.

  DOWNLOADING:
    Device is receiving a package or update.

  READY:
    Required content is available and the player can begin playback.

  PLAYING:
    Signage is actively playing.

  PAUSED:
    Playback has been intentionally paused.

  MAINTENANCE:
    Device is in an authorized maintenance session.

  ERROR:
    An unrecoverable or repeatedly occurring error requires attention.

State transitions must be explicit and validated.

The server must distinguish a stale heartbeat from a confirmed process
failure. Network disconnection does not necessarily mean playback has
stopped.


===============================================================================
23. DEVICE GROUPS AND DISPLAY TOPOLOGY
===============================================================================

23.1 DEVICE GROUPS

Administrators must be able to create named player groups.

Examples:

  - Main Lobby.
  - Reception.
  - Cafeteria.
  - Production Floor.
  - Conference Rooms.
  - Storefront Displays.
  - Video Wall.
  - Building A.
  - Building B.

A player may belong to one or more organizational groups.

Synchronization membership must be separately defined because not every
display in an organizational group needs synchronized playback.

23.2 GROUP CONFIGURATION

Each group supports:

  - Group ID.
  - Group name.
  - Description.
  - Assigned players.
  - Default package.
  - Default playlist.
  - Schedule.
  - Synchronization policy.
  - Synchronization leader or timing authority.
  - Group time zone.
  - Group configuration version.
  - Failure policy.
  - Offline behavior.

23.3 DISPLAY TOPOLOGY

Support the following display configurations:

  SINGLE DISPLAY:
    One player controls one display.

  SYNCHRONIZED DISPLAYS:
    Multiple players show the same scene at approximately the same time.

  SYNCHRONIZED PLAYLISTS:
    Multiple displays advance through the same sequence together.

  INDEPENDENT GROUP:
    Displays share schedules and package assignments but play independently.

  MULTI-SCREEN VIDEO WALL:
    Multiple displays render separate portions of a larger composition.

  MASTER AND SECONDARY DISPLAYS:
    One display shows primary content while other displays show related
    content coordinated by the same schedule.

A logical display group must not be assumed to be a physical video wall.
Video-wall configuration requires explicit display geometry and
per-player viewport configuration.


===============================================================================
24. SYNCHRONIZED PLAYBACK ENGINE
===============================================================================

24.1 SYNCHRONIZATION OBJECTIVE

The system must coordinate the playback timeline across multiple players.

For example:

  - Ten displays begin the same presentation together.
  - Every display advances to the next scene at the same scheduled time.
  - All players use the same package and playlist revision.
  - A player joining late can determine the correct current scene.
  - A disconnected player continues locally and resynchronizes when able.

Do not rely on sending a WebSocket message at the exact instant playback
must begin. Network latency makes that approach unreliable.

Instead, communicate a future start time and a shared playback timeline.


24.2 SYNCHRONIZATION MODEL

Use a SERVER-AUTHORITATIVE TIMELINE.

The server defines:

  - Synchronization group ID.
  - Group playback session ID.
  - Timeline revision.
  - Package ID and version.
  - Playlist ID and revision.
  - Scene sequence.
  - Scheduled start time.
  - Scene start offsets.
  - Transition timing.
  - Pause and resume state.
  - Playback epoch.
  - Synchronization policy.

The player calculates its expected playback position using the shared
timeline and its estimated server clock.

Example:

  Group:
    lobby-video-wall

  Session:
    session-20261025-001

  Package:
    package-001, version 4

  Scheduled start:
    2026-10-25T20:00:00.000Z

  Scene 1:
    Starts at 0 seconds.
    Duration: 15 seconds.

  Scene 2:
    Starts at 15 seconds.
    Duration: 20 seconds.

  Scene 3:
    Starts at 35 seconds.
    Duration: 30 seconds.

At 20:00:22 UTC, a player joining the session should calculate that
Scene 2 is active and that approximately 7 seconds have elapsed.

The player must not restart the entire playlist unless the synchronization
policy explicitly requires a group restart.


24.3 SYNCHRONIZATION LEVELS

LEVEL 1: SCHEDULE SYNCHRONIZATION

  - Players receive the same schedule.
  - Each player starts content at the scheduled time.
  - Suitable for loosely coordinated displays.

LEVEL 2: TIMELINE SYNCHRONIZATION

  - Players share a common playback epoch.
  - Players calculate scene position from the same timeline.
  - Suitable for synchronized presentations and menu boards.

LEVEL 3: DRIFT-CORRECTED SYNCHRONIZATION

  - Players periodically compare their estimated playback position
    with the authoritative timeline.
  - Small differences are corrected.
  - Larger differences trigger a controlled seek or restart.

LEVEL 4: FRAME-ACCURATE VIDEO-WALL SYNCHRONIZATION

  - Requires stronger timing guarantees.
  - May require native playback, hardware synchronization, or specialized
    display equipment.
  - Ordinary browsers and independent consumer displays cannot guarantee
    frame-perfect output.

Implement Levels 1 through 3 first. Treat Level 4 as a specialized
deployment capability rather than a guarantee of the browser player.


===============================================================================
25. CLOCK SYNCHRONIZATION
===============================================================================

25.1 CLOCK MODEL

The server and each player must maintain an estimated shared time base.

Do not directly trust the player's wall clock.

Implement a clock synchronization service using repeated timestamp
exchanges. The player should estimate clock offset and uncertainty
rather than assuming that a single exchange is accurate.

A simplified exchange uses:

  T1 = Client sends request.
  T2 = Server receives request.
  T3 = Server sends response.
  T4 = Client receives response.

Estimated clock offset:

  Offset = ((T2 - T1) + (T3 - T4)) / 2

Estimated network round-trip time, excluding server processing:

  RTT = (T4 - T1) - (T3 - T2)

Use multiple samples and prefer low-latency measurements.

The implementation must account for clock drift, timestamp precision,
network asymmetry, and changes in system time.

25.2 CLOCK REQUIREMENTS

  - Periodic synchronization.
  - Multiple-sample offset estimation.
  - Outlier rejection.
  - Clock uncertainty tracking.
  - Gradual correction of small offsets.
  - Detection of large clock jumps.
  - Resynchronization after reconnect.
  - Monotonic timing for animation and playback progression.

Use a monotonic clock for measuring elapsed time. Wall-clock time is
used to align the monotonic timeline with scheduled UTC timestamps.

25.3 START SCHEDULING

A synchronized playback session must have a future start time.

The server must:

  1. Select the package and playlist.
  2. Verify player assignments.
  3. Ensure required packages are available.
  4. Wait for required players to report READY.
  5. Calculate a start time sufficiently far in the future.
  6. Publish the session and start time.
  7. Require players to acknowledge the command.
  8. Begin playback at the calculated time.

If a player is not ready before the deadline, apply the group's configured
failure policy.

Possible policies:

  - Wait for all players.
  - Start with available players.
  - Remove unavailable players temporarily.
  - Abort the group start.
  - Continue with the previous valid session.

Never claim that all players are synchronized merely because the server
sent the same command to every device.


===============================================================================
26. PLAYBACK DRIFT CORRECTION
===============================================================================

26.1 DRIFT MEASUREMENT

Each player periodically reports:

  - Session ID.
  - Timeline revision.
  - Expected scene ID.
  - Actual scene ID.
  - Expected playback position.
  - Actual playback position.
  - Estimated clock offset.
  - Clock uncertainty.
  - Estimated frame rate.
  - Media readiness.
  - Current playback state.

The server or group coordinator compares these values.

Playback position must be measured against the authoritative timeline,
not just the local video element's currentTime.

26.2 CORRECTION POLICY

SMALL DRIFT:
  - Keep playback running.
  - Correct future scheduling.
  - Apply a small playback-rate adjustment only when supported and safe.

MODERATE DRIFT:
  - Seek to the expected timeline position when media permits.
  - Avoid disruptive correction during transitions where possible.

LARGE DRIFT:
  - Reinitialize the active scene.
  - Seek to the expected position.
  - Restart the active scene if seeking is unavailable.

INVALID STATE:
  - Revalidate the session.
  - Reload the required package if necessary.
  - Enter recovery mode if synchronization cannot be restored.

Correction thresholds must be configurable per group.

26.3 VIDEO SYNCHRONIZATION

Video decoding can introduce different startup delays across devices.

For synchronized video:

  - Preload media before the scheduled start.
  - Wait for media readiness.
  - Use a shared target start time.
  - Align video position with the session timeline.
  - Monitor actual media position.
  - Correct accumulated drift.
  - Report decoder limitations.

Playback-rate correction must be conservative and supported by the
underlying media and browser.

For strict video-wall synchronization, consider native media playback
and hardware-level synchronization.

26.4 ANIMATION SYNCHRONIZATION

Do not advance animations using an independent accumulated timer on
every player.

Instead, calculate animation progress from the shared timeline.

For an animation beginning at timeline position A:

  Progress = (CurrentTimelinePosition - A) / Duration

Clamp or wrap the result according to the animation's repeat and
fill configuration.

This allows a player to recover the correct animation state after a
late join, pause, resume, or reconnect.


===============================================================================
27. NETWORK PACKAGE DISTRIBUTION
===============================================================================

27.1 PACKAGE REPOSITORY

The server must provide a centralized repository for .signage packages.

Package metadata:

  - Package ID.
  - Package version.
  - Display name.
  - Description.
  - File size.
  - Content hash.
  - Format version.
  - Upload timestamp.
  - Publisher identity where available.
  - Signature status.
  - Compatibility requirements.
  - Deployment status.

27.2 UPLOAD WORKFLOW

  1. Administrator selects a .signage file.
  2. Server validates its structure.
  3. Server verifies required integrity information.
  4. Server calculates or verifies the package content hash.
  5. Server checks whether the package already exists.
  6. Server stores the package.
  7. Server records package metadata.
  8. Server marks the package as available for deployment.

Packages must be treated as untrusted until validated.

27.3 DOWNLOAD WORKFLOW

  1. Server assigns a package to a player or group.
  2. Player checks local package availability.
  3. Player compares package ID, version, and hash.
  4. Player downloads the package if needed.
  5. Player verifies the downloaded content.
  6. Player stores it in a temporary location.
  7. Player validates the archive.
  8. Player atomically promotes it to the local package cache.
  9. Player reports READY.

Never overwrite the currently playing package while it is in use.

Use atomic activation so an interrupted download cannot destroy the
last known-good package.

27.4 CONTENT-ADDRESSED STORAGE

Store packages using a stable content hash where practical.

Benefits:

  - Duplicate uploads can be avoided.
  - Identical packages can be shared across groups.
  - Integrity verification becomes straightforward.
  - Rollback can reference previous package versions.
  - Storage usage can be reduced.

Do not delete package data while any active deployment, rollback
reference, or player assignment still requires it.

27.5 OPTIONAL DELTA UPDATES

A future optimization may distribute only changed package entries.

A delta update must identify:

  - Base package hash.
  - Target package hash.
  - Changed entries.
  - Added entries.
  - Removed entries.
  - Required format version.
  - Validation requirements.

The player must reconstruct the complete target package and verify
its final hash before activation.

If the base package is missing or incompatible, download the complete
package instead.


===============================================================================
28. CENTRALIZED PLAYLISTS AND SCHEDULES
===============================================================================

The server must allow administrators to manage playlists centrally.

PLAYLIST CONFIGURATION:

  - Playlist ID.
  - Playlist revision.
  - Playlist name.
  - Ordered package or scene references.
  - Duration overrides.
  - Transition settings.
  - Looping behavior.
  - Synchronization policy.
  - Default fallback.
  - Assigned devices and groups.

SCHEDULE CONFIGURATION:

  - Schedule ID.
  - Schedule revision.
  - Start date.
  - End date.
  - Start time.
  - End time.
  - Days of the week.
  - Time zone.
  - Priority.
  - Assigned group.
  - Fallback behavior.

The server must distribute versioned configuration.

Players must apply a new configuration only after validation.

A synchronized group must not silently mix incompatible playlist revisions.

If the server becomes unavailable, players must continue using their
last valid cached schedule and configuration until a new valid version
becomes available.


===============================================================================
29. NETWORK COMMAND SYSTEM
===============================================================================

The server must support authenticated commands for individual players
and groups.

SUPPORTED COMMANDS:

  - STATUS_REQUEST
  - REFRESH_CONFIGURATION
  - DOWNLOAD_PACKAGE
  - VALIDATE_PACKAGE
  - PREPARE_SESSION
  - START_SESSION
  - PAUSE_SESSION
  - RESUME_SESSION
  - STOP_SESSION
  - SEEK_SESSION
  - RESYNCHRONIZE
  - ACTIVATE_PACKAGE
  - ROLLBACK_PACKAGE
  - ENTER_MAINTENANCE
  - EXIT_MAINTENANCE
  - RESTART_PLAYER
  - REQUEST_DIAGNOSTICS

Commands must include:

  - Unique command ID.
  - Target device or group.
  - Command type.
  - Parameters.
  - Issuing administrator or service identity.
  - Creation timestamp.
  - Expiration timestamp.
  - Idempotency key where appropriate.
  - Authorization context.

Commands must be validated by the player.

Expired commands must not be executed.

A delayed START_SESSION command must not cause a player to restart
a session that has already ended.

The player must acknowledge commands with:

  - RECEIVED
  - ACCEPTED
  - REJECTED
  - EXECUTING
  - COMPLETED
  - FAILED
  - EXPIRED

The server must distinguish command receipt from successful execution.


===============================================================================
30. NETWORK COMMUNICATION
===============================================================================

30.1 REST API

Use HTTPS REST endpoints for management and resource operations.

Suggested endpoint structure:

  /api/v1/auth/
  /api/v1/devices/
  /api/v1/groups/
  /api/v1/packages/
  /api/v1/playlists/
  /api/v1/schedules/
  /api/v1/sessions/
  /api/v1/commands/
  /api/v1/events/
  /api/v1/diagnostics/
  /api/v1/server/

Examples:

  GET    /api/v1/devices
  GET    /api/v1/devices/{deviceId}
  POST   /api/v1/devices/{deviceId}/commands
  GET    /api/v1/groups
  POST   /api/v1/groups
  GET    /api/v1/packages
  POST   /api/v1/packages
  GET    /api/v1/packages/{packageId}
  POST   /api/v1/sessions
  GET    /api/v1/sessions/{sessionId}
  POST   /api/v1/sessions/{sessionId}/resynchronize

These endpoints are proposed interfaces and must be defined precisely
in the API specification before implementation.

30.2 WEBSOCKET CHANNEL

Use WebSockets for real-time events and low-latency coordination.

Example event types:

  DEVICE_CONNECTED
  DEVICE_DISCONNECTED
  DEVICE_STATUS_UPDATED
  DEVICE_READY
  PACKAGE_DOWNLOAD_PROGRESS
  PACKAGE_DOWNLOAD_COMPLETED
  PACKAGE_DOWNLOAD_FAILED
  SESSION_PREPARED
  SESSION_STARTED
  SESSION_PAUSED
  SESSION_RESUMED
  SESSION_COMPLETED
  PLAYBACK_DRIFT_DETECTED
  PLAYBACK_RESYNCHRONIZED
  DEVICE_ERROR
  CONFIGURATION_UPDATED
  COMMAND_ACKNOWLEDGED

WebSockets are for communication, not the authoritative storage of
configuration or session state.

The server must persist important commands and configuration changes
so they can be recovered after restarts or connection loss.

30.3 RECONNECTION

The player must:

  - Detect disconnected server connections.
  - Retry using exponential backoff.
  - Add randomized jitter to avoid synchronized reconnect storms.
  - Reauthenticate when required.
  - Fetch configuration revisions missed while disconnected.
  - Resume package downloads safely where supported.
  - Reconcile active sessions.
  - Recalculate clock offset.
  - Report its current playback state.
  - Resume normal synchronization when ready.

Use a configurable retry limit and maximum delay for management
operations, but do not terminate local playback merely because the
server is unreachable.


===============================================================================
31. OFFLINE OPERATION AND RECOVERY
===============================================================================

Offline operation is a mandatory feature.

31.1 LOCAL CACHE

Each player must maintain a local cache containing:

  - Last known-good package.
  - Required media assets.
  - Current playlist.
  - Current schedule.
  - Device configuration.
  - Last known session information.
  - Recent synchronization metadata.
  - Optional rollback package.

31.2 SERVER FAILURE

When the server becomes unavailable:

  1. Continue playing the current valid session.
  2. Keep local media available.
  3. Continue timeline-based animation.
  4. Use the cached schedule.
  5. Record the disconnection.
  6. Retry server communication.
  7. Preserve the last known-good package.

If the current session ends while offline, use the configured fallback
playlist or continue the cached schedule.

31.3 RECONNECTION

When the server becomes available:

  1. Reauthenticate.
  2. Report the current device state.
  3. Fetch missing configuration revisions.
  4. Compare package assignments.
  5. Synchronize the clock.
  6. Reconcile the active playback session.
  7. Download required updates.
  8. Resynchronize playback when authorized.

Do not abruptly restart playback merely because a newer configuration
has arrived. Apply the configured update policy.


===============================================================================
32. SERVER DATABASE MODEL
===============================================================================

Use a relational database for authoritative management state.

SUGGESTED TABLES:

  users
    - id
    - username
    - password_hash or external_identity
    - role
    - created_at
    - disabled_at

  devices
    - id
    - name
    - status
    - player_version
    - capabilities_json
    - last_seen_at
    - configuration_revision
    - created_at

  device_credentials
    - id
    - device_id
    - credential_reference
    - created_at
    - expires_at
    - revoked_at

  groups
    - id
    - name
    - configuration_revision
    - synchronization_policy
    - created_at

  group_members
    - group_id
    - device_id
    - role

  packages
    - id
    - name
    - version
    - format_version
    - content_hash
    - storage_reference
    - size_bytes
    - signature_status
    - created_at

  playlists
    - id
    - name
    - revision
    - configuration_json
    - created_at

  schedules
    - id
    - group_id
    - revision
    - configuration_json
    - enabled

  sessions
    - id
    - group_id
    - package_id
    - playlist_id
    - timeline_revision
    - start_time_utc
    - status
    - created_at

  session_devices
    - session_id
    - device_id
    - readiness_state
    - last_reported_position
    - last_reported_at

  commands
    - id
    - target_device_id
    - target_group_id
    - command_type
    - payload_json
    - status
    - expires_at
    - created_at

  events
    - id
    - device_id
    - event_type
    - payload_json
    - created_at

  deployments
    - id
    - package_id
    - target_group_id
    - status
    - created_at
    - completed_at

  audit_log
    - id
    - actor_id
    - action
    - target_type
    - target_id
    - created_at

Use appropriate indexes, foreign keys, retention policies, and
transactional updates.

Keep high-frequency transient metrics out of permanent relational
tables unless they are required for troubleshooting or auditing.

The database is authoritative for management state. The local player
cache remains authoritative for the content currently available on
that device.


===============================================================================
33. SERVER ADMINISTRATION UI
===============================================================================

Extend the React application with a NETWORK MANAGEMENT section.

NAVIGATION:

  - Overview.
  - Devices.
  - Device Groups.
  - Synchronization Groups.
  - Packages.
  - Deployments.
  - Playlists.
  - Schedules.
  - Playback Sessions.
  - Commands.
  - Diagnostics.
  - Audit Log.
  - Server Settings.

33.1 SERVER OVERVIEW

Display:

  - Total registered devices.
  - Online devices.
  - Offline devices.
  - Devices currently playing.
  - Devices downloading packages.
  - Active synchronization groups.
  - Sessions with synchronization errors.
  - Pending deployments.
  - Failed commands.
  - Server storage usage.
  - Recent events.

33.2 DEVICE MANAGEMENT

Allow administrators to:

  - Register devices.
  - Approve enrollment requests.
  - Rename devices.
  - Assign locations.
  - Assign groups.
  - Assign packages.
  - Configure playback.
  - Request diagnostics.
  - Start maintenance.
  - Revoke credentials.
  - Remove devices.

Destructive operations must require appropriate authorization.

33.3 SYNCHRONIZATION DASHBOARD

For each synchronization group, display:

  - Group name.
  - Active session.
  - Assigned players.
  - Ready players.
  - Missing players.
  - Current scene.
  - Expected timeline position.
  - Reported timeline position.
  - Estimated clock offset.
  - Clock uncertainty.
  - Playback drift.
  - Last synchronization time.
  - Current synchronization state.

Use clear status indicators and make detailed diagnostics accessible
without overwhelming the main dashboard.


===============================================================================
34. SECURITY REQUIREMENTS
===============================================================================

AUTHENTICATION:
  - Secure administrator authentication.
  - Unique device credentials.
  - Credential expiration and revocation.
  - Optional multi-factor authentication for administrators.

AUTHORIZATION:
  - Role-based access control.
  - Separate device and administrator permissions.
  - Group-level access restrictions.
  - Authorization checks for every management command.

TRANSPORT:
  - HTTPS.
  - WSS.
  - Certificate validation.
  - No plaintext device credentials.
  - Secure remote access configuration.

PACKAGE SECURITY:
  - Archive validation.
  - Content hash verification.
  - Optional publisher signatures.
  - Atomic package activation.
  - Rollback protection.
  - Restricted script execution.

COMMAND SECURITY:
  - Command authorization.
  - Expiration.
  - Replay protection.
  - Idempotency.
  - Audit logging.
  - Parameter validation.

DEVICE SECURITY:
  - Restricted OS account.
  - Secure credential storage.
  - Least-privilege permissions.
  - Protected maintenance mode.
  - Controlled restart operations.

SERVER SECURITY:
  - Input validation.
  - Rate limiting.
  - Request-size limits.
  - Database backups.
  - Audit retention.
  - Secure secret storage.
  - Dependency updates.
  - Optional network segmentation.

Never trust a device merely because it is connected to the local network.

Never trust a package merely because it was uploaded by an authenticated
user. Validate package integrity and enforce script permissions separately.


===============================================================================
35. SYNCHRONIZATION ACCEPTANCE TESTS
===============================================================================

TEST 1: GROUP START

  - Register at least five players.
  - Assign them to one synchronization group.
  - Distribute the same package.
  - Wait until all required players are READY.
  - Schedule a common future start time.
  - Measure each player's actual start time.
  - Report start-time differences.

TEST 2: SCENE TRANSITIONS

  - Create a multi-scene playlist.
  - Synchronize all players.
  - Verify scene transitions against the shared timeline.
  - Verify that late frame rendering does not permanently shift
    subsequent scene timing.

TEST 3: LATE JOIN

  - Start a synchronized session.
  - Connect another player after playback begins.
  - Verify that the player determines the correct active scene.
  - Verify that it joins at the correct timeline position.

TEST 4: NETWORK INTERRUPTION

  - Disconnect one player from the server.
  - Verify that playback continues locally.
  - Reconnect the player.
  - Verify configuration reconciliation.
  - Verify clock resynchronization.
  - Verify playback correction.

TEST 5: SERVER RESTART

  - Start a synchronized session.
  - Restart the management server.
  - Verify that active session state is recovered from persistent storage.
  - Verify that players continue playback.
  - Verify that reconnection does not duplicate commands or restart
    the session unexpectedly.

TEST 6: PACKAGE DEPLOYMENT

  - Upload a new package version.
  - Assign it to a group.
  - Download it to every target player.
  - Verify content hashes.
  - Verify atomic activation.
  - Verify that failed downloads do not damage the current package.

TEST 7: PLAYER FAILURE

  - Terminate a player during playback.
  - Verify local watchdog recovery.
  - Verify server status updates.
  - Verify that the player rejoins the session correctly.

TEST 8: CLOCK DRIFT

  - Introduce controlled clock offsets and timing delays.
  - Measure synchronization accuracy.
  - Verify clock uncertainty reporting.
  - Verify that players do not apply excessive corrections.

TEST 9: AUTHORIZATION

  - Attempt to issue commands using unauthorized credentials.
  - Attempt to replay expired commands.
  - Attempt to modify another group's configuration.
  - Verify rejection and audit logging.

TEST 10: LONG-RUNNING SYNCHRONIZATION

  - Run a synchronized group for at least 72 hours.
  - Monitor clock drift.
  - Monitor memory usage.
  - Monitor reconnects.
  - Monitor playback errors.
  - Verify that synchronization remains within the configured tolerance.


===============================================================================
36. NETWORK SYNCHRONIZATION PERFORMANCE TARGETS
===============================================================================

These are initial engineering targets, not guaranteed performance
characteristics. Validate them using reference hardware and network
conditions.

LOCAL NETWORK:

  - Target scheduled start-time difference: 100 ms or less.
  - Target timeline drift after correction: 100 ms or less.
  - Clock synchronization uncertainty must be reported.
  - Package downloads must not interrupt active playback.
  - Players must continue playback during temporary disconnections.

REMOTE NETWORK:

  - Synchronization tolerance must be configurable.
  - Increased network latency must be measured and reported.
  - Players must schedule starts sufficiently far in the future.
  - Late commands must not trigger obsolete playback actions.
  - WAN outages must not terminate local playback.

STRICT VIDEO WALL:

  - Browser-only frame-perfect synchronization is not guaranteed.
  - Use native or specialized playback where necessary.
  - Consider hardware genlock or other supported synchronization
    mechanisms for demanding installations.
  - Validate the complete display pipeline, not just software timestamps.

The server must report synchronization quality rather than presenting
all connected devices as synchronized without measurement.


===============================================================================
37. IMPLEMENTATION ROADMAP ADDENDUM
===============================================================================

PHASE 8: NETWORK SERVER FOUNDATION

  - Implement Fastify REST API.
  - Implement database schema.
  - Implement administrator authentication.
  - Implement device enrollment.
  - Implement device registry.
  - Implement WebSocket gateway.
  - Implement heartbeat monitoring.

DELIVERABLE:
  A functioning server that registers and monitors signage players.

PHASE 9: PACKAGE REPOSITORY AND DISTRIBUTION

  - Implement package uploads.
  - Validate .signage archives.
  - Implement content-addressed storage.
  - Implement package assignments.
  - Implement downloads.
  - Implement hash verification.
  - Implement atomic package activation.
  - Implement rollback.

DELIVERABLE:
  Administrators can distribute packages to multiple devices.

PHASE 10: CENTRALIZED PLAYLISTS AND SCHEDULES

  - Implement playlist management.
  - Implement schedule management.
  - Implement group assignments.
  - Implement configuration revisions.
  - Implement offline schedule caching.
  - Implement deterministic conflict resolution.

DELIVERABLE:
  Administrators can manage content centrally.

PHASE 11: SYNCHRONIZED PLAYBACK

  - Implement synchronization groups.
  - Implement session definitions.
  - Implement clock offset estimation.
  - Implement future scheduled starts.
  - Implement player readiness checks.
  - Implement timeline-based scene progression.
  - Implement drift detection.
  - Implement controlled correction.

DELIVERABLE:
  Multiple players can follow a common playback timeline.

PHASE 12: NETWORK MANAGEMENT UI

  - Implement device dashboard.
  - Implement group management.
  - Implement package deployment UI.
  - Implement synchronization dashboard.
  - Implement remote commands.
  - Implement diagnostics.
  - Implement audit logs.

DELIVERABLE:
  A complete central administration interface.

PHASE 13: RELIABILITY AND HARDENING

  - Implement persistent command queues.
  - Implement reconnect logic.
  - Implement offline recovery.
  - Implement server restart recovery.
  - Implement authentication revocation.
  - Implement network failure tests.
  - Implement long-running synchronization tests.

DELIVERABLE:
  A reliable multi-display signage management system.


===============================================================================
38. UPDATED FINAL APPLICATION OBJECTIVE
===============================================================================

Build a complete digital signage platform consisting of:

  1. React and TypeScript visual design studio.
  2. Professional media and animation editor.
  3. Custom compressed binary archive format.
  4. Standalone playback engine.
  5. Playlist and scheduling system.
  6. Restricted script runtime.
  7. Full-screen kiosk deployment host.
  8. Protected administrative controls.
  9. Playback diagnostics and recovery.
 10. Centralized network management server.
 11. Device registry and enrollment system.
 12. Package repository and distribution.
 13. Centralized playlist and schedule management.
 14. Device groups and display topology.
 15. Shared playback timeline.
 16. Clock synchronization.
 17. Playback drift detection and correction.
 18. Offline operation and automatic reconnection.
 19. Secure remote commands.
 20. Network monitoring and diagnostics.

The final system must allow an administrator to create signage, package
all required resources into one .signage file, distribute that package
to selected players, schedule playback, and synchronize multiple
displays from a central management interface.

Players must cache content locally, verify downloaded packages, and
continue playing the last valid content when the server is unavailable.

Synchronization must use a shared timeline and scheduled start times,
not merely simultaneous network commands.

The architecture must prioritize reliability, security, portability,
synchronization accuracy, efficient package distribution, and ease of
management across multiple displays.

===============================================================================
END OF ADDENDUM
===============================================================================
