# Changelog

All notable changes to the Levin extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2024-12-04

### Added

- **Remote server support** - Connect to remote Datalevin servers
  - Support for `dtlv://` URI format with authentication
  - Format: `dtlv://username:password@host:port/database`
  - New "Remote Server" option in Open Database dialog
  - Remote databases display with remote icon in tree view
  - All operations (query, schema, transactions) work seamlessly with remote servers

---

## [0.4.4] - 2024-12-01

### Changed

- **Display type dropdowns moved to Schema page** - Cleaner entity inspector
  - Set display types (image, hyperlink, email, json, code) from Schema view
  - Entity inspector now just uses the configured display types
  - New "Display" column in schema table with dropdown per attribute

---

## [0.4.3] - 2024-11-30

### Added

- **Display type configuration** - Configure how attributes are rendered in Entity Inspector
  - Dropdown on each attribute to set: image, hyperlink, email, json, code
  - Settings stored per-database as `:levin.display/attribute` and `:levin.display/type`
  - Auto-detects URLs and emails even without explicit configuration
  - Hyperlinks are now clickable and open in browser

### Fixed

- **Image rendering** - Added CSP header to allow data: URIs in webview
- **OLE image wrapper** - Now strips OLE headers to find actual BMP/JPEG/PNG data

---

## [0.4.2] - 2024-11-30

### Added

- **Image rendering in Entity Inspector** - Hex-encoded images now display inline
  - Detects attributes with "photo", "image", "picture", or "avatar" in the name
  - Converts hex data (0x...) to base64 and renders as image
  - Supports JPEG, PNG, GIF, BMP formats via magic byte detection

---

## [0.4.1] - 2024-11-30

### Fixed

- **Large database support** - Fixed `MDB_MAP_RESIZED` error for databases with lots of data
  - Now uses mapsize of 1GB when opening connections
  - Fixes opening databases like ATP tennis with ~195K entities

---

## [0.4.0] - 2024-11-30

### Added

- **Datalog Rules Management** - Store and reuse query rules in the database
  - Click "Rules" in tree to open Rules panel
  - Create named rules with descriptions (e.g., `played`, `slam-finals`)
  - Rules stored as `:levin.rule/name`, `:levin.rule/body`, `:levin.rule/description`
  - Copy rules to clipboard for use in queries
  - Use with `:in $ %` syntax in Datalog queries

---

## [0.3.3] - 2024-11-30

### Fixed

- **Entity Inspector ref handling** - Fixed display of entity references
  - Ref values now show as clickable IDs instead of `{:db/id N}` maps
  - Only ref-type attributes are hyperlinked (not all numbers)
  - Properly extracts IDs from Datalevin's `{:db/id N}` format

---

## [0.3.2] - 2024-11-30

### Changed

- **Data-driven relationship discovery** - Relationships diagram now queries actual data
  - Instead of guessing from attribute names (`:movie/cast` → `cast`)
  - Now discovers actual targets (`:movie/cast` → `person`)
  - Shows `? (no data)` for refs with no data yet
  - More accurate representation of real entity connections

---

## [0.3.1] - 2024-11-30

### Fixed

- **Separate panels per database** - Each database now gets its own Schema/Entities/Relationships tab
  - Previously clicking on a different database would silently update the existing panel
  - Now each database opens in a new tab, or brings existing tab to front

### Changed

- **Relationships diagram** - Added visual network diagram showing entity connections
  - Nodes represent entity namespaces (order, customer, product, etc.)
  - Arrows show ref-type attributes connecting them
  - Dashed lines indicate one-to-many relationships
  - Tabs to switch between Diagram and List view

---

## [0.3.0] - 2024-11-30

### Added

- **Entity Browser** - Click "Entities" in tree to open paginated entity browser
  - Filter by namespace
  - Page sizes: 10, 25, 50, 100
  - Click entity ID to inspect
  - Shows preview of first attribute
- **Relationships Panel** - Click "Relationships" in tree to see ref-type attributes
  - Shows all attributes with `:db/valueType :db.type/ref`
  - Click attribute to open query for that relationship
  - Shows cardinality and component info

### Changed

- **Simplified tree view** - Schema, Entities, Relationships are now clickable items that open panels
  - No more expansion issues - panels provide better UX
  - Click instead of expand to view data

---

## [0.2.13] - 2024-11-29

### Fixed

- **Schema display** - Schema attributes now show correct type, cardinality, and uniqueness
  - Fixed `getSchema` to query actual schema datoms instead of using `datalevin.core/schema`
  - The schema function only returns `{:db/aid N}`, not full type info
- **Datomic schema import** - Fixed schema import bug where data was stored incorrectly
  - `transactDatomicSchema` now converts and transacts in one step
  - Avoids string escaping issues with the previous `convertDatomicSchema` approach

### Changed

- **Schema editor** - Improved table with separate columns
  - Attribute, Type, Cardinality, Unique, and Other (indexed/fulltext/component)
  - Clearer display of schema properties

---

## [0.2.12] - 2024-11-28

### Fixed

- **Tree view expansion** - Schema and Entities folders now properly expand to show children
  - Tree items are stored in a Map and looked up by ID for reliable expansion
- **Temp ID resolution (v2)** - Properly fix Datomic-style data imports
  - Query schema attributes with full type info via Datalog query
  - Rebuild schema map in correct format for `get-conn`
  - Entity references like `:movie/director -100` now properly resolve to real entity IDs

