/**
 * Mini-Northwind sample dataset for the Levin playground.
 *
 * A trimmed, self-contained slice of the classic Northwind dataset designed
 * to exercise every Levin feature from one small database:
 *   - refs everywhere (relationships panel, joins, pull)
 *   - :employee/reportsto self-ref chain (recursive rules)
 *   - :product/name fulltext with autoDomain (fulltext predicate)
 *   - :product/embedding :db.type/vec, 8-dim hand-tuned so beverages cluster
 *     (vector similarity search)
 *   - one employee without :employee/title (get-else demo)
 *
 * All shapes here were verified against dtlv 0.10.7 (see the smoke-test
 * history): fulltext yields [e a v], vec-neighbors :refs+dists yields
 * [e a v dist], and fulltext attributes need :db.fulltext/autoDomain true.
 *
 * Pure string constants - no IO, no vscode imports, so they are unit-testable.
 */

export const SAMPLE_DB_DIRNAME = 'northwind-sample';

export const SAMPLE_VECTOR_DIMENSIONS = 8;

/**
 * Datalevin schema map (attribute -> properties), passed to
 * DtlvBridge.createDatabase.
 */
export const MINI_NORTHWIND_SCHEMA = `{
 :product/name           {:db/valueType :db.type/string :db/fulltext true :db.fulltext/autoDomain true}
 :product/unit-price     {:db/valueType :db.type/double}
 :product/units-in-stock {:db/valueType :db.type/long}
 :product/category       {:db/valueType :db.type/ref}
 :product/supplier       {:db/valueType :db.type/ref}
 :product/embedding      {:db/valueType :db.type/vec}
 :category/name          {:db/valueType :db.type/string :db/unique :db.unique/identity}
 :category/description   {:db/valueType :db.type/string}
 :supplier/company-name  {:db/valueType :db.type/string}
 :supplier/country       {:db/valueType :db.type/string}
 :customer/company-name  {:db/valueType :db.type/string :db/unique :db.unique/identity}
 :customer/country       {:db/valueType :db.type/string}
 :employee/first-name    {:db/valueType :db.type/string}
 :employee/last-name     {:db/valueType :db.type/string}
 :employee/title         {:db/valueType :db.type/string}
 :employee/reportsto     {:db/valueType :db.type/ref}
 :order/customer         {:db/valueType :db.type/ref}
 :order/employee         {:db/valueType :db.type/ref}
 :order/order-date       {:db/valueType :db.type/instant}
 :orderdetail/order      {:db/valueType :db.type/ref}
 :orderdetail/product    {:db/valueType :db.type/ref}
 :orderdetail/unit-price {:db/valueType :db.type/double}
 :orderdetail/quantity   {:db/valueType :db.type/long}
}`;

/**
 * Seed data with negative tempids, transacted via DtlvBridge.importWithTempIds.
 */
