import boto3
from botocore.config import Config
import time
import numpy as np

ENDPOINT_URL = "http://127.0.0.1:3211/s3"
ACCESS_KEY = "s3973c5f62029fed2e9492243f"
SECRET_KEY = "a1ed6fc257616f43143afc61f575109a77e587b4fda82ecb1b413c41b57afb14"
BUCKET = "ou4ye78j-me-bucket"

s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT_URL,
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    region_name="us-east-1",
)

def benchmark():
    print("=" * 60)
    print("REPRODUCIBLE S3 GATEWAY PERFORMANCE BENCHMARK")
    print("=" * 60)
    
    # 1. Cold start measurement
    t0 = time.perf_counter()
    s3.head_bucket(Bucket=BUCKET)
    cold_latency = (time.perf_counter() - t0) * 1000
    print(f"Cold Start Request Latency: {cold_latency:.2f}ms")

    # 2. Warm HEAD requests (sample size 20)
    head_latencies = []
    for _ in range(20):
        t0 = time.perf_counter()
        s3.head_bucket(Bucket=BUCKET)
        head_latencies.append((time.perf_counter() - t0) * 1000)

    # 3. Small PUT & GET requests (sample size 20)
    key = "bench-test-obj.txt"
    payload = b"X" * 1024 # 1 KB
    put_latencies = []
    get_latencies = []
    for _ in range(20):
        t0 = time.perf_counter()
        s3.put_object(Bucket=BUCKET, Key=key, Body=payload)
        put_latencies.append((time.perf_counter() - t0) * 1000)

        t0 = time.perf_counter()
        resp = s3.get_object(Bucket=BUCKET, Key=key)
        _ = resp["Body"].read()
        get_latencies.append((time.perf_counter() - t0) * 1000)

    s3.delete_object(Bucket=BUCKET, Key=key)

    def stats(arr, name):
        p50 = np.percentile(arr, 50)
        p95 = np.percentile(arr, 95)
        p99 = np.percentile(arr, 99)
        mean = np.mean(arr)
        min_v = np.min(arr)
        max_v = np.max(arr)
        print(f"\n--- {name} (N={len(arr)}) ---")
        print(f"  Mean: {mean:.2f}ms | Min: {min_v:.2f}ms | Max: {max_v:.2f}ms")
        print(f"  p50:  {p50:.2f}ms")
        print(f"  p95:  {p95:.2f}ms")
        print(f"  p99:  {p99:.2f}ms")

    stats(head_latencies, "HeadBucket Latency (Warm)")
    stats(put_latencies, "PutObject (1KB) Latency")
    stats(get_latencies, "GetObject (1KB) Latency")
    print("=" * 60)

if __name__ == "__main__":
    benchmark()
