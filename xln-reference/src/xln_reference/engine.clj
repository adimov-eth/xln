(ns xln-reference.engine
  "Pure, deterministic reference engine for XLN.

  The only public entry point is `apply-entity-input`, which takes an immutable
  state map and an input map, and returns:
    {:next-state <state'> :outbox [<events...>]}.

  No I/O, no timers, no randomness. All behavior is explicit in inputs.
  "
  (:require [clojure.set :as set]))

;; -- State shape (see schema/*.schema.json for JSON schema) -----------------
;;
;; {:height        int
;;  :entities      {entity-id {:control bigint :dividend bigint :articles map}}
;;  :reserves      {entity-id {asset-id bigint}}
;;  :collateral    {entity-id {asset-id bigint}}
;;  :channels      {channel-id {:participants [entity-id ...]
;;                              :status :open|:closing|:closed
;;                              :balances {entity-id bigint}}}
;;  :logs          [event ...]}

(defn- ensure-entity
  [state eid]
  (if (get-in state [:entities eid])
    state
    (assoc-in state [:entities eid] {:control 0N :dividend 0N :articles nil})))

(defn- add-log [state ev]
  (update state :logs (fnil conj []) ev))

(defn- add-out [outbox ev]
  (conj (or outbox []) ev))

(defmulti ^:private apply-input (fn [_state input] (:type input)))

;; No-op operation (useful for testing determinism)
(defmethod apply-input :noop [state _]
  {:state state
   :out   []})

;; Governance enabled for an entity
(defmethod apply-input :governance-enabled
  [state {:keys [entity-id control-supply dividend-supply articles]}]
  (let [state' (-> state
                   (ensure-entity entity-id)
                   (assoc-in [:entities entity-id :control] (bigint (or control-supply 0)))
                   (assoc-in [:entities entity-id :dividend] (bigint (or dividend-supply 0)))
                   (assoc-in [:entities entity-id :articles] (or articles {})))
        ev {:event "GovernanceEnabled"
            :entity-id entity-id
            :control-supply (get-in state' [:entities entity-id :control])
            :dividend-supply (get-in state' [:entities entity-id :dividend])}]
    {:state (add-log state' ev)
     :out   [ev]}))

;; Control/Dividend shares received by an entity (e.g., from Depository)
(defmethod apply-input :control-shares-received
  [state {:keys [entity-id control-amount dividend-amount cause]}]
  (let [state' (-> state
                   (ensure-entity entity-id)
                   (update-in [:entities entity-id :control] + (bigint (or control-amount 0)))
                   (update-in [:entities entity-id :dividend] + (bigint (or dividend-amount 0))))
        ev {:event "ControlSharesReceived"
            :entity-id entity-id
            :control (get-in state' [:entities entity-id :control])
            :dividend (get-in state' [:entities entity-id :dividend])
            :cause (or cause "unspecified")}]
    {:state (add-log state' ev)
     :out   [ev]}))

;; Reserve-to-Reserve transfer within an entity
(defmethod apply-input :reserve-to-reserve
  [state {:keys [entity-id from-asset to-asset amount]}]
  (let [amount (bigint amount)
        reserves (get-in state [:reserves entity-id] {})
        from-bal (bigint (get reserves from-asset 0))
        to-bal   (bigint (get reserves to-asset 0))
        {:keys [state' ok]}
        (if (neg? (- from-bal amount))
          {:state' state :ok false}
          {:state' (-> state
                       (assoc-in [:reserves entity-id from-asset] (- from-bal amount))
                       (assoc-in [:reserves entity-id to-asset] (+ to-bal amount)))
           :ok true})
        ev {:event "ReserveToReserve"
            :entity-id entity-id
            :from from-asset :to to-asset :amount (str amount) :ok ok}]
    {:state (add-log state' ev)
     :out   [ev]}))

;; Transfer Reserve to Collateral within an entity
(defmethod apply-input :transfer-reserve-to-collateral
  [state {:keys [entity-id asset amount]}]
  (let [amount (bigint amount)
        rbal (bigint (get-in state [:reserves entity-id asset] 0))
        cbal (bigint (get-in state [:collateral entity-id asset] 0))
        ok (not (neg? (- rbal amount)))
        state' (if ok
                 (-> state
                     (assoc-in [:reserves entity-id asset] (- rbal amount))
                     (assoc-in [:collateral entity-id asset] (+ cbal amount)))
                 state)
        ev {:event "TransferReserveToCollateral"
            :entity-id entity-id :asset asset :amount (str amount) :ok ok}]
    {:state (add-log state' ev)
     :out   [ev]}))

;; Dispute lifecycle
(defmethod apply-input :dispute-start
  [state {:keys [channel-id reason]}]
  (let [state' (assoc-in state [:channels channel-id :status] :closing)
        ev {:event "DisputeStarted" :channel-id channel-id :reason (or reason "unspecified")}]
    {:state (add-log state' ev)
     :out   [ev]}))

(defmethod apply-input :cooperative-close
  [state {:keys [channel-id]}]
  (let [state' (assoc-in state [:channels channel-id :status] :closed)
        ev {:event "CooperativeClose" :channel-id channel-id}]
    {:state (add-log state' ev)
     :out   [ev]}))

;; Fallback: unknown input types are rejected in a pure way
(defmethod apply-input :default [state input]
  {:state (add-log state {:event "RejectedInput" :input (select-keys input [:type])})
   :out   [{:event "RejectedInput" :input (select-keys input [:type])}]})

;; Trade credit primitives ---------------------------------------------------

(defmethod apply-input :invoice-issued
  [state {:keys [invoice-id supplier buyer amount currency due-date terms refs]}]
  (let [state (update state :invoices #(or % {}))
        exists (get-in state [:invoices invoice-id])
        amount (bigint amount)
        invoice {:invoice-id invoice-id
                 :supplier supplier
                 :buyer buyer
                 :amount amount
                 :currency currency
                 :due-date due-date
                 :terms terms
                 :refs (vec (or refs []))
                 :status :issued}
        state' (if exists
                 state
                 (assoc-in state [:invoices invoice-id] invoice))
        ev {:event (if exists "InvoiceIssueIgnored" "InvoiceIssued")
            :invoice-id invoice-id
            :supplier supplier :buyer buyer :amount (str amount) :currency currency :due-date due-date}]
    {:state (add-log state' ev)
     :out   [ev]}))

(defmethod apply-input :invoice-accepted
  [state {:keys [invoice-id acceptor]}]
  (let [inv (get-in state [:invoices invoice-id])
        ok? (some? inv)
        state' (if ok?
                 (assoc-in state [:invoices invoice-id :status] :accepted)
                 state)
        ev {:event (if ok? "InvoiceAccepted" "InvoiceAcceptUnknown")
            :invoice-id invoice-id :acceptor acceptor}]
    {:state (add-log state' ev)
     :out   [ev]})

;; Public API ---------------------------------------------------------------

(defn apply-entity-input
  "Pure transition: (state, input) -> {:next-state .. :outbox [...]}
   - Increments :height by 1 for each applied input.
   - Appends produced events to :logs.
   - Returns newly emitted events in :outbox.
  "
  [state input]
  (let [state (update state :height (fnil inc -1))
        {:keys [state out]} (apply-input state input)]
    {:next-state state :outbox out}))
