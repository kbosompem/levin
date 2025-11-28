# Levin - VS Code Extension Specification

> **Levin** - Browse, query, and manage Datalevin in VS Code

## Overview

A VS Code extension providing a visual interface for Datalevin databases, leveraging Calva for all Clojure/REPL interactions. The extension auto-discovers databases via `.env` configuration and provides schema exploration, data viewing, and query execution capabilities.

- **Repository**: https://github.com/kbosompem/levin
- **Publisher**: Kay Bosompem
- **Marketplace**: VS Code Marketplace + Open VSX

## Core Architecture

### Dependencies

- **Required**: Calva extension (hard dependency)
- **Runtime**: Datalevin library loaded in connected REPL

### Design Philosophy

1. **Zero custom Clojure runtime** - All database operations execute through Calva's REPL connection
2. **Thin UI layer** - Extension is primarily VS Code webviews + tree views that format Calva evaluation results
3. **Convention-based discovery** - `.env` file defines database paths
4. **Local-only** - No REST/HTTP; direct filesystem access via REPL

---

## Configuration

### `.env` File Format

```env
# Datalevin database paths (semicolon-separated for multiple)
DATALEVIN_DBS=/path/to/db1;/path/to/db2;~/projects/myapp/data

# Optional: Default database (first one used if not specified)
DATALEVIN_DEFAULT_DB=/path/to/db1

# Optional: Auto-create databases if they don't exist
DATALEVIN_AUTO_CREATE=true
```

### VS Code Settings

```json
{
  "datalevin.envFile": ".env",
  "datalevin.autoJackIn": true,
  "datalevin.queryHistorySize": 100,
  "datalevin.resultPageSize": 50,
  "datalevin.theme": "auto"
}
```

---

## Features

### 1. Datalevin Jack-In

**Trigger**: Workspace contains `.env` with `DATALEVIN_DBS` defined

**Behavior**:
1. Detect `.env` file on workspace open
2. Show notification: "Datalevin databases found. Jack in?"
3. On confirm:
   - If no REPL connected: Trigger Calva jack-in with datalevin dependency injected
   - If REPL already connected: Inject datalevin require and connect to DBs
4. Execute bootstrap code via Calva:

```clojure
;; Injected on jack-in
(require '[datalevin.core :as d])

;; For each path in DATALEVIN_DBS
(def ^:dynamic *datalevin-connections* 
  (atom {"db1" (d/get-conn "/path/to/db1")
         "db2" (d/get-conn "/path/to/db2")}))

(defn datalevin-ext-get-conn [db-name]
  (get @*datalevin-connections* db-name))

(defn datalevin-ext-list-dbs []
  (keys @*datalevin-connections*))
```

**Jack-In deps.edn injection**:
```clojure
{:deps {datalevin/datalevin {:mvn/version "0.9.12"}}}
```

---

### 2. Sidebar: Database Explorer

**Location**: Activity Bar icon (lightning bolt - levin means lightning)

**Tree Structure**:
```
LEVIN DATABASES
├── 📁 myapp-db (connected)
│   ├── 📋 Schema
│   │   ├── :user/name (string, indexed)
│   │   ├── :user/email (string, unique)
│   │   ├── :user/created-at (instant)
│   │   ├── :post/title (string, fulltext)
│   │   ├── :post/author (ref)
│   │   └── :post/tags (ref, many)
│   ├── 📊 Entities (1,247)
│   │   ├── :user (89)
│   │   └── :post (1,158)
│   └── 🔍 Saved Queries
│       ├── All users
│       └── Recent posts
├── 📁 analytics-db (connected)
│   └── ...
└── ➕ Add Database...
```

**Implementation**:

Tree data fetched by evaluating via Calva:

```clojure
;; Get schema for tree view
(defn datalevin-ext-schema [db-name]
  (let [conn (datalevin-ext-get-conn db-name)
        schema (d/schema @conn)]
    (->> schema
         (map (fn [[attr props]]
                {:attribute attr
                 :valueType (:db/valueType props)
                 :cardinality (:db/cardinality props)
                 :unique (:db/unique props)
                 :index (:db/index props)
                 :fulltext (:db/fulltext props)}))
         (sort-by :attribute)
         vec)))

;; Get entity counts by attribute namespace
(defn datalevin-ext-entity-counts [db-name]
  (let [conn (datalevin-ext-get-conn db-name)
        db @conn]
    (->> (d/datoms db :eavt)
         (map (comp namespace :a))
         (remove nil?)
         frequencies
         (sort-by key)
         vec)))
```

