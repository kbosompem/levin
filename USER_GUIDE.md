# Levin User Guide

A complete tour of Levin, the VS Code extension for [Datalevin](https://github.com/juji-io/datalevin) databases.

## Contents

1. [Prerequisites](#prerequisites)
2. [Your first five minutes](#your-first-five-minutes)
3. [Query files](#query-files)
4. [The playground files](#the-playground-files)
5. [Everyday workflows](#everyday-workflows)
6. [Panels tour](#panels-tour)
7. [Rules](#rules)
8. [Vector similarity search](#vector-similarity-search)
9. [Paredit and formatting](#paredit-and-formatting)
10. [Errors and diagnostics](#errors-and-diagnostics)
11. [Settings](#settings)
12. [Troubleshooting](#troubleshooting)

## Prerequisites

Levin talks to Datalevin through the `dtlv` CLI - no Clojure or REPL needed.

```bash
# macOS
brew install datalevin

# verify
dtlv --version
```

For Linux/Windows see the [README](README.md#2-install-datalevin-cli). If `dtlv` is not on your PATH, set `levin.dtlvPath` in VS Code settings.

## Your first five minutes

1. Open the Command Palette and run **Levin: Try Sample Playground**.
2. Pick a folder. Levin builds a seeded Mini-Northwind database (customers,
   orders, products, employees - with refs, rules, and vector embeddings)
   and writes five tutorial files next to it.
3. `01-basics.dtlv.edn` opens automatically. Click inside any query and press
   `Ctrl+Enter` (`Cmd+Enter` on macOS).
4. Results appear in the panel beside the editor. Click column headers to
   sort, switch to **Tree** for nested data, or export with the CSV/JSON/EDN
   buttons.

The Welcome page ("Get started with Levin" walkthrough) walks you through
the rest step by step. When you're ready for your own data, use
**Levin: Open Database** or **Levin: Create New Database** from the sidebar.

## Query files

Query files use the `.dtlv.edn` extension and hold as many statements as you
like, like a SQL script.

### Anatomy of a statement

```clojure
{:db "/path/to/database"
 :query [:find ?name ?price
         :where
         [?p :product/name ?name]
         [?p :product/unit-price ?price]]
 :limit 50}
```

| Key | Meaning |
|-----|---------|
| `:db` | Database path or `dtlv://` URI |
| `:query` | The Datalog query vector |
| `:transact` | Transaction data (alternative to `:query`) |
| `:limit` | Max rows returned (default 50) |
| `:rules` | Stored rules for `%`: `["name"]` or `:all` |
| `:args` | Values for the `:in` clause, in order |

### Multiple statements and `:db` inheritance

Only the first statement needs `:db` - everything below inherits it:

```clojure
{:db "/path/to/database"
 :query [:find ?e :where [?e :product/name _]]}

;; no :db here - uses the one above
[:find (count ?e) :where [?e :product/name _]]
```

The status bar (bottom left) shows which database the statement under your
cursor will hit. Click it to **pin** a different database to the file -
pins beat inheritance but never a statement's own `:db`.

### Running

- `Ctrl+Enter` - run the statement under the cursor
- `Ctrl+Shift+Enter` (`Cmd+Shift+Enter` on macOS) - run the whole file top to bottom
- The play buttons in the editor title, or the CodeLens above each statement

### Writing data

```clojure
{:transact [{:customer/company-name "New Customer"
            :customer/country "Spain"}]}
```

Unique-identity attributes make this safe to re-run (upsert, not duplicate).

### Sorting

Datalevin sorts in the engine with `:order-by` (Datomic has no equivalent):

```clojure
[:find ?name ?price
 :where
 [?p :product/name ?name]
 [?p :product/unit-price ?price]
 :order-by [?price :desc ?name :asc]]
```

## The playground files

| File | Teaches |
|------|---------|
| `01-basics` | Clauses, filters, aggregates, `:keys`, `get-else`, `:order-by` |
| `02-relationships` | Joins, nested `pull`, reverse refs, the Relationships panel |
| `03-rules` | `:in $ %`, the `:rules` key, a recursive org-chart rule |
| `04-vector-search` | `vec-neighbors` inline and combined with filters |
| `05-beyond-sql` | Fulltext, `:args`, in-memory joins, `:db/created-at`, `:transact` |

Recreate the playground any time: re-run **Levin: Try Sample Playground**
and choose "Recreate".

## Everyday workflows

**Save a query**: click the *Save* CodeLens above any statement. Saved
queries live in the sidebar's Saved Queries view, optionally in folders.

**Re-run anything**: the Query History view keeps your last runs
(`levin.queryHistorySize`, default 100).

**Inspect an entity**: click an entity id in results, or run
**Levin: Inspect Entity**. The inspector shows all attributes and lets you
walk references.

**Sort results**: click a column header in the results table; click again to
flip direction. Sorts the fetched rows (up to `:limit`).

**Export**: CSV / JSON / EDN buttons in the results panel, or
**Levin: Export Results**.

## Panels tour

Right-click a database in the sidebar (or use the Command Palette):

- **Browse Entities** - paginated grid of every entity, filter by namespace
- **View Relationships** - graph of ref attributes, built from actual data
- **Manage Rules** - create/edit stored Datalog rules
- **Vector Similarity Search** - pick an entity, see nearest neighbors
- **Open Transaction Panel** - stage, preview, and commit writes
- **Edit Schema** - view attributes, add new ones
- **Open Key-Value Store** - for KV databases

## Rules

Rules are named, reusable query clauses **stored in the database**
(`:levin.rule/*` entities), so every tool connected to the database can use
them.

Create them in the Rules panel, or seed them in code. A rule body is a
vector of clauses:

```clojure
[[(reports-to ?e ?m) [?e :employee/reportsto ?m]]
 [(reports-to ?e ?m) [?e :employee/reportsto ?b] (reports-to ?b ?m)]]
```

Use a rule with `:in $ %` plus the `:rules` statement key - Levin loads the
named rules for you:

```clojure
{:query [:find ?fname
         :in $ %
         :where
         [?boss :employee/first-name "Andrew"]
         (reports-to ?e ?boss)
         [?e :employee/first-name ?fname]]
 :rules ["reports-to"]}
```

`:rules :all` loads every rule in the database. Rules can be recursive -
the sample `reports-to` walks the whole org chart in three lines, no
recursive CTE required.

## Vector similarity search

Databases with `:db.type/vec` attributes get nearest-neighbor search inside
Datalog:

```clojure
[:find ?name ?dist
 :where
 [?src :product/name "Chai"]
 [?src :product/embedding ?q]
 [(vec-neighbors $ :product/embedding ?q {:top 5 :display :refs+dists})
  [[?e _ _ ?dist]]]
 [?e :product/name ?name]]
```

The binding for `:display :refs+dists` is `[[?e _ _ ?dist]]` (entity,
attribute, vector, distance). `:display :refs` binds `[[?e _]]`.

**Heads-up**: Datalevin requires the vector dimensions on *every* connection.
Levin remembers them per database when it creates one; for databases created
elsewhere it asks once ("vector dimensions?") and remembers your answer.

## Paredit and formatting

**Format Document** (`Shift+Alt+F`) reindents canonically - idempotent,
comment-preserving. Enable format-on-save for query files:

```json
{
  "[datalevin-query]": {
    "editor.formatOnSave": true
  }
}
```

Structural editing (keybindings shown for Windows/Linux; use `Cmd` on macOS):

| Command | Keys | What it does |
|---------|------|--------------|
| Forward / Backward S-Expression | `Ctrl+Alt+→` / `Ctrl+Alt+←` | Move by form |
| Slurp Forward | `Ctrl+Alt+]` | Pull the next form into this one |
| Barf Forward | `Ctrl+Alt+[` | Push the last form out |
| Wrap with `( )` / `[ ]` | `Ctrl+Alt+W` / `Ctrl+Alt+Shift+W` | Wrap the next form |
| Raise | `Ctrl+Alt+R` | Replace the parent with this form |
| Splice | `Ctrl+Alt+S` | Remove the enclosing brackets |

Brackets auto-close and surround selections out of the box.

## Errors and diagnostics

Two layers keep mistakes cheap:

- **While you type**: unbalanced forms and malformed `:where` clauses
  squiggle in the editor (Problems panel has details).
- **When you run**: failures render in the results panel - a friendly
  summary, the query with the offending clause marked, and the full stack
  trace tucked behind a details toggle.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `levin.dtlvPath` | `"dtlv"` | Path to the dtlv executable |
| `levin.queryHistorySize` | `100` | Queries kept in history |
| `levin.resultPageSize` | `50` | Results per page |
| `levin.recentDatabases` | `[]` | Auto-populated recent databases |

## Troubleshooting

**"Datalevin CLI (dtlv) not found"** - install `dtlv` (see Prerequisites) or
set `levin.dtlvPath` to its full path.

**A database with vectors fails every query** - Datalevin needs vector
dimensions on every connection. Levin asks once and remembers; if you
answered wrong, delete the `levin.vectorOpts` entry for that path in VS
Code's global state (or just answer again next time after fixing).

**`:order-by` does nothing / errors** - you may be on an old `dtlv`;
`dtlv --version` should be 0.9.20+ (this guide was verified against 0.10.7).

**Reverse refs return nothing in a `:where` pattern** - on current Datalevin,
reverse lookup (`:order/_customer`) works in `pull` but not in data
patterns. Use pull for backward traversal.

**Results look truncated** - raise `:limit` on the statement; the panel
paginates what it fetched and tells you when results were truncated.
