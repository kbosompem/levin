/**
 * Templates for the numbered .dtlv.edn playground files created by
 * `levin.trySampleDatabase`. Each file teaches one capability against the
 * Mini-Northwind sample database. Only the first statement of each file
 * carries :db - the rest inherit it (file-level connection).
 *
 * Every query shape used here was verified against dtlv 0.10.7.
 */

export interface PlaygroundFile {
    name: string;
    content: string;
}

const header = (title: string, dbPath: string, lines: string[]): string =>
    `;; ${title}
${lines.map(l => `;; ${l}`).join('\n')}
;;
;; Run the statement under the cursor with Ctrl+Enter (macOS: Cmd+Enter),
;; or the whole file with Ctrl+Shift+Enter (macOS: Cmd+Shift+Enter).
;; Only the first statement names :db - every later statement reuses it.

{:db "${dbPath}"
 :query [:find ?name ?price
         :where
         [?p :product/name ?name]
         [?p :product/unit-price ?price]]
 :limit 50}`;

export function playgroundFiles(dbPath: string): PlaygroundFile[] {
    return [
        {
            name: '01-basics.dtlv.edn',
            content: `${header('01 - Query basics', dbPath, [
                'The classic SELECT: pattern-matching clauses over datoms.'
            ])}

;; Filters are just more clauses. Products over 15.0:
{:query [:find ?name ?price
         :where
         [?p :product/name ?name]
         [?p :product/unit-price ?price]
         [(> ?price 15.0)]]
 :limit 50}

;; Aggregates live in :find. How many products, total and average price:
{:query [:find (count ?p) (sum ?price) (avg ?price)
         :where
         [?p :product/unit-price ?price]]
 :limit 50}

;; Datalevin sorts IN the engine with :order-by - Datomic has no such thing.
;; Each key takes an optional direction; multiple keys compose:
{:query [:find ?name ?price
         :where
         [?p :product/name ?name]
         [?p :product/unit-price ?price]
         :order-by [?price :desc ?name :asc]]
 :limit 50}

;; :keys names the columns of each result map:
{:query [:find ?name ?price
         :keys name price
         :where
         [?p :product/name ?name]
         [?p :product/unit-price ?price]]
 :limit 50}

;; get-else supplies a default when an attribute is missing.
;; (Margaret Peacock has no :employee/title in the sample data.)
{:query [:find ?lname ?title
         :where
         [?e :employee/last-name ?lname]
         [(get-else $ ?e :employee/title "(no title)") ?title]]
 :limit 50}
`
        },
        {
            name: '02-relationships.dtlv.edn',
            content: `${header('02 - Relationships', dbPath, [
                'References are first-class: joins are ordinary clauses,',
                'and pull walks the graph in either direction.'
            ])}

;; Join through a ref: which customer placed each order?
{:query [:find ?company ?date
         :where
         [?o :order/customer ?c]
         [?o :order/order-date ?date]
         [?c :customer/company-name ?company]]
 :limit 50}

;; Three hops: order details -> product -> supplier country.
{:query [:find ?product ?country (sum ?qty)
         :where
         [?d :orderdetail/product ?p]
         [?d :orderdetail/quantity ?qty]
         [?p :product/name ?product]
         [?p :product/supplier ?s]
         [?s :supplier/country ?country]]
 :limit 50}

;; pull shapes results as nested documents - SQL gives you flat rows,
;; Mongo gives you documents but no joins. This is both at once:
{:query [:find (pull ?o [:order/order-date
                        {:order/customer [:customer/company-name]}
                        {:order/employee [:employee/first-name :employee/last-name]}])
         :where
         [?o :order/order-date _]]
 :limit 50}

;; pull also walks refs backwards: a customer with all their orders.
{:query [:find (pull ?c [:customer/company-name
                        {:order/_customer [:order/order-date]}])
         :where
         [?c :customer/company-name "Around the Horn"]]
 :limit 50}

;; Try it visually: right-click the database in the Levin sidebar and
;; choose "Levin: View Relationships", or run the command.
;;   levin.showRelationships
`
        },
        {
            name: '03-rules.dtlv.edn',
            content: `${header('03 - Rules', dbPath, [
                'Named, reusable query logic stored IN the database.',
                'The sample DB ships two rules - browse them with the',
                '"Levin: Manage Rules" command. Use them via :in $ % and',
                'the :rules key (Levin loads the named rules for you).'
            ])}

;; "affordable" is a one-clause rule: products under 20.0.
{:query [:find ?name ?price
         :in $ %
         :where
         [?p :product/name ?name]
         [?p :product/unit-price ?price]
         (affordable ?p)]
 :rules ["affordable"]
 :limit 50}

;; "reports-to" is RECURSIVE - it walks the whole org chart.
;; Everyone who reports to Andrew Fuller, directly or transitively.
;; In SQL this needs a recursive CTE; in Mongo a $graphLookup.
;; Here it is three lines, stored once, reused everywhere:
{:query [:find ?fname ?lname
         :in $ %
         :where
         [?e :employee/first-name ?fname]
         [?e :employee/last-name ?lname]
         [?boss :employee/first-name "Andrew"]
         (reports-to ?e ?boss)]
 :rules ["reports-to"]
 :limit 50}

;; :rules :all loads every rule stored in the database.
{:query [:find ?name
         :in $ %
         :where
         [?p :product/name ?name]
         (affordable ?p)]
 :rules :all
 :limit 50}
`
        },
        {
            name: '04-vector-search.dtlv.edn',
            content: `${header('04 - Vector similarity search', dbPath, [
                'Every product carries an 8-dim :product/embedding,',
                'hand-tuned so beverages cluster together.',
                'vec-neighbors runs an approximate nearest-neighbor search',
                'right inside Datalog.'
            ])}

;; Products most similar to Chai, with cosine distances:
{:query [:find ?name ?dist
         :where
         [?src :product/name "Chai"]
         [?src :product/embedding ?q]
         [(vec-neighbors $ :product/embedding ?q {:top 5 :display :refs+dists})
          [[?e _ _ ?dist]]]
         [?e :product/name ?name]]
 :limit 50}

;; Similarity is just another clause - combine it with anything.
;; Similar to Chai AND comfortably in stock:
{:query [:find ?name ?dist ?stock
         :where
         [?src :product/name "Chai"]
         [?src :product/embedding ?q]
         [(vec-neighbors $ :product/embedding ?q {:top 5 :display :refs+dists})
          [[?e _ _ ?dist]]]
         [?e :product/name ?name]
         [?e :product/units-in-stock ?stock]
         [(> ?stock 15)]]
 :limit 50}

;; Try it visually: right-click the database and choose
;; "Levin: Vector Similarity Search" (levin.vectorSearch).
`
        },
        {
            name: '05-beyond-sql.dtlv.edn',
            content: `${header('05 - Beyond SQL', dbPath, [
                'Things that are one liner in Datalevin but awkward or',
                'impossible in MSSQL, Oracle or Mongo alone.'
            ])}

;; Full-text search, built in and composable with Datalog.
;; :product/name is a fulltext attribute in the sample schema.
{:query [:find ?name
         :where
         [(fulltext $ :product/name "seasoning") [[?e _ ?name]]]]
 :limit 50}

;; Parameters: :args feeds values to the :in clause, in order.
;; The same query runs with any company name - no string surgery.
{:query [:find ?date
         :in $ ?company
         :where
         [?o :order/customer ?c]
         [?o :order/order-date ?date]
         [?c :customer/company-name ?company]]
 :args ["La maison d'Asie"]
 :limit 50}

;; Join the database against ad-hoc data. This pairs product names with
;; per-product minimum prices supplied as an in-memory collection -
;; no temp tables, no application-side filtering:
{:query [:find ?name ?price
         :in $ [[?name ?min-price]]
         :where
         [?p :product/name ?name]
         [?p :product/unit-price ?price]
         [(>= ?price ?min-price)]]
 :args [[["Chai" 10.0] ["Tofu" 20.0]]]
 :limit 50}

;; The sample DB was created with :auto-entity-time?, so every entity
;; remembers when it was born - no audit columns to design:
{:query [:find ?name ?created
         :where
         [?p :product/name ?name]
         [?p :db/created-at ?created]]
 :limit 50}

;; Writes are plain data too. Run this to add a customer (safe to re-run:
;; :customer/company-name is unique, so it upserts instead of duplicating).
;; Then re-run any query above and watch the data change.
{:transact [{:customer/company-name "New Customer"
            :customer/country "Spain"}]}
`
        },
        {
            name: '06-charts.dtlvnb',
            content: chartsNotebook(dbPath)
        },
        {
            name: '07-solve.dtlvnb',
            content: solveNotebook(dbPath)
        }
    ];
}

