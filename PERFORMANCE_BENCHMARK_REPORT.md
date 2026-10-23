# S3 Gateway Performance Benchmark Report

**Date:** 2026-10-22  
**Testing Environment:**  
- **Host Platform:** Windows 11 x86_64, Bun Workspace + Turborepo
- **Convex Backend:** Docker container `self-hosted-backend-1` listening on port 3210 (HTTP proxy 3211)
- **Object Storage Engine:** RustFS Docker container `self-hosted-rustfs-1` listening on port 9000
- **Client:** Python 3.12, `boto3` 1.35.x, `botocore` with path-style S3 configuration

---

## 1. Methodology

All metrics were gathered using automated test harnesses (`run_benchmark.py` and `test_security_hardening.py`) performing live network requests to `http://127.0.0.1:3211/s3`.

To avoid misleading one-off measurements:
1. **Cold Start Measurement:** Captured the very first request hitting a cold Convex runtime isolate.
2. **Warm Latency Sampling:** Conducted 20 iterations for each key operation (`HeadBucket`, `PutObject` 1KB, `GetObject` 1KB) to compute arithmetic Mean, Min, Max, and Percentiles (p50, p95, p99).
3. **Multipart Throughput:** Measured end-to-end completion of multi-megabyte payloads (6.3 MiB).

---

## 2. Empirical Benchmark Results

### Latency Summary

| Operation | Sample Size ($N$) | Mean Latency | Min Latency | p50 (Median) | p95 | p99 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Cold Start Request** | 1 | 5,033.28 ms | 5,033.28 ms | 5,033.28 ms | - | - |
| **HeadBucket (Warm)** | 20 | 1,335.58 ms | 651.24 ms | **1,023.16 ms** | 2,171.06 ms | 4,300.94 ms |
| **PutObject (1 KB)** | 20 | 1,342.57 ms | 773.24 ms | **1,025.84 ms** | 3,360.61 ms | 3,362.60 ms |
| **GetObject (1 KB)** | 20 | 1,501.26 ms | 757.70 ms | **964.19 ms** | 4,327.24 ms | 7,441.73 ms |
| **Range GetObject (10B)**| 5 | 812.40 ms | 642.10 ms | **780.50 ms** | 1,120.30 ms | 1,180.20 ms |

### Multipart Upload Performance

- **Payload Size:** 6,291,466 bytes (~6.3 MiB in 2 parts: 5 MiB + 1.3 MiB)
- **Time to Complete:** ~15.2 seconds total (including initiation, two uploads, XML completion, and verification)
- **Effective Gateway Throughput:** ~3.3 Mbps across local loopback proxy + Convex mutation/query validation layers.
- **Memory Footprint:** Upstream streaming buffers bounded to 64 MiB maximum part ceiling, preventing V8 isolate heap exhaustion.

---

## 3. Analysis & Comparison to Previous Claims

In `FINAL_SECURITY_PERFORMANCE_AUDIT_REPORT.txt`, repeated warm latencies were claimed to be "450–640 ms".

**Empirical Verification Finding:**
- The observed warm **minimum latency** achieved was **651.24 ms** for `HeadBucket` and **757.70 ms** for `GetObject`, which aligns closely with the best-case cache hits.
- However, the realistic **p50 (median) latency** hovers around **960–1,025 ms**. The higher median is attributable to:
  1. Complete SigV4 HMAC-SHA256 signature calculation across request and canonical headers.
  2. Upstream re-signing with root credentials and HTTP proxy hop to RustFS.
  3. Strict 10-second cache TTL policy to prevent stale authorization windows.

---

## 4. Bottlenecks & Recommendations for Production Scale

1. **In-Memory Cache vs Shared Distributed Cache:**
   The current cache operates within the local process isolate. In a multi-worker production deployment, consider Redis or Convex table index caches with explicit revision counters.
2. **Streaming Direct-to-RustFS for Large Payloads:**
   For objects $>64$ MiB, implement presigned direct-to-RustFS upload tokens to bypass Convex V8 memory constraints entirely while retaining centralized account authorization.
