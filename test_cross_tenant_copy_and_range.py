import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

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

def run_tests():
    print("=" * 60)
    print("CROSS-TENANT COPYOBJECT & RANGE REQUEST REGRESSION TEST")
    print("=" * 60)

    # 1. Prepare an object in our owned bucket
    key = "source-doc.txt"
    content = b"0123456789ABCDEF" * 16 # 256 bytes
    s3.put_object(Bucket=BUCKET, Key=key, Body=content)
    print(f"  -> Uploaded test object '{key}' ({len(content)} bytes)")

    # 2. Test Range Requests
    # Request bytes 0-9
    resp = s3.get_object(Bucket=BUCKET, Key=key, Range="bytes=0-9")
    part = resp["Body"].read()
    assert part == b"0123456789", f"Expected b'0123456789', got {part}"
    assert resp.get("ContentRange") is not None or resp.get("ResponseMetadata", {}).get("HTTPHeaders", {}).get("content-range") is not None, "Content-Range header missing"
    print(f"  -> PASS: Range request 'bytes=0-9' returned exact 10 bytes: {part}")

    # Request bytes 10-19
    resp2 = s3.get_object(Bucket=BUCKET, Key=key, Range="bytes=10-19")
    part2 = resp2["Body"].read()
    assert part2 == b"ABCDEF0123", f"Expected b'ABCDEF0123', got {part2}"
    print(f"  -> PASS: Range request 'bytes=10-19' returned exact 10 bytes: {part2}")

    # 3. Test Authorized CopyObject within same tenant
    copy_dest = "copied-doc.txt"
    s3.copy_object(
        Bucket=BUCKET,
        Key=copy_dest,
        CopySource=f"/{BUCKET}/{key}",
    )
    copied_body = s3.get_object(Bucket=BUCKET, Key=copy_dest)["Body"].read()
    assert copied_body == content, "Copied content does not match source"
    print(f"  -> PASS: Authorized CopyObject within tenant succeeded ({copy_dest})")

    # 4. Test Cross-Tenant Unauthorized CopyObject (Copying from unowned/foreign bucket)
    unowned_buckets = [
        "victim-private-bucket",
        "another-tenant-bucket",
        "system-admin-bucket"
    ]
    for unowned in unowned_buckets:
        try:
            s3.copy_object(
                Bucket=BUCKET,
                Key=f"stolen-from-{unowned}.txt",
                CopySource=f"/{unowned}/secret.key",
            )
            print(f"  -> FAIL: Cross-tenant copy from {unowned} unexpectedly allowed!")
            raise AssertionError(f"Cross-tenant copy vulnerability not blocked for {unowned}")
        except ClientError as e:
            code = e.response["Error"]["Code"]
            print(f"  -> PASS: Cross-tenant copy from '{unowned}' blocked with code: {code}")
            assert code in ("AccessDenied", "NoSuchBucket"), f"Unexpected error code: {code}"

    # Cleanup
    s3.delete_object(Bucket=BUCKET, Key=key)
    s3.delete_object(Bucket=BUCKET, Key=copy_dest)
    print("  -> Cleanup complete.")
    print("=" * 60)
    print("ALL COPYOBJECT & RANGE TESTS PASSED!")
    print("=" * 60)

if __name__ == "__main__":
    run_tests()