---

## [0.2.11] - 2024-11-28

### Fixed

- **Temp ID resolution** - Fix Datomic-style data imports with negative temp IDs (`{:db/id -100 ...}`)
  - Datalevin requires schema at connection time for ref resolution
  - Import now reopens connection with schema before transacting data with temp IDs
  - Entity references like `:movie/director -100` now properly resolve to real entity IDs

---

## [0.2.9] - 2024-11-28

### Added

- Auto-convert Datomic-style schema to Datalevin format during import
  - Datomic map format: `{:movie/title {:db/valueType :db.type/string ...}}`
  - Automatically converts to Datalevin vector format: `[{:db/ident :movie/title ...}]`
  - Removes incompatible `:db.install/_attribute` entries

---

## [0.2.8] - 2024-11-28

### Added

- **Import Data command** - Import schema and data from local EDN files or URLs
  - Right-click database → "Levin: Import Data"
  - Or use Command Palette: "Levin: Import Data"
  - Supports both local `.edn` files and remote URLs
  - Handles HTTP redirects automatically

---

## [0.2.7] - 2024-11-28

### Fixed

- Fix tree view expansion: Schema and Entities folders now properly expand to show children
- Extract itemType and dbPath from TreeItem id property for reliable tree navigation
- Fix entity inspector: Use `pull` API instead of `entity` API to avoid sci environment issues
- Entity hyperlinks in query results now work correctly

---

## [0.2.6] - 2024-11-28

### Fixed

- Fix EDN parser to strip leading colon from keywords when used as map keys
- Entity counts and namespaces now display correctly (was showing NaN/undefined)

---

## [0.2.5] - 2024-11-28

### Fixed

- Fix context menu commands (Edit Schema, Transaction Panel, New Query, Close Database) by reliably extracting dbPath from VS Code's serialized tree items
- Store dbPath in TreeItem `id` property which VS Code preserves during serialization
- Add `extractDbPath` helper function that checks multiple properties for robustness
- Fix entity counts using query instead of datoms API
- Add missing `copyQueryAsClojure` command
- Add saved query context menu commands (Open in Editor, Delete Query)

---

## [0.2.4] - 2024-11-28

### Fixed

- Fix context menu commands not receiving database path correctly
- Add null checks to prevent crashes when dbPath is undefined
- Handle VS Code's tree item serialization differences

---

## [0.2.3] - 2024-11-28

### Added

- Context menu items for databases:
  - "New Query" - Open a query editor for this database
  - "Open Transaction Panel" - Add/modify data
  - "Edit Schema" - View and add schema attributes

---

## [0.2.2] - 2024-11-28

### Fixed

- Fix dtlv exec command format - now properly wraps code with connection setup
- Use fully qualified `datalevin.core/` function names to avoid namespace shadowing in dtlv's sci environment
- Database creation now works correctly

---

## [0.2.1] - 2024-11-28

### Fixed

- Fix path quoting when executing dtlv CLI commands
- Paths containing `/` are now properly quoted to prevent parsing errors

---

## [0.2.0] - 2024-11-28

### Changed

- **Major Architecture Overhaul**: Switched from Calva REPL to direct `dtlv` CLI communication
  - Removed Calva extension dependency
  - No longer requires jack-in or REPL connection
  - Simpler, more straightforward workflow

### Added

- `Levin: Open Database` command - Open databases via folder picker
- `Levin: Create Database` command - Create new databases with one click
- `Levin: Close Database` command - Close open databases
- `levin.dtlvPath` setting - Customize path to dtlv executable
- Auto-load recently opened databases on startup
- Recent databases stored in settings

### Removed

- `Levin: Jack In` command - No longer needed
- Calva extension dependency
- Bootstrap Clojure code injection

### Dependencies

- Now requires only `dtlv` CLI (Datalevin command-line tool)

---

## [0.1.0] - 2024-11-28

### Added

- Initial release of Levin
- Database Explorer sidebar with tree view
  - Auto-discovery of databases via `.env` configuration
  - Schema browsing with type and property information
  - Entity counts by namespace
- Query Editor with `.dtlv.edn` file support
  - Syntax highlighting for Datalog queries
  - Autocomplete for schema attributes and keywords
  - CodeLens for running queries
  - Query history and saved queries
- Results Panel
  - Table view with sorting and pagination
  - Tree view for nested data
  - Raw EDN view
  - Export to CSV, JSON, EDN
- Entity Inspector
  - View entity attributes
  - Navigate references
  - Copy as EDN
- Schema Editor
  - Add new schema attributes
  - View existing schema
- Transaction Panel
  - Stage transactions
  - Validation and preview
  - Execute transact operations
- Calva integration
  - Jack-in with Datalevin dependency injection
  - Bootstrap code for database operations
- Commands and keybindings
  - Jack In (`Cmd+Alt+L J`)
  - New Query (`Cmd+Alt+L Q`)
  - Run Query (`Ctrl+Enter`)
  - Inspect Entity (`Cmd+Alt+L E`)
  - Refresh Explorer (`Cmd+Alt+L R`)
  - Export Results (`Cmd+Alt+L X`)

### Dependencies

- Requires Calva extension
- Datalevin 0.9.12 (configurable)
