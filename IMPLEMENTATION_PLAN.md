# DialerOS Production Readiness Implementation Plan

This plan turns DialerOS into a fully fledged predictive dialer and Asterisk UI/control plane over ARI + AMI.

## Program Goals

- Deliver predictive dialing that is compliant, stable, observable, and scalable.
- Make Asterisk administration first-class from the web UI.
- Ensure contact center operations (agents/supervisors) are production-ready.
- Harden security, governance, and deployment reliability.

## Delivery Model

- Work in phased releases with measurable acceptance criteria.
- Each phase ships deployable increments with regression testing.
- Any feature that affects compliance or dialing behavior ships behind flags first.

## Phase 0 - Foundation & Governance (Week 0-1)

### Scope

- [ ] Architecture decision records for pacing/compliance/security
- [ ] Feature flag strategy for risky behavior changes
- [ ] Baseline metrics and SLO definitions
- [ ] Test strategy (unit, integration, telephony E2E)

### Acceptance Criteria

- [ ] Production readiness scorecard agreed
- [ ] Rollout/rollback playbooks documented
- [ ] KPIs defined: ASR, ACD, abandon rate, occupancy, queue lag

---

## Phase 1 - Compliance & Safe Dial Execution (Week 1-3)

### Scope

- [x] Worker enforces campaign running state before origination
- [x] Worker enforces timezone dial windows (start/end time)
- [x] Holiday/blackout calendar enforcement
- [ ] Per-jurisdiction compliance profiles
- [ ] DNC policy layers (global/account/campaign)

### Acceptance Criteria

- [ ] No call is originated outside legal campaign window
- [ ] Paused campaigns do not originate calls
- [ ] Compliance decision is auditable in logs

---

## Phase 2 - Predictive Pacing Engine (Week 3-6)

### Scope

- [x] Activate Erlang-C pacing loop in dispatch path
- [ ] Dynamic launch-rate control from answer rate + AHT + occupancy
- [x] Abandon-rate governor and hard caps
- [ ] Pacing mode strategy: preview/progressive/predictive/power
- [ ] Backpressure from Redis/ARI/DB health

### Acceptance Criteria

- [ ] Stable occupancy in configured target band
- [ ] Abandon rate remains under configured threshold
- [ ] Campaign pacing behavior visible in dashboard

---

## Phase 3 - Agent & Supervisor Operations (Week 5-8)

### Scope

- [ ] Agent state machine (ready, wrap-up, break, training, forced logoff)
- [ ] Skills/priority routing and queue assignment
- [ ] Disposition and wrap-up enforcement UI
- [ ] Supervisor controls (listen/whisper/barge/takeover)
- [ ] Agent-only UX and permissions model

### Acceptance Criteria

- [ ] Agent state transitions are real-time and resilient
- [ ] Supervisor actions are audited and role-controlled
- [ ] Workforce reporting supports per-agent KPIs

---

## Phase 4 - Asterisk UI Completeness (Week 7-10)

### Scope

- [ ] Full PJSIP management (endpoint/auth/aor/identify/transport)
- [ ] Dialplan versioning, diff, publish/rollback
- [ ] Trunk performance analytics (SIP responses, PDD, ASR, ACD)
- [ ] Recording retention and policy controls
- [ ] Route failover designer (trunks/queues/agents)

### Acceptance Criteria

- [ ] Core Asterisk operations manageable without SSH access
- [ ] Config changes are versioned and reversible
- [ ] Health and route quality visible in UI

---

## Phase 5 - Reliability, Scale, and SRE (Week 9-12)

### Scope

- [x] Idempotency guarantees for queue processing
- [x] Distributed campaign lease/locks for multi-worker HA
- [x] Dead-letter replay tooling
- [ ] Prometheus/Grafana metrics + alert rules
- [ ] Synthetic E2E test calls and readiness checks

### Acceptance Criteria

- [ ] Horizontal scaling without duplicate dials
- [ ] Alerting for ARI/AMI/queue failure conditions
- [ ] MTTR reduction with operational dashboards

---

## Phase 6 - Security, Identity, and Enterprise Controls (Week 11-14)

### Scope

- [ ] HttpOnly cookie auth migration
- [ ] MFA and optional SSO/OIDC/SAML
- [ ] Fine-grained RBAC/ABAC by campaign/resource
- [ ] Secret management integration
- [ ] Audit immutability and tamper evidence

### Acceptance Criteria

- [ ] Security baseline passes internal checklist
- [ ] Admin surface protected by MFA and least-privilege controls

---

## Phase 7 - Analytics & Integrations (Week 13-16)

### Scope

- [ ] CDR/CallLog reconciliation jobs
- [ ] Scheduled reports and data exports
- [ ] Webhook/event subscriptions
- [ ] CRM connectors and lead ingestion mapping

### Acceptance Criteria

- [ ] Reporting is operationally trustworthy
- [ ] External system sync is resilient and observable

---

## Cross-Cutting Workstreams

- Testing: unit + contract + integration + Asterisk-in-the-loop E2E
- Data migrations: backward compatible, reversible
- Feature flags: staged rollout with kill switches
- Documentation: operator runbooks, admin guides, incident SOPs

## Initial Execution Started in This Commit

- Added dial execution safeguards in `apps/worker/src/workers/dialerWorker.ts`:
  - Campaign state guard: non-running campaigns are delayed and retried.
  - Time-window guard: campaign timezone/start/end windows are enforced before origination.
  - Blackout-date guard: calendar dates block dialing and defer jobs.
  - Pacing guardrail: dynamic dispatch interval per campaign with Redis coordination.
  - Abandon governor: proxy abandon cap pauses launches when risk exceeds threshold.

- Added metrics and operations visibility:
  - `GET /api/metrics/pacing` for campaign pacing/governor state and worker heartbeats.
  - `GET /api/metrics/alerts` for queue/worker/governor health alert states.
  - Reports dashboard panel for pacing/compliance health.

- Added worker hardening:
  - Campaign dispatch lease lock to reduce multi-worker race conditions per campaign.
  - In-flight attempt lock + contact status guard for stronger idempotent dial execution.

- Added dead-letter operations:
  - `POST /api/queue/replay-failed` (admin only) to replay failed BullMQ dial jobs in controlled batches.

## Next Implementation Steps (Immediate)

1. Add holiday/blackout calendar model + API + worker enforcement.
2. Activate pacing output as a real dispatch limiter.
3. Add abandon-rate guardrail and campaign-level throttle events.
4. Introduce metrics endpoint and Grafana starter dashboard for pacing/compliance KPIs.
