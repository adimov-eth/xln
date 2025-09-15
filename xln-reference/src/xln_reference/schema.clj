(ns xln-reference.schema
  "Clojure specs for reference engine state and I/O. These are mirrored by
  JSON Schemas under xln-reference/schema for cross-language checks."
  (:require [clojure.spec.alpha :as s]))

;; Basic scalars
(s/def ::height int?)
(s/def ::entity-id (s/or :bytes32 string? :number int?))
(s/def ::channel-id string?)
(s/def ::asset-id string?)
(s/def ::bigint (s/or :n int? :s string?))

;; Entities
(s/def ::control ::bigint)
(s/def ::dividend ::bigint)
(s/def ::articles (s/nilable map?))
(s/def ::entity (s/keys :req-un [::control ::dividend]
                        :opt-un [::articles]))
(s/def ::entities (s/map-of ::entity-id ::entity))

;; Reserves/Collateral
(s/def ::balances (s/map-of ::asset-id ::bigint))
(s/def ::reserves (s/map-of ::entity-id ::balances))
(s/def ::collateral (s/map-of ::entity-id ::balances))

;; Channels
(s/def ::participants (s/coll-of ::entity-id :kind vector?))
(s/def ::status #{:open :closing :closed})
(s/def ::chan-balances (s/map-of ::entity-id ::bigint))
(s/def ::channel (s/keys :opt-un [::participants ::status ::chan-balances]))
(s/def ::channels (s/map-of ::channel-id ::channel))

;; Events and logs
(s/def ::event (s/keys :req-un [::event]))
(s/def ::logs (s/coll-of map? :kind vector?))

;; State
(s/def ::state (s/keys :req-un [::height]
                       :opt-un [::entities ::reserves ::collateral ::channels ::logs]))

;; Inputs
(s/def ::type keyword?)
(s/def ::input (s/keys :req-un [::type]))

;; Output envelope
(s/def ::next-state ::state)
(s/def ::outbox (s/coll-of map? :kind vector?))
(s/def ::result (s/keys :req-un [::next-state ::outbox]))

