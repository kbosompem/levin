import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseEdn } from './utils/edn-parser';

export interface EvalResult {
    success: boolean;
    value?: unknown;
    error?: string;
    stdout?: string;
    stderr?: string;
}

export class CalvaBridge {
    private calvaApi: CalvaApi | null = null;
    private bootstrapCode: string = '';

    async initialize(): Promise<boolean> {
        const calva = vscode.extensions.getExtension('betterthantomorrow.calva');

        if (!calva) {
            return false;
        }

        try {
            this.calvaApi = await calva.activate();
            await this.loadBootstrapCode();
            return true;
        } catch (error) {
            console.error('Failed to initialize Calva:', error);
            return false;
        }
    }

    private async loadBootstrapCode(): Promise<void> {
        const extensionPath = vscode.extensions.getExtension('KayBosompem.levin')?.extensionPath;
        if (extensionPath) {
            const bootstrapPath = path.join(extensionPath, 'src', 'clojure', 'bootstrap.clj');
            try {
                this.bootstrapCode = fs.readFileSync(bootstrapPath, 'utf8');
            } catch {
                // Use embedded bootstrap code as fallback
                this.bootstrapCode = this.getEmbeddedBootstrapCode();
            }
        } else {
            this.bootstrapCode = this.getEmbeddedBootstrapCode();
        }
    }

    private getEmbeddedBootstrapCode(): string {
        return `
(ns datalevin-ext.core
  (:require [datalevin.core :as d]
            [clojure.edn :as edn]
            [clojure.string :as str]))

;; Connection management
(defonce ^:private connections (atom {}))

(defn connect-db! [db-name path & {:keys [create?] :or {create? false}}]
  (try
    (let [conn (if create?
                 (d/get-conn path {})
                 (d/get-conn path))]
      (swap! connections assoc db-name {:conn conn :path path})
      {:status :connected :db db-name :path path})
    (catch Exception e
      {:status :error :message (.getMessage e)})))

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
(defn get-entity [db-name eid]
  (when-let [{:keys [conn]} (get @connections db-name)]
    (let [db @conn
          entity (d/entity db eid)
          attrs (->> (keys entity)
                     (map (fn [k] [(str k) (get entity k)]))
                     (into {}))]
      {:eid eid
       :attributes attrs})))

(defn get-entity-refs [db-name eid]
  (when-let [{:keys [conn]} (get @connections db-name)]
    (vec (d/q '[:find ?attr ?e
                :in $ ?target
                :where [?e ?attr ?target]]
              @conn eid))))

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
    (try
      (let [tx-data (if (string? tx-data-str) (edn/read-string tx-data-str) tx-data-str)
            result (d/transact! conn tx-data)]
        {:tx-id (:max-tx result)
         :tempids (:tempids result)
         :datoms-count (count (:tx-data result))})
      (catch Exception e
        {:error (.getMessage e)}))))

;; Sample data for attribute
(defn sample-values [db-name attr-str & {:keys [limit] :or {limit 10}}]
  (when-let [{:keys [conn]} (get @connections db-name)]
    (let [attr (keyword attr-str)]
      (->> (d/datoms @conn :aevt attr)
           (take limit)
           (map :v)
           vec))))

;; Get all attributes (for autocomplete)
(defn list-attributes [db-name]
  (when-let [{:keys [conn]} (get @connections db-name)]
    (->> (d/schema @conn)
         keys
         (map str)
         sort
         vec)))

(println "[Datalevin Extension] Bootstrap loaded successfully")
`;
    }

    async isConnected(): Promise<boolean> {
        if (!this.calvaApi) {
            return false;
        }

        try {
            // Try to check if there's an active REPL session
            // This uses Calva's internal state
            const replSession = this.calvaApi?.repl?.session;
            return replSession !== null && replSession !== undefined;
        } catch {
            return false;
        }
    }

    async evaluate(code: string): Promise<EvalResult> {
        if (!this.calvaApi) {
            return { success: false, error: 'Calva not initialized' };
        }

        try {
            let stdout = '';
            let stderr = '';

            const result = await this.calvaApi.repl.evaluateCode(code, {
                stdout: (s: string) => { stdout += s; },
                stderr: (s: string) => { stderr += s; }
            });

            if (result.result) {
                // Try to parse as EDN
                const parsed = parseEdn(result.result);
                return {
                    success: true,
                    value: parsed,
                    stdout,
                    stderr
                };
            }

            return {
                success: false,
                error: result.err || 'Unknown error',
                stdout,
                stderr
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    async jackIn(datalevinVersion: string): Promise<void> {
        // Execute Calva jack-in command with custom deps
        await vscode.commands.executeCommand('calva.jackIn', {
            projectType: 'deps.edn',
            customCljsRepl: null,
            customConnectSequence: {
                name: 'Levin',
                projectType: 'deps.edn',
                cljsType: 'none',
                menuSelections: {
                    cljAliases: []
                },
                jackInEnv: {
                    DATALEVIN_VERSION: datalevinVersion
                }
            }
        });
    }

    async injectBootstrap(): Promise<void> {
        // First ensure datalevin is required
        await this.evaluate(`(require '[datalevin.core :as d])`);

        // Then inject the bootstrap code
        const result = await this.evaluate(this.bootstrapCode);

        if (!result.success) {
            console.error('Failed to inject bootstrap code:', result.error);
            throw new Error(`Failed to inject bootstrap: ${result.error}`);
        }
    }

    async getSchema(dbName: string): Promise<SchemaAttribute[]> {
        const result = await this.evaluate(`(datalevin-ext.core/get-schema "${dbName}")`);
        if (result.success && result.value) {
            return result.value as SchemaAttribute[];
        }
        return [];
    }

    async getEntityCounts(dbName: string): Promise<EntityCount[]> {
        const result = await this.evaluate(`(datalevin-ext.core/entity-counts "${dbName}")`);
        if (result.success && result.value) {
            return result.value as EntityCount[];
        }
        return [];
    }

    async getConnections(): Promise<DatabaseConnection[]> {
        const result = await this.evaluate('(datalevin-ext.core/list-connections)');
        if (result.success && result.value) {
            return result.value as DatabaseConnection[];
        }
        return [];
    }

    async getAttributes(dbName: string): Promise<string[]> {
        const result = await this.evaluate(`(datalevin-ext.core/list-attributes "${dbName}")`);
        if (result.success && result.value) {
            return result.value as string[];
        }
        return [];
    }

    async getSampleValues(dbName: string, attribute: string, limit: number = 10): Promise<unknown[]> {
        const result = await this.evaluate(
            `(datalevin-ext.core/sample-values "${dbName}" "${attribute}" :limit ${limit})`
        );
        if (result.success && result.value) {
            return result.value as unknown[];
        }
        return [];
    }
}

// Type definitions
interface CalvaApi {
    repl: {
        session: unknown;
        evaluateCode: (code: string, options: {
            stdout: (s: string) => void;
            stderr: (s: string) => void;
        }) => Promise<{ result?: string; err?: string }>;
    };
}

export interface SchemaAttribute {
    attribute: string;
    valueType: string;
    cardinality: string;
    unique?: string;
    index?: boolean;
    fulltext?: boolean;
    isComponent?: boolean;
}

export interface EntityCount {
    namespace: string;
    count: number;
}

export interface DatabaseConnection {
    name: string;
    path: string;
}