**Context Menu Actions**:
- Database: Disconnect, Refresh, Open Query Editor, Copy Connection Path
- Schema Item: Copy Attribute, Find Usages, Show Sample Values
- Entity Namespace: Browse Entities, Count, Export

---

### 3. Query Editor

**Activation**: 
- Command: "Datalevin: New Query"
- Click "Query" icon on database in explorer
- File with `.dtlv.edn` extension

**Features**:

#### 3.1 Query File Support (`.dtlv.edn`)

```clojure
;; queries/find-users.dtlv.edn
{:db "myapp-db"
 :query [:find ?e ?name ?email
         :where
         [?e :user/name ?name]
         [?e :user/email ?email]]
 :args []
 :limit 50}
```

#### 3.2 Inline Execution (CodeLens)

Above each query form, show:
```
[▶ Run Query] [📋 Copy as Clojure] [💾 Save to Favorites]
```

#### 3.3 Query Execution

Wrap user query and execute via Calva:

```clojure
(defn datalevin-ext-query [db-name query args limit]
  (let [conn (datalevin-ext-get-conn db-name)
        db @conn
        results (apply d/q query db args)]
    {:total (count results)
     :results (take limit results)
     :truncated (> (count results) limit)}))
```

#### 3.4 Autocomplete

- Attribute names from schema (`:user/name`, `:post/title`)
- Query keywords (`:find`, `:where`, `:in`, `:keys`)
- Logic variables (`?e`, `?v`, `?tx`)
- Built-in predicates and functions

**Implementation**: Parse schema on connection, register CompletionItemProvider

#### 3.5 Syntax Highlighting

TextMate grammar for Datalog queries:
- Purple: Query keywords
- Blue: Attributes  
- Green: Logic variables
- Orange: Built-in functions

---

### 4. Results Panel

**Location**: Editor panel (like Problems/Output)

**Views**:

#### 4.1 Table View (Default)

| ?e | ?name | ?email |
|----|-------|--------|
| 1 | Alice | alice@example.com |
| 2 | Bob | bob@example.com |

**Features**:
- Column sorting (click header)
- Column resizing
- Pagination controls
- Export: CSV, EDN, JSON
- Click entity ID → Open Entity Inspector

#### 4.2 Tree View

For nested/ref results:
```
Entity 1
├── :user/name → "Alice"
├── :user/email → "alice@example.com"
└── :user/posts
    ├── Entity 42
    │   └── :post/title → "Hello World"
    └── Entity 43
        └── :post/title → "Second Post"
```

#### 4.3 Raw EDN View

```clojure
[[1 "Alice" "alice@example.com"]
 [2 "Bob" "bob@example.com"]]
```

---

### 5. Entity Inspector

**Activation**: Click entity ID anywhere in results

**Panel Content**:

```
ENTITY 42                                    [Edit] [Delete] [Copy EDN]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Attributes
──────────
:post/title        "Hello World"
:post/body         "This is my first post..."
:post/created-at   #inst "2024-01-15T10:30:00Z"
:post/author       → Entity 1 (:user/name "Alice")    [Navigate]
:post/tags         → [Entity 100, Entity 101]         [Expand]

References TO this entity
─────────────────────────
:comment/post from Entity 201, 202, 203 (3 total)    [Show All]

History
───────
tx 1001 (2024-01-15): Created
tx 1042 (2024-01-16): :post/title changed
tx 1089 (2024-01-17): :post/tags added
```

**Implementation**:

```clojure
(defn datalevin-ext-entity [db-name eid]
  (let [conn (datalevin-ext-get-conn db-name)
        db @conn
        entity (d/entity db eid)
        attrs (into {} entity)]
    {:eid eid
     :attributes attrs
     :references-to (d/q '[:find ?attr ?e
                           :in $ ?target
                           :where [?e ?attr ?target]]
                         db eid)}))

(defn datalevin-ext-entity-history [db-name eid]
  (let [conn (datalevin-ext-get-conn db-name)]
    (->> (d/datoms (d/history @conn) :eavt eid)
         (group-by :tx)
         (sort-by key)
         vec)))
```

---

