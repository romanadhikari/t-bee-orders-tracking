---
name: T-Bee order statuses
description: Preserve persisted status compatibility while evolving customer-facing delivery milestones.
---

T-Bee order states are stored in a PostgreSQL enum and copied into status-history records. Add workflow states without renaming or removing persisted values. Keep `ready_for_dispatch` valid for legacy records and present it as ready and waiting for dispatch, not as already shipped.

**Why:** Existing orders rely on their stored status values; treating an older status as shipped would report delivery progress that did not happen.

**How to apply:** Make future enum changes additive, keep the API contract and server validation aligned, and map legacy states to truthful customer and admin views.