interface NotebookCell {
    cell_type: 'markdown' | 'code';
    source: string[];
    metadata: Record<string, unknown>;
    execution_count?: number | null;
    outputs?: unknown[];
}

const mdCell = (text: string): NotebookCell => ({
    cell_type: 'markdown',
    source: textToIpynbLines(text),
    metadata: {}
});

const codeCell = (source: string): NotebookCell => ({
    cell_type: 'code',
    source: textToIpynbLines(source),
    metadata: {},
    execution_count: null,
    outputs: []
});

function textToIpynbLines(text: string): string[] {
    const parts = text.split('\n');
    const lines = parts.map((part, i) => (i < parts.length - 1 ? part + '\n' : part));
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}

/**
 * The charts demo notebook: prose cells alternating with :chart statements,
 * stored as ipynb-compatible JSON (renders on GitHub too).
 */
function chartsNotebook(dbPath: string): string {
    const cells: NotebookCell[] = [
        mdCell('# Charts\n\nEvery query can draw itself. Add a `:chart` map to any statement and the output becomes a Vega-Lite chart - run the cells below, then use the mime picker on any output to flip between chart and table.'),

        codeCell(`{:db "${dbPath}"
 :query [:find ?name ?price
         :where
         [?p :product/name ?name]
         [?p :product/unit-price ?price]
         :order-by [?price :desc]]
 :chart {:mark :bar :x ?name :y ?price}
 :limit 50}`),

        mdCell('## Pie (arc)\n\n`:mark :arc` turns x into the color and y into the angle:'),

        codeCell(`{:query [:find ?category (sum ?qty)
         :keys category qty
         :where
         [?d :orderdetail/quantity ?qty]
         [?d :orderdetail/product ?p]
         [?p :product/category ?c]
         [?c :category/name ?category]]
 :chart {:mark :arc :x ?category :y ?qty}
 :limit 50}`),

        mdCell('## Anything Vega-Lite can do\n\nPass a raw spec with `:chart {:spec {...}}` - fields reference your column names:'),

        codeCell(`{:query [:find ?name ?price ?stock
         :where
         [?p :product/name ?name]
         [?p :product/unit-price ?price]
         [?p :product/units-in-stock ?stock]]
 :chart {:spec {:mark "point"
                :encoding {:x {:field "stock" :type "quantitative" :title "Units in stock"}
                           :y {:field "price" :type "quantitative" :title "Unit price"}
                           :tooltip {:field "name" :type "nominal"}}}}
 :limit 50}`)
    ];

    return JSON.stringify({
        cells,
        metadata: {
            levin: {},
            kernelspec: { name: 'levin', display_name: 'Levin (Datalevin)', language: 'clojure' },
            language_info: { name: 'clojure' }
        },
        nbformat: 4,
        nbformat_minor: 5
    }, null, 1) + '\n';
}