### 6. Schema Editor

**Activation**: Right-click database → "Edit Schema" or click Schema node

**Interface**:

```
SCHEMA EDITOR: myapp-db                              [Save] [Cancel]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─ New Attribute ─────────────────────────────────────────────────────┐
│ Namespace: [user    ▼]  Name: [________________]                    │
│                                                                      │
│ Value Type:   ○ string  ○ long  ○ double  ○ boolean                 │
│               ○ instant ○ uuid  ○ ref     ○ bytes                   │
│                                                                      │
│ Cardinality:  ○ one     ○ many                                      │
│                                                                      │
│ Options:      ☐ indexed  ☐ unique  ☐ fulltext  ☐ isComponent        │
│                                                                      │
│                                               [+ Add Attribute]      │
└──────────────────────────────────────────────────────────────────────┘

Existing Attributes                                    [Filter: _____]
──────────────────
:user/name      string, one, indexed                        [Delete]
:user/email     string, one, unique                         [Delete]
:post/title     string, one, fulltext                       [Delete]
:post/author    ref, one                                    [Delete]
```

**Implementation**:

```clojure
(defn datalevin-ext-add-schema [db-name schema-map]
  (let [conn (datalevin-ext-get-conn db-name)]
    (d/transact! conn [{:db/ident (:attribute schema-map)
                        :db/valueType (:valueType schema-map)
                        :db/cardinality (:cardinality schema-map)
                        ;; ... other props
                        }])
    :ok))
```

---

### 7. Transaction Panel

**Purpose**: Stage and execute transactions

**Interface**:

```
TRANSACTION                                          [▶ Transact] [Clear]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

;; Add new entity
{:user/name "Charlie"
 :user/email "charlie@example.com"}

;; Update existing
{:db/id 42
 :post/title "Updated Title"}

;; Retract
[:db/retract 42 :post/draft true]

──────────────────────────────────────────────────────────────────────────
Preview (read-only):
  • ADD: :user/name "Charlie", :user/email "charlie@example.com"
  • UPDATE: Entity 42 :post/title → "Updated Title"  
  • RETRACT: Entity 42 :post/draft
```

**Implementation**:

```clojure
(defn datalevin-ext-transact [db-name tx-data]
  (let [conn (datalevin-ext-get-conn db-name)
        result (d/transact! conn tx-data)]
    {:tx-id (:max-tx result)
     :tempids (:tempids result)
     :datoms-added (count (:tx-data result))}))
```

---

### 8. Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| `levin.jackIn` | `Ctrl+Alt+L J` | Jack in with Datalevin |
| `levin.newQuery` | `Ctrl+Alt+L Q` | Open new query editor |
| `levin.runQuery` | `Ctrl+Enter` | Execute query under cursor |
| `levin.showEntity` | `Ctrl+Alt+L E` | Inspect entity by ID |
| `levin.refreshExplorer` | `Ctrl+Alt+L R` | Refresh database tree |
| `levin.exportResults` | `Ctrl+Alt+L X` | Export current results |
| `levin.addDatabase` | - | Add new database path |
| `levin.createDatabase` | - | Create new empty database |
| `levin.disconnect` | - | Disconnect from database |

---

## Implementation Details

### Project Structure

```
levin/
├── package.json
├── tsconfig.json
├── README.md
├── CHANGELOG.md
├── LICENSE
├── src/
│   ├── extension.ts              # Entry point, activation
│   ├── calva-bridge.ts           # All Calva REPL communication
│   ├── config/
│   │   ├── env-parser.ts         # .env file parsing
│   │   └── settings.ts           # VS Code settings
│   ├── providers/
│   │   ├── tree-provider.ts      # Database explorer tree
│   │   ├── completion-provider.ts # Query autocomplete
│   │   ├── codelens-provider.ts  # Run query buttons
│   │   └── hover-provider.ts     # Attribute info on hover
│   ├── views/
│   │   ├── results-panel.ts      # Query results webview
│   │   ├── entity-inspector.ts   # Entity detail webview
│   │   ├── schema-editor.ts      # Schema management webview
│   │   └── transaction-panel.ts  # Transaction staging
│   ├── clojure/
│   │   └── bootstrap.clj         # Clojure code injected on jack-in
│   └── utils/
│       ├── edn-parser.ts         # Parse EDN results
│       └── formatters.ts         # Display formatting
├── resources/
│   ├── icons/
│   │   ├── levin.svg             # Activity bar icon
│   │   └── levin-128.png         # Marketplace icon
│   └── webview/                  # Webview HTML/CSS/JS
├── syntaxes/
│   └── datalevin-query.tmLanguage.json
└── test/
```

