# Changelog

All notable changes to the Levin extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
