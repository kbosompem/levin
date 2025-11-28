;; Levin Extension Bootstrap Code
;; This code is injected into the REPL on Datalevin jack-in

(ns datalevin-ext.core
  (:require [datalevin.core :as d]
            [clojure.edn :as edn]
            [clojure.string :as str]))

;; Connection management
(defonce ^:private connections (atom {}))

(defn connect-db!
  "Connect to a Datalevin database.
   Options:
     :create? - Create database if it doesn't exist (default false)"
  [db-name path & {:keys [create?] :or {create? false}}]
  (try
    (let [conn (if create?
                 (d/get-conn path {})
                 (d/get-conn path))]
      (swap! connections assoc db-name {:conn conn :path path})
      {:status :connected :db db-name :path path})
    (catch Exception e
      {:status :error :message (.getMessage e)})))

(defn disconnect-db!
  "Disconnect from a Datalevin database."
  [db-name]
  (when-let [{:keys [conn]} (get @connections db-name)]
    (d/close conn)
    (swap! connections dissoc db-name)
    {:status :disconnected :db db-name}))

(defn list-connections
  "List all active database connections."
  []
  (->> @connections
       (map (fn [[k v]] {:name k :path (:path v)}))
       vec))

(defn- get-conn
  "Get connection for a database name."
  [db-name]
  (get-in @connections [db-name :conn]))

;; Schema operations
(defn get-schema
  "Get schema for a database as a vector of attribute maps."
  [db-name]
  (when-let [conn (get-conn db-name)]
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

(defn add-schema!
  "Add a new schema attribute to the database."
  [db-name attr-map]
  (when-let [conn (get-conn db-name)]
    (try
      (let [schema-entry (cond-> {:db/ident (keyword (:attribute attr-map))
                                  :db/valueType (keyword "db.type" (:valueType attr-map))
                                  :db/cardinality (keyword "db.cardinality" (:cardinality attr-map))}
                           (:unique attr-map) (assoc :db/unique (keyword "db.unique" (:unique attr-map)))
                           (:index attr-map) (assoc :db/index true)
                           (:fulltext attr-map) (assoc :db/fulltext true)
                           (:isComponent attr-map) (assoc :db/isComponent true))]
        (d/transact! conn [schema-entry])
        {:status :ok :attribute (:attribute attr-map)})
      (catch Exception e
        {:status :error :message (.getMessage e)}))))

;; Query operations
(defn run-query
  "Execute a Datalog query against a database.
   Options:
     :args - Additional query arguments (default [])
     :limit - Maximum results to return (default 100)"
  [db-name query-str & {:keys [args limit] :or {args [] limit 100}}]
  (when-let [conn (get-conn db-name)]
    (try
      (let [query (if (string? query-str) (edn/read-string query-str) query-str)
            db @conn
            results (apply d/q query db args)
            total (count results)]
        {:total total
         :truncated (> total limit)
         :results (vec (take limit results))})
      (catch Exception e
        {:error (.getMessage e)}))))

;; Entity operations
(defn get-entity
  "Get an entity by ID with all its attributes."
  [db-name eid]
  (when-let [conn (get-conn db-name)]
    (try
      (let [db @conn
            entity (d/entity db eid)
            attrs (->> (keys entity)
                       (map (fn [k] [(str k) (let [v (get entity k)]
                                               (if (instance? datalevin.entity.Entity v)
                                                 (:db/id v)
                                                 v))]))
                       (into {}))]
        {:eid eid
         :attributes attrs})
      (catch Exception e
        {:error (.getMessage e)}))))

(defn get-entity-refs
  "Get all entities that reference this entity."
  [db-name eid]
  (when-let [conn (get-conn db-name)]
    (try
      (vec (d/q '[:find ?attr ?e
                  :in $ ?target
                  :where [?e ?attr ?target]]
                @conn eid))
      (catch Exception e
        []))))

;; Count entities by namespace
(defn entity-counts
  "Get count of entities grouped by attribute namespace."
  [db-name]
  (when-let [conn (get-conn db-name)]
    (try
      (let [db @conn]
        (->> (d/datoms db :eavt)
             (map #(namespace (:a %)))
             (remove nil?)
             frequencies
             (map (fn [[ns cnt]] {:namespace ns :count cnt}))
             (sort-by :namespace)
             vec))
      (catch Exception e
        []))))

;; Transaction operations
(defn transact!
  "Execute a transaction against a database."
  [db-name tx-data-str]
  (when-let [conn (get-conn db-name)]
    (try
      (let [tx-data (if (string? tx-data-str) (edn/read-string tx-data-str) tx-data-str)
            result (d/transact! conn tx-data)]
        {:tx-id (:max-tx result)
         :tempids (:tempids result)
         :datoms-count (count (:tx-data result))})
      (catch Exception e
        {:error (.getMessage e)}))))

;; Sample data for attribute
(defn sample-values
  "Get sample values for an attribute."
  [db-name attr-str & {:keys [limit] :or {limit 10}}]
  (when-let [conn (get-conn db-name)]
    (try
      (let [attr (if (keyword? attr-str) attr-str (keyword attr-str))]
        (->> (d/datoms @conn :aevt attr)
             (take limit)
             (map :v)
             vec))
      (catch Exception e
        []))))

;; Get all attributes (for autocomplete)
(defn list-attributes
  "List all schema attributes for a database."
  [db-name]
  (when-let [conn (get-conn db-name)]
    (try
      (->> (d/schema @conn)
           keys
           (map str)
           sort
           vec)
      (catch Exception e
        []))))

;; Search entities
(defn search-entities
  "Search for entities matching criteria."
  [db-name namespace-str & {:keys [limit] :or {limit 100}}]
  (when-let [conn (get-conn db-name)]
    (try
      (let [db @conn
            ns-kw (keyword namespace-str)
            ;; Find an attribute in this namespace
            attrs (->> (d/schema db)
                       keys
                       (filter #(= (namespace %) (name ns-kw)))
                       first)]
        (when attrs
          (->> (d/datoms db :aevt attrs)
               (map :e)
               distinct
               (take limit)
               vec)))
      (catch Exception e
        []))))

;; Database info
(defn db-stats
  "Get statistics about a database."
  [db-name]
  (when-let [conn (get-conn db-name)]
    (try
      (let [db @conn
            schema (d/schema db)
            datoms (d/datoms db :eavt)]
        {:attribute-count (count schema)
         :datom-count (count datoms)
         :entity-count (count (distinct (map :e datoms)))})
      (catch Exception e
        {:error (.getMessage e)}))))

(println "[Datalevin Extension] Bootstrap loaded successfully")