### Calva Bridge API

```typescript
// src/calva-bridge.ts

import * as vscode from 'vscode';

export class CalvaBridge {
  private calvaApi: any;

  async initialize(): Promise<boolean> {
    const calva = vscode.extensions.getExtension('betterthantomorrow.calva');
    if (!calva) {
      vscode.window.showErrorMessage(
        'Datalevin extension requires Calva. Please install Calva first.'
      );
      return false;
    }
    this.calvaApi = await calva.activate();
    return true;
  }

  async isConnected(): Promise<boolean> {
    // Check if REPL session exists
    return this.calvaApi?.repl?.session != null;
  }

  async evaluate(code: string): Promise<EvalResult> {
    // Use Calva's evaluation API
    const result = await this.calvaApi.repl.evaluateCode(code, {
      stdout: (s: string) => console.log(s),
      stderr: (s: string) => console.error(s)
    });
    return this.parseResult(result);
  }

  async jackIn(depsOverride: object): Promise<void> {
    // Trigger Calva jack-in with datalevin dependency
    await vscode.commands.executeCommand('calva.jackIn', {
      projectType: 'deps.edn',
      depsEdnJackInAliasOverride: ':datalevin-ext',
      customDeps: {
        'datalevin/datalevin': {:mvn/version "0.9.12"}
      }
    });
  }

  async injectBootstrap(): Promise<void> {
    const bootstrap = await this.loadBootstrapCode();
    await this.evaluate(bootstrap);
  }
}
```

### Bootstrap Clojure Code

```clojure
;; src/clojure/bootstrap.clj
;; Injected into REPL on Datalevin jack-in

(ns datalevin-ext.core
  (:require [datalevin.core :as d]
            [clojure.edn :as edn]
            [clojure.string :as str]))

;; Connection management
(defonce ^:private connections (atom {}))

(defn connect-db! [db-name path & {:keys [create?] :or {create? false}}]
  (let [conn (if create?
               (d/get-conn path {})  ; empty schema, will be added later
               (d/get-conn path))]
    (swap! connections assoc db-name {:conn conn :path path})
    {:status :connected :db db-name :path path}))

(defn disconnect-db! [db-name]
  (when-let [{:keys [conn]} (get @connections db-name)]
    (d/close conn)
    (swap! connections dissoc db-name)
    {:status :disconnected :db db-name}))

(defn list-connections []
  (->> @connections
       (map (fn [[k v]] {:name k :path (:path v)}))
       vec))

;; Schema operations
(defn get-schema [db-name]
  (when-let [{:keys [conn]} (get @connections db-name)]
    (->> (d/schema @conn)
         (map (fn [[attr props]]
                {:attribute (str attr)
                 :valueType (some-> (:db/valueType props) name)
                 :cardinality (some-> (:db/cardinality props) name)
                 :unique (some-> (:db/unique props) name)
                 :index (:db/index props)
                 :fulltext (:db/fulltext props)
                 :isComponent (:db/isComponent props)}))
         (sort-by :attribute)
         vec)))

(defn add-schema! [db-name attr-map]
  (when-let [{:keys [conn]} (get @connections db-name)]
    (let [schema-entry (cond-> {:db/ident (keyword (:attribute attr-map))
                                :db/valueType (keyword "db.type" (:valueType attr-map))
                                :db/cardinality (keyword "db.cardinality" (:cardinality attr-map))}
                         (:unique attr-map) (assoc :db/unique (keyword "db.unique" (:unique attr-map)))
                         (:index attr-map) (assoc :db/index true)
                         (:fulltext attr-map) (assoc :db/fulltext true)
                         (:isComponent attr-map) (assoc :db/isComponent true))]
      (d/transact! conn [schema-entry])
      {:status :ok :attribute (:attribute attr-map)})))

;; Query operations
(defn run-query [db-name query-str & {:keys [args limit] :or {args [] limit 100}}]
  (when-let [{:keys [conn]} (get @connections db-name)]
    (let [query (edn/read-string query-str)
          db @conn
          results (apply d/q query db args)
          total (count results)]
      {:total total
       :truncated (> total limit)
       :results (vec (take limit results))})))

;; Entity operations
(defn get-entity [db-name eid]
  (when-let [{:keys [conn]} (get @connections db-name)]
    (let [db @conn
          entity (d/entity db eid)
          attrs (->> (keys entity)
                     (map (fn [k] [k (get entity k)]))
                     (into {}))]
      {:eid eid
       :attributes attrs})))

(defn get-entity-refs [db-name eid]
  (when-let [{:keys [conn]} (get @connections db-name)]
    (d/q '[:find ?attr ?e
           :in $ ?target
           :where [?e ?attr ?target]]
         @conn eid)))

;; Count entities by namespace
(defn entity-counts [db-name]
  (when-let [{:keys [conn]} (get @connections db-name)]
    (let [db @conn]
      (->> (d/datoms db :eavt)
           (map #(namespace (:a %)))
           (remove nil?)
           frequencies
           (map (fn [[ns cnt]] {:namespace ns :count cnt}))
           (sort-by :namespace)
           vec))))

;; Transaction operations  
(defn transact! [db-name tx-data-str]
  (when-let [{:keys [conn]} (get @connections db-name)]
    (let [tx-data (edn/read-string tx-data-str)
          result (d/transact! conn tx-data)]
      {:tx-id (:max-tx result)
       :tempids (:tempids result)
       :datoms-count (count (:tx-data result))})))

;; Sample data for attribute
(defn sample-values [db-name attr-str & {:keys [limit] :or {limit 10}}]
  (when-let [{:keys [conn]} (get @connections db-name)]
    (let [attr (keyword attr-str)]
      (->> (d/datoms @conn :aevt attr)
           (take limit)
           (map :v)
           vec))))

;; Full-text search (if fulltext attributes exist)
(defn fulltext-search [db-name attr-str search-term & {:keys [limit] :or {limit 50}}]
  (when-let [{:keys [conn]} (get @connections db-name)]
    (let [attr (keyword attr-str)]
      (vec (take limit (d/fulltext-datoms @conn attr search-term))))))

(println "[Datalevin Extension] Bootstrap loaded successfully")
```

