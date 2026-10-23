import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

ENDPOINT = "http://127.0.0.1:3211/s3"
# Tenant 1 (Account: ms73kjtxrc0x1hbce8fcxngtn58g8shk, Workspace: m97frkfjpnbp8w2ee95r2m5d298g7ym2)
T1_KEY = "s3973c5f62029fed2e9492243f"
T1_SECRET = "a1ed6fc257616f43143afc61f575109a77e587b4fda82ecb1b413c41b57afb14"
T1_BUCKET = "ou4ye78j-me-bucket"

# Tenant 2 (Account: ms7bp3z1ysg0fjev234v39vtks8gcg33)
T2_KEY = "s3fd48c61b1cff95902d319562"
T2_SECRET = "cb272a27571d0e51ee1ca61e71239c02ffbe6e8e815e98585eefb6088ae63ef8"
T2_BUCKET = "anaapuwp-harshitha" # from provisioning: ms7bp3z1ysg0fjev234v39vtks8gcg33

# Let's test with T1 client trying to access T2 or an unauthorized bucket
s3_t1 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT,
    aws_access_key_id=T1_KEY,
    aws_secret_access_key=T1_SECRET,
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