/**
 * The solve demo notebook: queries find what IS, :solve finds what COULD BE -
 * pick rows under constraints, a job datalog alone cannot express.
 */
function solveNotebook(dbPath: string): string {
    const cells: NotebookCell[] = [
        mdCell('# Solve\n\nQueries answer *"what is true?"*. A `:solve` statement answers *"what could be?"* - it runs a query, then **picks** a set of rows satisfying **constraints**. Below: build a gift bundle of 3 products, every one from a different category, for under $50 total.'),

        codeCell(`{:db "${dbPath}"
 :solve [:find ?name ?price ?cat
         :where
         [?p :product/name ?name]
         [?p :product/unit-price ?price]
         [?p :product/category ?c]
         [?c :category/name ?cat]]
 :pick 3
 :such-that [[:distinct ?cat]
             [(< (sum ?price) 50.0)]]
 :limit 5}`),

        mdCell('Each row of the output is one picked product; the `?solution` column groups them into bundles. Try tightening the budget to `40.0`, or `:pick 4`.\n\n## Same, not different\n\nConstraints compose: `[:same ?country]` forces every pick from one country, bare `?price` applies per row, and `gap` bounds the spread - on this catalog exactly one trio qualifies:'),

        codeCell(`{:solve [:find ?name ?price ?country
         :where
         [?p :product/name ?name]
         [?p :product/unit-price ?price]
         [?p :product/supplier ?s]
         [?s :supplier/country ?country]]
 :pick 3
 :such-that [[:same ?country]
             [(< ?price 25.0)]
             [(<= (gap ?price) 10.0)]]
 :limit 3}`),

        mdCell('## Optimize, don\'t just satisfy\n\nGive `:pick` a **quantity variable** and add `:maximize`, and solve becomes a buying plan: *"I have $100 - how many of each product should I buy to maximize units on the shelf?"* Solved exactly (bounded knapsack), not greedily:'),

        codeCell(`{:solve [:find ?name ?price ?stock
         :where
         [?p :product/name ?name]
         [?p :product/unit-price ?price]
         [?p :product/units-in-stock ?stock]]
 :pick {?qty [0 ?stock]}
 :such-that [[(<= (sum (* ?qty ?price)) 100.0)]]
 :maximize (sum ?qty)
 :chart {:mark :bar :x ?name :y ?buy}}`),

        mdCell('The `?buy` column says how many of each; the header shows the objective and exact spend - and `:chart` composes with `:solve` just like with `:query`, so the buying plan above draws itself as a bar chart (flip to the table with the mime picker). Swap the objective for profit - expressions nest freely: `:maximize (sum (* ?qty (- 30.0 ?price)))`. `:maximize`/`:minimize` also work with plain `:pick 3` to rank bundles instead of returning the first found.'),

        mdCell(`## The vocabulary

| key | meaning |
|---|---|
| \`:pick n\` | choose n rows |
| \`:pick {?q [lo hi]}\` | choose a quantity of each row (bounds: numbers or row vars) |
| \`:such-that [...]\` | constraints (below) |
| \`:maximize\` / \`:minimize\` | objective, e.g. \`(sum (* ?q ?price))\` |
| \`:limit\` | max solutions returned (default 5) |
| \`:rules\` / \`:args\` | stored rules for \`%\` and extra \`:in\` inputs - same as \`:query\` |
| \`:chart\` | draw the solution - same as \`:query\` |

| constraint | meaning |
|---|---|
| \`[:distinct ?v]\` | picked values of \`?v\` all differ |
| \`[:same ?v]\` | picked values of \`?v\` all equal |
| \`[(< (sum ?v) n)]\` | predicate over an aggregate: \`sum\` \`max\` \`min\` \`avg\` \`gap\` \`count\` |
| \`[(< ?v n)]\` | bare \`?v\`: predicate must hold for every picked row |

Predicates: \`<\` \`<=\` \`>\` \`>=\` \`=\` \`not=\`; expressions may nest \`+ - * / min max\`. An empty result means no pick satisfies the constraints - itself an answer.`)
    ];

    return JSON.stringify({
        cells,
        metadata: {
            levin: {},
            kernelspec: { name: 'levin', display_name: 'Levin (Datalevin)', language: 'clojure' },
            language_info: { name: 'clojure' }
        },
        nbformat: 4,
        nbformat_minor: 5
    }, null, 1) + '\n';
}