---

## Activation Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        EXTENSION ACTIVATION                         │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │  Check Calva installed  │
                    └─────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼                           ▼
              [Installed]                [Not Installed]
                    │                           │
                    ▼                           ▼
         ┌──────────────────┐        ┌──────────────────────┐
         │  Look for .env   │        │  Show error message  │
         │  with DATALEVIN  │        │  "Install Calva"     │
         └──────────────────┘        └──────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
   [.env found]           [No .env]
        │                       │
        ▼                       ▼
┌───────────────────┐   ┌───────────────────┐
│ Show notification │   │ Register commands │
│ "Jack in?"        │   │ (manual mode)     │
└───────────────────┘   └───────────────────┘
        │
        ▼ (User clicks "Yes")
┌───────────────────────────────────────┐
│ 1. Parse .env for database paths      │
│ 2. Check if REPL already connected    │
│    - Yes: Inject bootstrap code       │
│    - No: Trigger Calva jack-in        │
│ 3. Connect to each database path      │
│ 4. Populate sidebar tree              │
│ 5. Show success notification          │
└───────────────────────────────────────┘
```

---

## Package.json (Complete)

```json
{
  "name": "levin",
  "displayName": "Levin",
  "description": "Browse, query, and manage Datalevin in VS Code",
  "version": "0.1.0",
  "publisher": "KayBosompem",
  "author": {
    "name": "Kay Bosompem"
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/kbosompem/levin"
  },
  "bugs": {
    "url": "https://github.com/kbosompem/levin/issues"
  },
  "homepage": "https://github.com/kbosompem/levin#readme",
  "icon": "resources/icons/levin-128.png",
  "galleryBanner": {
    "color": "#2C3E50",
    "theme": "dark"
  },
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": [
    "Programming Languages",
    "Data Science",
    "Other"
  ],
  "keywords": [
    "datalevin",
    "datalog",
    "clojure",
    "database",
    "datomic",
    "calva",
    "edn"
  ],
  
  "extensionDependencies": [
    "betterthantomorrow.calva"
  ],
  
  "activationEvents": [
    "workspaceContains:**/.env",
    "onLanguage:clojure",
    "onCommand:levin.jackIn"
  ],
  
  "main": "./out/extension.js",
  
  "contributes": {
    "commands": [
      {
        "command": "levin.jackIn",
        "title": "Levin: Jack In",
        "icon": "$(database)"
      },
      {
        "command": "levin.newQuery",
        "title": "Levin: New Query"
      },
      {
        "command": "levin.runQuery",
        "title": "Levin: Run Query"
      },
      {
        "command": "levin.showEntity",
        "title": "Levin: Inspect Entity"
      },
      {
        "command": "levin.refreshExplorer",
        "title": "Levin: Refresh Explorer"
      },
      {
        "command": "levin.exportResults",
        "title": "Levin: Export Results"
      },
      {
        "command": "levin.disconnect",
        "title": "Levin: Disconnect Database"
      },
      {
        "command": "levin.addDatabase",
        "title": "Levin: Add Database"
      },
      {
        "command": "levin.createDatabase",
        "title": "Levin: Create New Database"
      }
    ],
    
    "viewsContainers": {
      "activitybar": [
        {
          "id": "levin-explorer",
          "title": "Levin",
          "icon": "resources/icons/levin.svg"
        }
      ]
    },
    
    "views": {
      "levin-explorer": [
        {
          "id": "levin.databases",
          "name": "Databases"
        },
        {
          "id": "levin.savedQueries",
          "name": "Saved Queries"
        },
        {
          "id": "levin.history",
          "name": "Query History"
        }
      ]
    },
    
    "menus": {
      "view/title": [
        {
          "command": "levin.jackIn",
          "when": "view == levin.databases",
          "group": "navigation"
        },
        {
          "command": "levin.refreshExplorer",
          "when": "view == levin.databases",
          "group": "navigation"
        }
      ],
      "view/item/context": [
        {
          "command": "levin.newQuery",
          "when": "viewItem == database",
          "group": "inline"
        },
        {
          "command": "levin.disconnect",
          "when": "viewItem == database"
        }
      ]
    },
    
    "keybindings": [
      {
        "command": "levin.jackIn",
        "key": "ctrl+alt+l j",
        "mac": "cmd+alt+l j"
      },
      {
        "command": "levin.newQuery",
        "key": "ctrl+alt+l q",
        "mac": "cmd+alt+l q"
      },
      {
        "command": "levin.runQuery",
        "key": "ctrl+enter",
        "when": "editorLangId == datalevin-query"
      },
      {
        "command": "levin.refreshExplorer",
        "key": "ctrl+alt+l r",
        "mac": "cmd+alt+l r"
      }
    ],
    
    "languages": [
      {
        "id": "datalevin-query",
        "aliases": ["Datalevin Query", "dtlv"],
        "extensions": [".dtlv.edn"],
        "configuration": "./language-configuration.json"
      }
    ],
    
    "grammars": [
      {
        "language": "datalevin-query",
        "scopeName": "source.datalevin",
        "path": "./syntaxes/datalevin-query.tmLanguage.json"
      }
    ],
    
    "configuration": {
      "title": "Levin",
      "properties": {
        "levin.envFile": {
          "type": "string",
          "default": ".env",
          "description": "Path to .env file containing DATALEVIN_DBS"
        },
        "levin.autoJackIn": {
          "type": "boolean",
          "default": true,
          "description": "Automatically prompt to jack-in when .env with DATALEVIN_DBS found"
        },
        "levin.queryHistorySize": {
          "type": "number",
          "default": 100,
          "description": "Number of queries to keep in history"
        },
        "levin.resultPageSize": {
          "type": "number",
          "default": 50,
          "description": "Default page size for query results"
        },
        "levin.datalevinVersion": {
          "type": "string",
          "default": "0.9.12",
          "description": "Datalevin version to inject on jack-in"
        }
      }
    }
  },
  
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "pretest": "npm run compile && npm run lint",
    "lint": "eslint src --ext ts",
    "test": "node ./out/test/runTest.js",
    "package": "vsce package",
    "publish": "vsce publish",
    "publish:ovsx": "ovsx publish"
  },
  
  "devDependencies": {
    "@types/node": "^20.x",
    "@types/vscode": "^1.85.0",
    "@typescript-eslint/eslint-plugin": "^6.x",
    "@typescript-eslint/parser": "^6.x",
    "@vscode/test-electron": "^2.3.x",
    "@vscode/vsce": "^2.x",
    "eslint": "^8.x",
    "ovsx": "^0.8.x",
    "typescript": "^5.x"
  },
  
  "dependencies": {
    "dotenv": "^16.x",
    "edn-data": "^1.x"
  }
}

