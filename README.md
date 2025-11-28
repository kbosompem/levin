# Levin

> Browse, query, and manage Datalevin databases in VS Code

**Levin** (meaning "lightning" in German) is a VS Code extension that provides a visual interface for [Datalevin](https://github.com/juji-io/datalevin) databases. It leverages [Calva](https://calva.io) for all Clojure/REPL interactions, giving you a powerful database explorer right in your editor.

## Features

### Database Explorer
- Auto-discover databases via `.env` configuration
- Browse schema attributes with type information
- View entity counts by namespace
- Navigate database structure in the sidebar

### Query Editor
- Dedicated `.dtlv.edn` file support for Datalevin queries
- Syntax highlighting for Datalog queries
- Autocomplete for schema attributes and query keywords
- CodeLens for running queries directly from the editor
- Query history and saved queries

### Results Panel
- Table view with sorting and pagination
- Tree view for nested/referenced data
- Raw EDN view
- Export to CSV, JSON, or EDN
- Click entity IDs to inspect

### Entity Inspector
- View all attributes of an entity
- Navigate entity references
- Copy entity data as EDN

### Schema Editor
- Add new schema attributes
- View existing schema with properties

### Transaction Panel
- Stage and preview transactions
- Execute transact operations
- Validation before commit

## Requirements

- **Calva extension** - Levin requires Calva for REPL connectivity
- **Datalevin** - The Datalevin library must be available in your REPL

## Quick Start

1. Install the Levin extension
2. Create a `.env` file in your workspace root:

```env
# Datalevin database paths (semicolon-separated for multiple)
DATALEVIN_DBS=/path/to/db1;/path/to/db2

# Optional: Default database
DATALEVIN_DEFAULT_DB=/path/to/db1
```

3. Open the Levin sidebar (lightning bolt icon)
4. Click "Jack In" or use `Cmd+Alt+L J` (Mac) / `Ctrl+Alt+L J` (Windows/Linux)
5. Start exploring your databases!

## Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| `Levin: Jack In` | `Cmd+Alt+L J` | Connect to Datalevin with REPL |
| `Levin: New Query` | `Cmd+Alt+L Q` | Open new query editor |
| `Levin: Run Query` | `Ctrl+Enter` | Execute query under cursor |
| `Levin: Inspect Entity` | `Cmd+Alt+L E` | Inspect entity by ID |
| `Levin: Refresh Explorer` | `Cmd+Alt+L R` | Refresh database tree |
| `Levin: Export Results` | `Cmd+Alt+L X` | Export current results |

## Query File Format

Create `.dtlv.edn` files for your queries:

```clojure
{:db "myapp-db"
 :query [:find ?e ?name ?email
         :where
         [?e :user/name ?name]
         [?e :user/email ?email]]
 :args []
 :limit 50}
```

## Configuration

```json
{
  "levin.envFile": ".env",
  "levin.autoJackIn": true,
  "levin.queryHistorySize": 100,
  "levin.resultPageSize": 50,
  "levin.datalevinVersion": "0.9.12"
}
```

## Development

```bash
# Clone and install
git clone https://github.com/kbosompem/levin
cd levin
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Run extension in debug mode
# Press F5 in VS Code

# Package
npm run package
```

## Architecture

Levin follows a thin-client architecture:

1. **Zero custom Clojure runtime** - All database operations execute through Calva's REPL connection
2. **Convention-based discovery** - `.env` file defines database paths
3. **Local-only** - Direct filesystem access via REPL, no HTTP

The extension injects bootstrap Clojure code on jack-in that provides all database operations.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [Repository](https://github.com/kbosompem/levin)
- [Issues](https://github.com/kbosompem/levin/issues)
- [Datalevin](https://github.com/juji-io/datalevin)
- [Calva](https://calva.io)

---

Made with lightning by [Kay Bosompem](https://github.com/kbosompem)
