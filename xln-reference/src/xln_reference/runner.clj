(ns xln-reference.runner
  (:require [cheshire.core :as json]
            [xln-reference.engine :as eng]
            [clojure.java.io :as io]))

(defn- slurp-json [f]
  (with-open [r (io/reader f)]
    (json/parse-stream r true)))

(defn- spit-json [f m]
  (with-open [w (io/writer f)]
    (json/generate-stream m w)))

(defn run-vector
  [{:keys [initial inputs expected]}]
  (let [res (reduce (fn [{:keys [state out]} input]
                      (let [{:keys [next-state outbox]} (eng/apply-entity-input state input)]
                        {:state next-state :out (into out outbox)}))
                    {:state (or initial {:height 0}) :out []}
                    (or inputs []))]
    (assoc res :ok (cond
                     (nil? expected) true
                     (= (select-keys res [:state :out]) (select-keys expected [:state :out])) true
                     :else false)))

(defn -main [& [vector-path & _]]
  (when-not vector-path
    (binding [*out* *err*]
      (println "Usage: clj -M -m xln-reference.runner <path-to-vector.json>")
      (System/exit 2)))
  (let [v (slurp-json vector-path)
        {:keys [state out ok]} (run-vector v)]
    (println (json/generate-string {:ok ok :state state :out out} {:pretty true}))
    (System/exit (if ok 0 1))))
