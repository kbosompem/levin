# Levin

> Browse, query, and manage Datalevin databases in VS Code

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/KwabenaBosompem.levin?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=KwabenaBosompem.levin)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/KwabenaBosompem.levin)](https://marketplace.visualstudio.com/items?itemName=KwabenaBosompem.levin)
[![levin-bb engine](https://img.shields.io/github/v/release/kbosompem/babashka?filter=levin-bb-*&label=levin-bb%20engine)](https://github.com/kbosompem/babashka/releases)

**Levin** (archaic English for "lightning") is a VS Code extension that provides a visual interface for [Datalevin](https://github.com/juji-io/datalevin) databases. It runs on **levin-bb**, a bundled query engine (a custom [babashka](https://github.com/babashka/babashka) build with Datalevin and [core.logic](https://github.com/clojure/core.logic) compiled in) that Levin downloads for you on first run - no REPL, Clojure setup, or separate install required. The `dtlv` CLI works as a fallback backend.

**New here?** Run **Levin: Try Sample Playground** from the Command Palette - one click builds a seeded demo database with five guided query files that teach every feature. See the [User Guide](USER_GUIDE.md) for the full tour.

## Features

### Guided Onboarding
- **Sample Playground** - one command builds a seeded Mini-Northwind database (schema, data, rules, embeddings) plus five guided `.dtlv.edn` tutorial files
- **Get Started walkthrough** - step-by-step tour on VS Code's Welcome page, deep-linking into every panel
- **Welcome views** - empty sidebars offer the next action instead of blank space

### Query Editor
- Dedicated `.dtlv.edn` file support for Datalevin queries
- **Multiple statements per file** - run the one under the cursor with `Ctrl+Enter`, or the whole file with `Ctrl+Shift+Enter`
- **`:db` inheritance** - name the database once; later statements reuse it
- **Parameterized queries** - `:args` feeds values to `:in`; `:rules` loads stored rules for `%`
- **Live diagnostics** - malformed `:where` clauses and unbalanced forms squiggle as you type
- **Status bar database pinning** - each file shows and remembers its target database, SQL-tool style
- Syntax highlighting, autocomplete for schema attributes and query keywords, CodeLens
- Query history and saved queries

### Results Panel
- Table view with **click-to-sort column headers** and pagination
- Tree view for nested data - pull results expand recursively
- Raw EDN view
- Export to CSV, JSON, or EDN
- Entity IDs link to the Entity Inspector (only real entity columns, not every integer)
- **Friendly error view** - query failures render inline with the offending clause called out, no scary stack-trace page

### Paredit & Formatting
- Built-in structural formatter (Format Document works out of the box)
- Paredit commands: wrap, slurp, barf, raise, splice, forward/backward s-expression
- Brackets auto-close and stay balanced

### Database Explorer
- Open local databases via folder picker
- Connect to remote Datalevin servers with `dtlv://` URIs
- Browse schema attributes with type information
- View entity counts by namespace
- Navigate database structure in the sidebar
- Auto-load recently opened databases

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

### Rules & Vector Search
- Store and manage named Datalog rules in the database
- Vector similarity search panel for `:db.type/vec` attributes
- `vec-neighbors` works inline in queries, combined with any other clause

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

### 2. Get a Query Engine

**levin-bb (recommended, automatic):** on first activation Levin offers to download its bundled engine - a single binary with Datalevin 0.10.18 and core.logic built in (macOS arm64/x64, Linux amd64/arm64). One persistent process serves all queries, so they run in milliseconds instead of paying a process spawn each time. Accept the prompt and you're done; binaries come from [levin-bb releases](https://github.com/kbosompem/babashka/releases).

```json
// Optional: point at your own copy instead of auto-detection
{
  "levin.bbPath": "/path/to/levin-bb"
}
```

**dtlv (fallback, and Windows):** Levin also works with the `dtlv` command-line tool on your PATH. This is currently the only backend on Windows.

<details>
<summary>Installing dtlv</summary>

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

</details>

### 3. Configure (Optional)

Backend selection is automatic: `levin.bbPath` setting → downloaded engine → bundled `bin/levin-bb` → `levin-bb` on PATH → `dtlv`. Override either binary's location in VS Code settings:

```json
{
  "levin.bbPath": "/path/to/levin-bb",
  "levin.dtlvPath": "/path/to/dtlv"
}
```

## Quick Start

**Fastest path:** Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) → **Levin: Try Sample Playground** → pick a folder. Levin builds a seeded Mini-Northwind database and opens `01-basics.dtlv.edn`. Put the cursor in a query and press `Ctrl+Enter`. The Welcome page's "Get started with Levin" walkthrough guides you from there.

**With your own database:**

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
| `Levin: Try Sample Playground` | | Build the seeded sample database + tutorial files |
| `Levin: Open Database` | `Cmd+Alt+L O` | Open an existing database |
| `Levin: Create Database` | `Cmd+Alt+L C` | Create a new database |
| `Levin: Close Database` | `Cmd+Alt+L D` | Close a database |
| `Levin: New Query` | `Cmd+Alt+L Q` | Open new query editor |
| `Levin: Run Query` | `Ctrl+Enter` | Execute the statement under cursor |
| `Levin: Run All Queries in File` | `Ctrl+Shift+Enter` (`Cmd+Shift+Enter` on macOS) | Execute all statements in the file, in order |
| `Levin: Pin Database to This File` | | Pin a connection (also: click the status bar item) |
| `Levin: Inspect Entity` | `Cmd+Alt+L E` | Inspect entity by ID |
| `Levin: Refresh Explorer` | `Cmd+Alt+L R` | Refresh database tree |
| `Levin: Export Results` | `Cmd+Alt+L X` | Export current results |
| `Levin: Paredit Forward/Backward S-Expression` | `Ctrl+Alt+→` / `Ctrl+Alt+←` | Move by form |
| `Levin: Paredit Slurp/Barf Forward` | `Ctrl+Alt+]` / `Ctrl+Alt+[` | Grow/shrink the enclosing form |
| `Levin: Paredit Wrap with ( ) / [ ]` | `Ctrl+Alt+W` / `Ctrl+Alt+Shift+W` | Wrap the next form |
| `Levin: Paredit Raise` | `Ctrl+Alt+R` | Replace parent with this form |
| `Levin: Paredit Splice` | `Ctrl+Alt+S` | Remove enclosing brackets |

(Paredit keybindings show `Ctrl` — on macOS they are `Cmd`.)

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

### Multiple Statements per File

A `.dtlv.edn` file can hold as many statements as you like, like a SQL script.
Each statement gets its own CodeLens buttons, and `Ctrl+Enter` runs only the
statement under the cursor (when the cursor is between statements, the nearest
one runs):

```clojure
;; Set the database once...
{:db "/path/to/database"}

;; ...then write bare queries below it
[:find ?e :where [?e :user/name _]]

[:find (count ?e) :where [?e :user/name _]]

;; Or keep each statement self-contained
{:db "/path/to/database"
 :query [:find ?n :where [_ :user/name ?n]]
 :limit 10}

{:db "/path/to/database"
 :transact [{:user/name "Ada"}]}
```

- A bare `[:find ...]` query uses the `:db` of the nearest statement above it;
  if the file has no `:db` anywhere, you are asked to pick a database.
- `Ctrl+Shift+Enter` runs every statement in the file from top to bottom
  (stops at the first failure); a `Run All Queries` CodeLens also appears at
  the top of files with more than one statement.

### Statement Keys

| Key | Meaning |
|-----|---------|
| `:db` | Database path or `dtlv://` URI. Only needed once - later statements inherit it (a status-bar pin overrides inheritance) |
| `:query` | The Datalog query vector |
| `:transact` | Transaction data to write (instead of `:query`) |
| `:limit` | Max rows returned (default 50) |
| `:rules` | Stored rule names to load for `%`, e.g. `["reports-to"]`, or `:all` |
| `:args` | Extra values for the `:in` clause, in order |

### Parameterized queries and rules

```clojure
;; :args feeds the :in clause - no string concatenation
{:query [:find ?date
         :in $ ?company
         :where
         [?o :order/customer ?c]
         [?o :order/order-date ?date]
         [?c :customer/company-name ?company]]
 :args ["La maison d'Asie"]}

;; :rules loads stored rules for the % input
{:query [:find ?fname
         :in $ %
         :where
         [?boss :employee/first-name "Andrew"]
         (reports-to ?e ?boss)
         [?e :employee/first-name ?fname]]
 :rules ["reports-to"]}
```

### Sorting

Datalevin supports `:order-by` directly in queries (Datomic does not!):

```clojure
[:find ?name ?price
 :where
 [?p :product/name ?name]
 [?p :product/unit-price ?price]
 :order-by [?price :desc ?name :asc]]
```

You can also click any column header in the results panel to sort the
fetched rows.

## Configuration

```json
{
  "levin.bbPath": "",
  "levin.dtlvPath": "dtlv",
  "levin.queryHistorySize": 100,
  "levin.resultPageSize": 50,
  "levin.recentDatabases": []
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `levin.bbPath` | `""` | Path to the levin-bb engine (empty = auto-detect/download) |
| `levin.dtlvPath` | `"dtlv"` | Path to dtlv executable (fallback backend) |
| `levin.queryHistorySize` | `100` | Number of queries to keep in history |
| `levin.resultPageSize` | `50` | Results per page in table view |
| `levin.recentDatabases` | `[]` | Auto-populated list of recent databases |

### Formatting .dtlv.edn Files

Levin ships a built-in structural formatter - no extra extension needed.
**Format Document** (`Shift+Alt+F`) reindents the file canonically:

```clojure
{:db "/tmp/shop"
 :query [:find ?name ?price
         :where
         [?p :product/name ?name]
         [?p :product/unit-price ?price]]
 :limit 50}
```

Formatting is idempotent and preserves your comments. To format on save:

```json
{
  "[datalevin-query]": {
    "editor.formatOnSave": true
  }
}
```

The paredit commands (see Commands table) keep structure intact while you
edit; brackets also auto-close via the language configuration.

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

Levin keeps the tooling out of your way:

1. **Bundled engine** - database operations run in one persistent [levin-bb](https://github.com/kbosompem/babashka/releases) process (a custom babashka build with Datalevin + core.logic compiled in), speaking newline-delimited JSON over stdio; warm queries return in milliseconds. With the `dtlv` fallback backend, each operation spawns a fresh CLI process instead.
2. **No REPL required** - No need for Clojure, Calva, or jack-in workflows
3. **Local & Remote support** - Works with local databases and remote Datalevin servers
4. **Independent operations** - each request opens, uses, and releases the database, so nothing is left locked between queries

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [Repository](https://github.com/kbosompem/levin)
- [Issues](https://github.com/kbosompem/levin/issues)
- [Datalevin](https://github.com/juji-io/datalevin)

---

Made with lightning by [Kay Bosompem](https://github.com/kbosompem)
