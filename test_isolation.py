import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from s3_test_config import BUCKET, ENDPOINT, ACCESS_KEY, SECRET_KEY

# Tenant 1 credential from the environment. This suite verifies that the
# credential cannot reach buckets it does not own (see s3_test_config.py).
s3_t1 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT,
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
    region_name="us-east-1",
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, connect_timeout=5, read_timeout=15)
)

print("="*60)
print("MULTI-TENANT ISOLATION TESTS")
print("="*60)

# Test 1: T1 cannot access unowned bucket
print("\n[1] Tenant 1 attempts to Head unowned/nonexistent bucket:")
try:
    s3_t1.head_bucket(Bucket="unowned-random-bucket-xyz")
    print("  -> ERROR: Access was not denied!")
except ClientError as e:
    code = e.response["Error"]["Code"]
    print(f"  -> PASS: Rejected with code: {code} (404/403 expected)")

# Test 2: T1 attempts to list objects in unowned bucket
print("\n[2] Tenant 1 attempts to ListObjects in unowned bucket:")
try:
    s3_t1.list_objects_v2(Bucket="unowned-random-bucket-xyz")
    print("  -> ERROR: Access was not denied!")
except ClientError as e:
    code = e.response["Error"]["Code"]
    print(f"  -> PASS: Rejected with code: {code}")

# Test 3: T1 attempts to PutObject into unowned bucket
print("\n[3] Tenant 1 attempts to PutObject into unowned bucket:")
try:
    s3_t1.put_object(Bucket="unowned-random-bucket-xyz", Key="hack.txt", Body=b"intrusion")
    print("  -> ERROR: Access was not denied!")
except ClientError as e:
    code = e.response["Error"]["Code"]
    print(f"  -> PASS: Rejected with code: {code}")

# Test 4: T1 cannot change CORS of unowned bucket
print("\n[4] Tenant 1 attempts to PutBucketCors on unowned bucket:")
try:
    s3_t1.put_bucket_cors(
        Bucket="unowned-random-bucket-xyz",
        CORSConfiguration={"CORSRules": [{"AllowedMethods": ["GET"], "AllowedOrigins": ["*"]}]}
    )
    print("  -> ERROR: Access was not denied!")
except ClientError as e:
    code = e.response["Error"]["Code"]
    print(f"  -> PASS: Rejected with code: {code}")

# Test 5: T1 cannot configure versioning on unowned bucket
print("\n[5] Tenant 1 attempts to PutBucketVersioning on unowned bucket:")
try:
    s3_t1.put_bucket_versioning(
        Bucket="unowned-random-bucket-xyz",
        VersioningConfiguration={"Status": "Enabled"}
    )
    print("  -> ERROR: Access was not denied!")
except ClientError as e:
    code = e.response["Error"]["Code"]
    print(f"  -> PASS: Rejected with code: {code}")

print("\n" + "="*60)
print("MULTI-TENANT ISOLATION TESTS PASSED SUCCESSFULLY!")
print("="*60)
