---
name: T-Bee data backend
description: The reason the tracking app currently uses Replit PostgreSQL and App Storage instead of Supabase.
---

The T-Bee brief requested Supabase, but no Supabase project connection was available in this workspace. To build immediately, the app was implemented on Replit PostgreSQL and App Storage. These services are not automatically mirrored to Supabase.

**Why:** The user asked to proceed after the missing Supabase connection was explained; the built-in services provided durable order storage and image uploads without blocking the build.

**How to apply:** If Supabase is connected later, plan and verify an explicit database and image migration. Preserve the public tracking/private administrator data boundary and do not claim that Supabase is the current system of record before migration is complete.
