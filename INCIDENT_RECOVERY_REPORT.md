# Incident Recovery Report: S3 Storage Platform Outage & Authentication Recovery

**Date:** October 26, 2026  
**Status:** Recovered Locally & Root Causes Fully Isolated  
**Branch:** `recovery/incident-baseline-2026-10-26` (isolated safety branch; all uncommitted working files preserved)  

---

## 1. Executive Summary & Root Cause Analysis

Following the changes recorded in `TODAYS_PROGRESS_REPORT_3PM.txt`, two compounding issues caused the login failures and instability across environments:

### Root Cause 1: Deployed Remote VM Running Broken Stale Assets (HTTP 400 on Chunk Load)
* **Symptom:** On the public Cloudflare tunnel (`https://yellow-showers-initiative-advisors.trycloudflare.com`), the HTML renders correctly, but all client chunk files (`/_next/static/chunks/main-app-*.js`, `layout-*.js`, build manifests) fail with **HTTP 400 Bad Request** directly from the Next.js production server on the VM (`10.70.70.47:3000`).
* **Impact:** React cannot hydrate in the browser. The login form buttons (`Send code`, `User Login`, `Admin Login`) remain inert and un-clickable, or fail to trigger API actions.
* **Underlying Cause:** As documented in `TODAYS_PROGRESS_REPORT_2026-10-23_FINAL.txt`, the remote VM was running commit `aeb7317` with broken `.next` artifacts. Direct SSH to `harshitha@10.70.70.47` is restricted (`Permission denied (publickey)`).

### Root Cause 2: Local Environment Misconfigured to Local Port 3210 Instead of Active Live Convex Tunnel
* **Symptom:** Locally, Next.js was attempting to query Convex at `http://127.0.0.1:3210` where no local Convex daemon was running (`ECONNREFUSED 127.0.0.1:3210`).
* **Resolution:** Synchronized the local `.env` and `apps/app/.env.local` to point directly to the live backend Convex server:
  ```env
  NEXT_PUBLIC_CONVEX_URL=https://conversation-continued-spectacular-tiles.trycloudflare.com
  CONVEX_URL=https://conversation-continued-spectacular-tiles.trycloudflare.com
  ```
  The local Next.js server now connects, compiles, serves static assets with HTTP 200, and communicates directly with the live Convex database.

---

## 2. Active Service Endpoints & Links

| Service | Target URL | Status | Notes |
| :--- | :--- | :--- | :--- |
| **Local Web Application** | **[http://localhost:3000](http://localhost:3000)** | **Active & Ready (HTTP 200)** | React hydrated, all chunks loaded cleanly |
| **Local Login Route** | **[http://localhost:3000/login](http://localhost:3000/login)** | **Active & Ready (HTTP 200)** | Full authentication UI active |
| **Live Backend Convex Gateway** | **[https://conversation-continued-spectacular-tiles.trycloudflare.com](https://conversation-continued-spectacular-tiles.trycloudflare.com)** | **Healthy (HTTP 200)** | Handling queries and mutations |
| **RustFS Storage Engine (VM)** | `http://10.70.70.47:9000` | **Healthy (HTTP 200)** | S3 object store active |
| **S3 Gateway (VM)** | `http://10.70.70.47:3211/s3` | **Healthy (HTTP 403 SigV4 Auth Required)** | Expected secure behavior |
| **Public Cloudflare Tunnel (VM)** | `https://yellow-showers-initiative-advisors.trycloudflare.com` | Stale Asset Issue on VM | Chunks return 400 from remote VM |

---

## 3. Data Protection & Zero-Loss Verification

- **No Data Destroyed:** No database records, storage buckets, objects, or credentials were removed or altered.
- **Git Safety Baseline:** Switched to `recovery/incident-baseline-2026-10-26` to keep your existing `main` branch intact while preserving all working tree modifications.
- **Authentication Preserved:** Email OTP and password sign-in handlers remain configured with security protections and non-blocking delivery fallback.