---

## Error Handling

### Connection Errors

| Error | User Message | Recovery |
|-------|--------------|----------|
| Calva not installed | "Datalevin requires Calva extension..." | Link to marketplace |
| REPL not connected | "No REPL connection. Jack in first?" | Offer jack-in button |
| DB path not found | "Database not found: /path/to/db" | Show path, offer create |
| DB locked | "Database locked by another process" | Suggest close other apps |
| Schema error | "Invalid schema definition: ..." | Highlight error in editor |

### Query Errors

```typescript
interface QueryError {
  type: 'syntax' | 'execution' | 'timeout';
  message: string;
  location?: { line: number; column: number };
  suggestion?: string;
}
```

Display in Results Panel with:
- Red error banner
- Clickable location (jumps to query editor)
- Suggested fix if available

---

## Testing Strategy

### Unit Tests
- `.env` parsing
- EDN result parsing
- Tree data transformation
- Query file validation

### Integration Tests
- Calva bridge communication
- Database connection lifecycle
- Query execution roundtrip
- Schema modification

### E2E Tests
- Full jack-in flow
- Query → Results → Entity navigation
- Export functionality

---

## Future Enhancements (v2+)

1. **Visual Query Builder** - Drag-and-drop query construction
2. **Schema Migrations** - Track and apply schema changes
3. **Data Import/Export** - CSV, JSON import wizards
4. **Query Optimization** - Explain plan, index suggestions
5. **Comparison View** - Diff two databases
6. **Time Travel** - Browse historical states
7. **Collaborative** - Share queries, schema designs

