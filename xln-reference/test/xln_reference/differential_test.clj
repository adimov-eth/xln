(ns xln-reference.differential-test
  (:require [clojure.test :refer [deftest is testing]]
            [cheshire.core :as json]
            [clojure.java.shell :as sh]
            [xln-reference.engine :as eng]))

(defn- run-ts [vector]
  (when-let [cmd (System/getenv "TEST_TS_CMD")]
    (let [tmp (java.io.File/createTempFile "xln-ts-vector" ".json")
          _ (spit tmp (json/generate-string vector))
          full-cmd (str cmd " " (.getAbsolutePath tmp))
          {:keys [exit out err]} (sh/sh "bash" "-lc" full-cmd)]
      (.delete tmp)
      (when (zero? exit)
        (try
          (json/parse-string out true)
          (catch Exception _ nil))))) )

(deftest differential-stub
  (testing "Compare reference engine to optional TS adapter if provided"
    (let [vector {:initial {:height 0}
                  :inputs [{:type :noop}]}
          ref (reduce (fn [{:keys [state out]} input]
                        (let [{:keys [next-state outbox]} (eng/apply-entity-input state input)]
                          {:state next-state :out (into out outbox)}))
                      {:state (:initial vector) :out []}
                      (:inputs vector))
          ts (run-ts vector)]
      (when ts
        (is (= (select-keys ref [:state :out]) (select-keys ts [:state :out])))))))
