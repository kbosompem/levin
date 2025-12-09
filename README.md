# Levin

> Browse, query, and manage Datalevin databases in VS Code

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/KwabenaBosompem.levin?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=KwabenaBosompem.levin)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/KwabenaBosompem.levin)](https://marketplace.visualstudio.com/items?itemName=KwabenaBosompem.levin)

**Levin** (archaic English for "lightning") is a VS Code extension that provides a visual interface for [Datalevin](https://github.com/juji-io/datalevin) databases. It communicates directly with the `dtlv` CLI, requiring no REPL or Clojure setup.

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

## Installation

### 1. Install the Levin Extension

**From VS Code Marketplace (Recommended):**
- Open VS Code
- Go to Extensions (`Cmd+Shift+X` / `Ctrl+Shift+X`)
- Search for "Levin"
- Click Install

**Or from command line:**
```bash
code --install-extension KwabenaBosompem.levin
```

### 2. Install Datalevin CLI

Levin requires the `dtlv` command-line tool to be installed and available in your PATH.

#### macOS

**Using Homebrew (recommended):**
```bash
brew install datalevin
```

**Or download the binary:**
```bash
# Download the latest release
curl -L https://github.com/juji-io/datalevin/releases/latest/download/dtlv-0.9.27-macos-amd64.zip -o dtlv.zip

# For Apple Silicon (M1/M2/M3):
curl -L https://github.com/juji-io/datalevin/releases/latest/download/dtlv-0.9.27-macos-aarch64.zip -o dtlv.zip

# Extract and install
unzip dtlv.zip
sudo mv dtlv /usr/local/bin/
chmod +x /usr/local/bin/dtlv
```

#### Linux

```bash
# Download the latest release (x64)
curl -L https://github.com/juji-io/datalevin/releases/latest/download/dtlv-0.9.27-linux-amd64.zip -o dtlv.zip

# For ARM64:
curl -L https://github.com/juji-io/datalevin/releases/latest/download/dtlv-0.9.27-linux-aarch64.zip -o dtlv.zip

# Extract and install
unzip dtlv.zip
sudo mv dtlv /usr/local/bin/
chmod +x /usr/local/bin/dtlv
```

#### Windows

1. Download the latest release from [Datalevin releases](https://github.com/juji-io/datalevin/releases)
   - Choose `dtlv-X.X.X-windows-amd64.zip`
2. Extract `dtlv.exe` to a folder (e.g., `C:\Program Files\Datalevin\`)
3. Add that folder to your PATH:
   - Open System Properties → Environment Variables
   - Edit the `Path` variable and add `C:\Program Files\Datalevin\`
4. Restart VS Code

#### Verify Installation

```bash
dtlv --version
# Should output: Datalevin (version: X.X.X)
```

### 3. Configure (Optional)

If `dtlv` is not in your PATH, you can specify its location in VS Code settings:

```json
{
  "levin.dtlvPath": "/path/to/dtlv"
}
```

## Quick Start

1. Open the Levin sidebar (lightning bolt icon in the Activity Bar)
2. Click "Open Database..." or use `Cmd+Alt+L O` (Mac) / `Ctrl+Alt+L O` (Windows/Linux)
3. Choose "Datalog Database" or "Key-Value Store"
4. Select a local folder or enter a remote server URI
5. Start exploring!

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

### Formatting .dtlv.edn Files

For formatting query files, install the [cljfmt extension](https://marketplace.visualstudio.com/items?itemName=pedrorgirardi.cljfmt):

1. Install the `cljfmt` extension by pedrorgirardi
2. Add to your `settings.json`:
   ```json
   {
     "files.associations": {
       "*.dtlv.edn": "clojure"
     },
     "[clojure]": {
       "editor.defaultFormatter": "pedrorgirardi.cljfmt",
       "editor.formatOnSave": true
     }
   }
   ```

**Note**: This changes `.dtlv.edn` files to Clojure mode, which removes the CodeLens "Run Query" button. You can still run queries with `Ctrl+Enter` or the Command Palette.

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
