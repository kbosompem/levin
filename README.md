# Levin

> Browse, query, and manage Datalevin databases in VS Code

**Levin** (meaning "lightning" in German) is a VS Code extension that provides a visual interface for [Datalevin](https://github.com/juji-io/datalevin) databases. It communicates directly with the `dtlv` CLI, requiring no REPL or Clojure setup.

## Features

### Database Explorer
- Open local databases via folder picker
- Connect to remote Datalevin servers with `dtlv://` URIs
- Browse schema attributes with type information
- View entity counts by namespace
- Navigate database structure in the sidebar
- Auto-load recently opened databases

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

- **Datalevin CLI (`dtlv`)** - Install Datalevin and ensure `dtlv` is in your PATH
  - Via Homebrew: `brew install datalevin`
  - Or download from [Datalevin releases](https://github.com/juji-io/datalevin/releases)

## Quick Start

1. Install the Levin extension
2. Ensure `dtlv` CLI is installed and in your PATH
3. Open the Levin sidebar (lightning bolt icon)
4. Click "Open Database" or use `Cmd+Alt+L O` (Mac) / `Ctrl+Alt+L O` (Windows/Linux)
5. Choose "Local Database" or "Remote Server"
6. Start exploring!

### Opening a Local Database

1. Click "Open Database" and select "Local Database"
2. Select a Datalevin database folder
3. The database will appear in the sidebar

### Connecting to a Remote Server

1. Click "Open Database" and select "Remote Server"
2. Enter the server URI in the format: `dtlv://username:password@host:port/database`
   - Example: `dtlv://datalevin:datalevin@192.168.1.113:8898/ontology`
   - Without auth: `dtlv://192.168.1.113:8898/test-db`
3. The remote database will appear in the sidebar with a remote icon

### Creating a New Database

1. Click "Create Database" in the sidebar or use `Cmd+Alt+L C`
2. Enter the database name
3. Select the parent folder
4. The new database is created and opened automatically

## Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| `Levin: Open Database` | `Cmd+Alt+L O` | Open an existing database |
| `Levin: Create Database` | `Cmd+Alt+L C` | Create a new database |
| `Levin: Close Database` | `Cmd+Alt+L D` | Close a database |
| `Levin: New Query` | `Cmd+Alt+L Q` | Open new query editor |
| `Levin: Run Query` | `Ctrl+Enter` | Execute query under cursor |
| `Levin: Inspect Entity` | `Cmd+Alt+L E` | Inspect entity by ID |
| `Levin: Refresh Explorer` | `Cmd+Alt+L R` | Refresh database tree |
| `Levin: Export Results` | `Cmd+Alt+L X` | Export current results |

## Query File Format

Create `.dtlv.edn` files for your queries:

```clojure
;; Local database
{:db "/path/to/database"
 :query [:find ?e ?name ?email
         :where
         [?e :user/name ?name]
         [?e :user/email ?email]]
 :args []
 :limit 50}

;; Remote server
{:db "dtlv://username:password@host:port/database"
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
  "levin.dtlvPath": "dtlv",
  "levin.queryHistorySize": 100,
  "levin.resultPageSize": 50,
  "levin.recentDatabases": []
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `levin.dtlvPath` | `"dtlv"` | Path to dtlv executable |
| `levin.queryHistorySize` | `100` | Number of queries to keep in history |
| `levin.resultPageSize` | `50` | Results per page in table view |
| `levin.recentDatabases` | `[]` | Auto-populated list of recent databases |

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

Levin uses a simple CLI-based architecture:

1. **Direct CLI communication** - All database operations execute through the `dtlv` command-line tool
2. **No REPL required** - No need for Clojure, Calva, or jack-in workflows
3. **Local & Remote support** - Works with local databases and remote Datalevin servers
4. **Stateless** - Each operation is independent

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [Repository](https://github.com/kbosompem/levin)
- [Issues](https://github.com/kbosompem/levin/issues)
- [Datalevin](https://github.com/juji-io/datalevin)

---

Made with lightning by [Kay Bosompem](https://github.com/kbosompem)