---

## Development Setup

```bash
# Clone and install
git clone https://github.com/kbosompem/levin
cd levin
npm install

# Compile TypeScript
npm run compile

# Watch mode
npm run watch

# Run extension in debug
# Press F5 in VS Code

# Package for distribution
npm run package

# Publish to VS Code Marketplace
npm run publish

# Publish to Open VSX
npm run publish:ovsx
```

---

## Publishing Checklist

### Before First Publish

1. **VS Code Marketplace**
   - Create publisher at https://marketplace.visualstudio.com/manage
   - Publisher name: `KayBosompem`
   - Get PAT from https://dev.azure.com (Marketplace scope)
   - `vsce login KayBosompem`

2. **Open VSX**
   - Create account at https://open-vsx.org (GitHub login)
   - Get token from https://open-vsx.org/user-settings/tokens
   - `ovsx publish -p <token>`

### Required Files
- [x] `package.json` - Complete with all metadata
- [ ] `README.md` - Marketplace landing page
- [ ] `CHANGELOG.md` - Version history
- [ ] `LICENSE` - MIT recommended
- [ ] `resources/icons/levin-128.png` - 128x128 marketplace icon
- [ ] `resources/icons/levin.svg` - Activity bar icon

### Publishing Commands
```bash
# Package without publishing (creates .vsix file)
vsce package

# Publish to VS Code Marketplace
vsce publish

# Publish to Open VSX
ovsx publish -p <your-token>

# Publish patch/minor/major version bump
vsce publish patch
vsce publish minor
vsce publish major
```

---

## Summary

**Levin** transforms VS Code into a powerful Datalevin IDE by:

1. **Leveraging Calva** - Zero custom runtime, all operations through established REPL
2. **Convention over configuration** - `.env` discovery makes setup trivial
3. **Visual exploration** - Tree views, result panels, entity inspection
4. **Developer ergonomics** - Autocomplete, syntax highlighting, keyboard shortcuts
5. **Safe transactions** - Preview before commit, history tracking

The thin client architecture means maintenance burden is minimal - the Clojure bootstrap code handles all database operations, and the TypeScript layer is pure UI orchestration.

---

## Links

- **Repository**: https://github.com/kbosompem/levin
- **VS Code Marketplace**: https://marketplace.visualstudio.com/items?itemName=KayBosompem.levin
- **Open VSX**: https://open-vsx.org/extension/KayBosompem/levin
- **Issues**: https://github.com/kbosompem/levin/issues
