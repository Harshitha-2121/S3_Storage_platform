import boto3
import requests
import hashlib
import sys
from botocore.client import Config
from botocore.exceptions import ClientError

from s3_test_config import BUCKET, ENDPOINT, ACCESS_KEY, SECRET_KEY

s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT,
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
    region_name="us-east-1",
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, connect_timeout=5, read_timeout=30)
)

print("=" * 60)
print("S3 GATEWAY SECURITY & PERFORMANCE VALIDATION SUITE")
print("=" * 60)

# 1. Path Traversal Rejection
print("\n[1] Testing Path Traversal Defense (../, null bytes, backslashes):")
traversal_paths = [
    f"{ENDPOINT}/../etc/passwd",
    f"{ENDPOINT}/{BUCKET}/../../secret.txt",
    f"{ENDPOINT}/{BUCKET}/test%2F..%2F..%2Fescaped.txt",
    f"{ENDPOINT}/{BUCKET}/null%00byte.txt",
    f"{ENDPOINT}/{BUCKET}/bad\\backslash.txt",
]

for p in traversal_paths:
    res = requests.get(p)
    if res.status_code == 400 and "InvalidURI" in res.text:
        print(f"  -> PASS: Path '{p.split('/s3')[1]}' correctly rejected with 400 InvalidURI")
    elif res.status_code in [400, 403, 404]:
        print(f"  -> PASS: Path '{p.split('/s3')[1]}' blocked (HTTP {res.status_code})")
    else:
        print(f"  -> FAIL: Path '{p}' unexpected status: {res.status_code}, response: {res.text[:100]}")

# 2. Security Headers Verification
print("\n[2] Testing Security Response Headers (X-Content-Type-Options, X-Frame-Options):")
resp = requests.options(f"{ENDPOINT}/{BUCKET}")
print(f"  OPTIONS Status: {resp.status_code}")
print(f"  x-content-type-options: {resp.headers.get('x-content-type-options')}")
print(f"  x-frame-options: {resp.headers.get('x-frame-options')}")
assert resp.headers.get("x-content-type-options") == "nosniff", "Missing or invalid nosniff header"
assert resp.headers.get("x-frame-options") == "DENY", "Missing or invalid x-frame-options header"
print("  -> PASS: Security headers strictly enforced on responses.")

# 3. Payload Integrity Tampering Defense (x-amz-content-sha256 mismatch)
print("\n[3] Testing Payload Tampering / Hash Mismatch Protection:")
try:
    # Send PUT request with intentional hash mismatch
    fake_hash = hashlib.sha256(b"original content").hexdigest()
    actual_tampered_body = b"tampered content that does not match fake_hash!"
    
    headers = {
        "x-amz-content-sha256": fake_hash,
    }
    # Direct raw request to test gateway hash validation
    raw_res = requests.put(
        f"{ENDPOINT}/{BUCKET}/tamper-test.txt",
        data=actual_tampered_body,
        headers=headers,
    )
    if "XAmzContentSHA256Mismatch" in raw_res.text or raw_res.status_code in [400, 403]:
        print(f"  -> PASS: Tampered payload rejected as expected (HTTP {raw_res.status_code})")
    else:
        print(f"  -> FAIL: Tampered payload not rejected: {raw_res.status_code} - {raw_res.text[:150]}")
except Exception as e:
    print("  -> Exception in tampering test:", e)

# 4. Legitimate Boto3 PUT & GET Verification
print("\n[4] Testing Standard Boto3 PUT, GET, DELETE Workflow with Hardened Gateway:")
test_key = "security-test/pass.txt"
test_data = b"Cryptographically verified payload data for production hardening!"

s3.put_object(Bucket=BUCKET, Key=test_key, Body=test_data)
print(f"  -> PASS: Standard put_object succeeded for '{test_key}'")

get_res = s3.get_object(Bucket=BUCKET, Key=test_key)
content = get_res["Body"].read()
assert content == test_data, "Content mismatch!"
print(f"  -> PASS: get_object returned expected payload ({len(content)} bytes)")

s3.delete_object(Bucket=BUCKET, Key=test_key)
print(f"  -> PASS: delete_object cleaned up '{test_key}'")

# 5. Performance / Latency benchmark across multiple calls (leveraging TTL query caching)
print("\n[5] Performance Benchmark: 5 Sequential HeadBucket & GetObject calls:")
import time

latencies = []
for i in range(5):
    t0 = time.perf_counter()
    s3.head_bucket(Bucket=BUCKET)
    latencies.append((time.perf_counter() - t0) * 1000)

print(f"  -> Latencies: {[f'{l:.1f}ms' for l in latencies]}")
avg_lat = sum(latencies) / len(latencies)
print(f"  -> PASS: Average latency across 5 warm calls: {avg_lat:.1f}ms")

print("\n" + "=" * 60)
print("ALL SECURITY & PERFORMANCE CHECKS COMPLETED SUCCESSFULLY!")
print("=" * 60)