export const MINI_NORTHWIND_DATA = `[
 ;; categories
 {:db/id -1 :category/name "Beverages" :category/description "Soft drinks, coffees, teas, beers, and ales"}
 {:db/id -2 :category/name "Condiments" :category/description "Sweet and savory sauces, relishes, and seasonings"}
 {:db/id -3 :category/name "Produce" :category/description "Dried fruit and bean curd"}

 ;; suppliers
 {:db/id -10 :supplier/company-name "Exotic Liquids" :supplier/country "UK"}
 {:db/id -11 :supplier/company-name "New Orleans Cajun Delights" :supplier/country "USA"}
 {:db/id -12 :supplier/company-name "Grandma Kelly's Homestead" :supplier/country "USA"}
 {:db/id -13 :supplier/company-name "Tokyo Traders" :supplier/country "Japan"}

 ;; products - 8-dim embeddings hand-tuned so beverages cluster together
 {:db/id -20 :product/name "Chai" :product/unit-price 18.0 :product/units-in-stock 39
  :product/category -1 :product/supplier -10
  :product/embedding [0.90 0.10 0.05 0.02 0.40 0.20 0.10 0.30]}
 {:db/id -21 :product/name "Chang" :product/unit-price 19.0 :product/units-in-stock 17
  :product/category -1 :product/supplier -10
  :product/embedding [0.88 0.12 0.06 0.02 0.38 0.22 0.10 0.30]}
 {:db/id -22 :product/name "Guaraná Fantástica" :product/unit-price 4.5 :product/units-in-stock 20
  :product/category -1 :product/supplier -11
  :product/embedding [0.85 0.15 0.05 0.03 0.42 0.18 0.12 0.28]}
 {:db/id -23 :product/name "Sasquatch Ale" :product/unit-price 14.0 :product/units-in-stock 111
  :product/category -1 :product/supplier -12
  :product/embedding [0.87 0.13 0.04 0.02 0.35 0.25 0.08 0.33]}
 {:db/id -24 :product/name "Aniseed Syrup" :product/unit-price 10.0 :product/units-in-stock 13
  :product/category -2 :product/supplier -10
  :product/embedding [0.15 0.85 0.30 0.10 0.10 0.30 0.40 0.05]}
 {:db/id -25 :product/name "Chef Anton's Cajun Seasoning" :product/unit-price 22.0 :product/units-in-stock 53
  :product/category -2 :product/supplier -11
  :product/embedding [0.12 0.88 0.28 0.12 0.08 0.32 0.42 0.06]}
 {:db/id -26 :product/name "Uncle Bob's Organic Dried Pears" :product/unit-price 30.0 :product/units-in-stock 15
  :product/category -3 :product/supplier -12
  :product/embedding [0.05 0.10 0.90 0.80 0.05 0.10 0.20 0.15]}
 {:db/id -27 :product/name "Tofu" :product/unit-price 23.25 :product/units-in-stock 35
  :product/category -3 :product/supplier -13
  :product/embedding [0.08 0.12 0.85 0.82 0.06 0.12 0.18 0.17]}

 ;; customers
 {:db/id -30 :customer/company-name "Around the Horn" :customer/country "UK"}
 {:db/id -31 :customer/company-name "Bottom-Dollar Markets" :customer/country "Canada"}
 {:db/id -32 :customer/company-name "La maison d'Asie" :customer/country "France"}
 {:db/id -33 :customer/company-name "Island Trading" :customer/country "UK"}

 ;; employees - chain Davolio -> Leverling -> Fuller; Peacock has no title (get-else demo)
 {:db/id -34 :employee/first-name "Nancy" :employee/last-name "Davolio"
  :employee/title "Sales Representative" :employee/reportsto -36}
 {:db/id -35 :employee/first-name "Andrew" :employee/last-name "Fuller"
  :employee/title "Vice President, Sales"}
 {:db/id -36 :employee/first-name "Janet" :employee/last-name "Leverling"
  :employee/title "Sales Representative" :employee/reportsto -35}
 {:db/id -37 :employee/first-name "Margaret" :employee/last-name "Peacock"
  :employee/reportsto -35}

 ;; orders
 {:db/id -40 :order/customer -30 :order/employee -34 :order/order-date #inst "2024-01-15"}
 {:db/id -41 :order/customer -31 :order/employee -36 :order/order-date #inst "2024-02-02"}
 {:db/id -42 :order/customer -32 :order/employee -34 :order/order-date #inst "2024-03-10"}

 ;; order details
 {:db/id -50 :orderdetail/order -40 :orderdetail/product -20 :orderdetail/unit-price 18.0 :orderdetail/quantity 12}
 {:db/id -51 :orderdetail/order -40 :orderdetail/product -24 :orderdetail/unit-price 10.0 :orderdetail/quantity 5}
 {:db/id -52 :orderdetail/order -41 :orderdetail/product -22 :orderdetail/unit-price 4.5 :orderdetail/quantity 20}
 {:db/id -53 :orderdetail/order -41 :orderdetail/product -26 :orderdetail/unit-price 30.0 :orderdetail/quantity 2}
 {:db/id -54 :orderdetail/order -42 :orderdetail/product -21 :orderdetail/unit-price 19.0 :orderdetail/quantity 6}
 {:db/id -55 :orderdetail/order -42 :orderdetail/product -27 :orderdetail/unit-price 23.25 :orderdetail/quantity 9}
]`;

export interface SampleRule {
    name: string;
    body: string;
    description: string;
}

/**
 * Rules seeded into the sample database (stored as :levin.rule/* entities,
 * used from queries via :in $ % plus the :rules statement key).
 */
export const MINI_NORTHWIND_RULES: SampleRule[] = [
    {
        name: 'affordable',
        body: '[[(affordable ?p) [?p :product/unit-price ?price] [(< ?price 20.0)]]]',
        description: 'Products with a unit price under 20.0'
    },
    {
        name: 'reports-to',
        body: '[[(reports-to ?e ?m) [?e :employee/reportsto ?m]] ' +
              '[(reports-to ?e ?m) [?e :employee/reportsto ?b] (reports-to ?b ?m)]]',
        description: 'Transitive org chart: every manager above an employee'
    }
];
