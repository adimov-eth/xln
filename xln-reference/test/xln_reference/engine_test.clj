(ns xln-reference.engine-test
  (:require [clojure.test :refer [deftest is testing]]
            [clojure.test.check.clojure-test :refer [defspec]]
            [clojure.test.check.properties :as prop]
            [clojure.test.check.generators :as gen]
            [xln-reference.engine :as eng]))

(def initial-state {:height 0
                    :entities {}
                    :reserves {}
                    :collateral {}
                    :channels {}
                    :logs []})

(def asset-gen (gen/elements ["USD" "ETH" "USDC" "TKN"]))
(def entity-gen (gen/fmap (fn [n] (format "0x%064x" n)) (gen/large-integer* {:min 1 :max 10})))

(def reserve->reserve-gen
  (gen/let [eid entity-gen
            a1 asset-gen
            a2 asset-gen
            amt (gen/large-integer* {:min 0 :max 100000})]
    {:type :reserve-to-reserve
     :entity-id eid
     :from-asset a1
     :to-asset (if (= a1 a2) "ALT" a2)
     :amount amt}))

(def r2c-gen
  (gen/let [eid entity-gen
            a asset-gen
            amt (gen/large-integer* {:min 0 :max 100000})]
    {:type :transfer-reserve-to-collateral
     :entity-id eid
     :asset a
     :amount amt}))

(def gov-enabled-gen
  (gen/let [eid entity-gen
            c (gen/large-integer* {:min 0 :max 100000})
            d (gen/large-integer* {:min 0 :max 100000})]
    {:type :governance-enabled
     :entity-id eid :control-supply c :dividend-supply d
     :articles {:controlDelay 1000 :dividendDelay 3000 :controlThreshold 51}}))

(def inputs-gen (gen/vector (gen/one-of [reserve->reserve-gen r2c-gen gov-enabled-gen]) 0 50))

(defspec consensus-determinism 50
  (prop/for-all [inputs inputs-gen]
    (let [r1 (reduce (fn [{:keys [state]} i]
                       (eng/apply-entity-input state i))
                     {:state initial-state}
                     inputs)
          r2 (reduce (fn [{:keys [state]} i]
                       (eng/apply-entity-input state i))
                     {:state initial-state}
                     inputs)]
      (= r1 r2))))

(deftest simple-deltas
  (testing "Reserve to reserve transfers emit event and update state"
    (let [eid "0x01"
          s (assoc-in initial-state [:reserves eid "USD"] 1000)
          {:keys [next-state outbox]} (eng/apply-entity-input s {:type :reserve-to-reserve
                                                                 :entity-id eid
                                                                 :from-asset "USD"
                                                                 :to-asset "ETH"
                                                                 :amount 200})]
      (is (= (get-in next-state [:reserves eid "USD"]) 800))
      (is (= (get-in next-state [:reserves eid "ETH"]) 200))
      (is (= (-> outbox first :event) "ReserveToReserve")))))

