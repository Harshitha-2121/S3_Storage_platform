import boto3
import sys
from botocore.client import Config
from botocore.exceptions import ClientError

from s3_test_config import BUCKET, ENDPOINT, ACCESS_KEY, SECRET_KEY, MULTIPART_MIN_PART_BYTES

s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT,
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
    region_name="us-east-1",
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, connect_timeout=5, read_timeout=30)
)

print("="*60)
print("S3 GATEWAY COMPREHENSIVE COMPATIBILITY TEST")
print("="*60)

# 1. HeadBucket
print("\n[1] Testing HeadBucket:")
try:
    head = s3.head_bucket(Bucket=BUCKET)
    print("  -> PASS: HeadBucket returned 200 OK")
except Exception as e:
    print("  -> FAIL HeadBucket:", e)

# 2. GetBucketLocation
print("\n[2] Testing GetBucketLocation:")
try:
    loc = s3.get_bucket_location(Bucket=BUCKET)
    print(f"  -> PASS: LocationConstraint = {loc.get('LocationConstraint')}")
except Exception as e:
    print("  -> FAIL GetBucketLocation:", e)

# 3. Multipart Upload
print("\n[3] Testing Multipart Upload Workflow:")
mp_key = "test-multipart/file.bin"
try:
    # 3a. Initiate
    init = s3.create_multipart_upload(Bucket=BUCKET, Key=mp_key)
    upload_id = init["UploadId"]
    print(f"  -> PASS: Initiated multipart upload. UploadId: {upload_id}")

    # 3b. Upload 2 Parts
    # S3 requires every non-final part to be >= 5 MiB; the final part may be smaller.
    part1_data = b"P" * MULTIPART_MIN_PART_BYTES
    part2_data = b"Q" * (256 * 1024)
    
    p1 = s3.upload_part(Bucket=BUCKET, Key=mp_key, UploadId=upload_id, PartNumber=1, Body=part1_data)
    etag1 = p1["ETag"]
    print(f"  -> PASS: Uploaded Part 1, ETag: {etag1}")

    p2 = s3.upload_part(Bucket=BUCKET, Key=mp_key, UploadId=upload_id, PartNumber=2, Body=part2_data)
    etag2 = p2["ETag"]
    print(f"  -> PASS: Uploaded Part 2, ETag: {etag2}")

    # 3c. List Parts
    parts = s3.list_parts(Bucket=BUCKET, Key=mp_key, UploadId=upload_id)
    listed_part_nums = [p["PartNumber"] for p in parts.get("Parts", [])]
    print(f"  -> PASS: ListParts returned part numbers: {listed_part_nums}")

    # 3d. Complete Multipart
    comp = s3.complete_multipart_upload(
        Bucket=BUCKET,
        Key=mp_key,
        UploadId=upload_id,
        MultipartUpload={"Parts": [{"PartNumber": 1, "ETag": etag1}, {"PartNumber": 2, "ETag": etag2}]}
    )
    print(f"  -> PASS: Completed Multipart Upload. Final Key: {comp.get('Key')}")

    # 3e. Verify object read
    obj = s3.get_object(Bucket=BUCKET, Key=mp_key)
    content = obj["Body"].read()
    expected = part1_data + part2_data
    assert content == expected, "Content mismatch!"
    print(f"  -> PASS: Verified completed object content ({len(content)} bytes)")

    # 3f. Test Abort on another upload
    init2 = s3.create_multipart_upload(Bucket=BUCKET, Key="test-abort.bin")
    s3.abort_multipart_upload(Bucket=BUCKET, Key="test-abort.bin", UploadId=init2["UploadId"])
    print("  -> PASS: AbortMultipartUpload succeeded")

    # 3g. Negative: a non-final part below 5 MiB must be rejected with
    # EntityTooSmall (this is the S3 specification, not an optional nicety).
    small_key = "test-small-parts.bin"
    small_init = s3.create_multipart_upload(Bucket=BUCKET, Key=small_key)
    small_upload_id = small_init["UploadId"]
    try:
        small_p1 = s3.upload_part(
            Bucket=BUCKET, Key=small_key, UploadId=small_upload_id,
            PartNumber=1, Body=b"A" * 1024,
        )
        small_p2 = s3.upload_part(
            Bucket=BUCKET, Key=small_key, UploadId=small_upload_id,
            PartNumber=2, Body=b"B" * 1024,
        )
        try:
            s3.complete_multipart_upload(
                Bucket=BUCKET,
                Key=small_key,
                UploadId=small_upload_id,
                MultipartUpload={"Parts": [
                    {"PartNumber": 1, "ETag": small_p1["ETag"]},
                    {"PartNumber": 2, "ETag": small_p2["ETag"]},
                ]},
            )
            print("  -> FAIL: multipart with a <5MiB non-final part was accepted")
        except ClientError as e:
            code = e.response["Error"]["Code"]
            if code == "EntityTooSmall":
                print("  -> PASS: small non-final part rejected with EntityTooSmall")
            else:
                print(f"  -> FAIL: expected EntityTooSmall, got {code}")
    finally:
        try:
            s3.abort_multipart_upload(Bucket=BUCKET, Key=small_key, UploadId=small_upload_id)
        except ClientError:
            pass

except Exception as e:
    print("  -> FAIL Multipart Upload:", e)

# 4. DeleteObjects (Batch Delete)
print("\n[4] Testing DeleteObjects (Batch Deletion):")
try:
    s3.put_object(Bucket=BUCKET, Key="batch1.txt", Body=b"b1")
    s3.put_object(Bucket=BUCKET, Key="batch2.txt", Body=b"b2")
    del_resp = s3.delete_objects(
        Bucket=BUCKET,
        Delete={"Objects": [{"Key": "batch1.txt"}, {"Key": "batch2.txt"}, {"Key": "nonexistent.txt"}]}
    )
    deleted_keys = [d["Key"] for d in del_resp.get("Deleted", [])]
    print(f"  -> PASS: DeleteObjects returned deleted keys: {deleted_keys}")
except Exception as e:
    print("  -> FAIL DeleteObjects:", e)

# 5. Bucket CORS Round-Trip
print("\n[5] Testing Bucket CORS (PUT, GET, DELETE):")
cors_rules = {
    "CORSRules": [
        {
            "AllowedHeaders": ["*"],
            "AllowedMethods": ["GET", "PUT", "POST"],
            "AllowedOrigins": ["https://example.com"],
            "MaxAgeSeconds": 3000
        }
    ]
}
try:
    s3.put_bucket_cors(Bucket=BUCKET, CORSConfiguration=cors_rules)
    print("  -> PASS: PutBucketCors succeeded")
    
    get_cors = s3.get_bucket_cors(Bucket=BUCKET)
    print(f"  -> PASS: GetBucketCors returned: {len(get_cors.get('CORSRules', []))} rules")

    s3.delete_bucket_cors(Bucket=BUCKET)
    print("  -> PASS: DeleteBucketCors succeeded")
except Exception as e:
    print("  -> FAIL Bucket CORS:", e)

# 6. Object & Bucket Tagging
print("\n[6] Testing Object & Bucket Tagging:")
try:
    # 6a. Bucket Tagging
    b_tags = {"TagSet": [{"Key": "Environment", "Value": "Production"}, {"Key": "Project", "Value": "S3Storage"}]}
    s3.put_bucket_tagging(Bucket=BUCKET, Tagging=b_tags)
    print("  -> PASS: PutBucketTagging succeeded")
    
    got_b_tags = s3.get_bucket_tagging(Bucket=BUCKET)
    print(f"  -> PASS: GetBucketTagging returned: {got_b_tags.get('TagSet')}")

    s3.delete_bucket_tagging(Bucket=BUCKET)
    print("  -> PASS: DeleteBucketTagging succeeded")

    # 6b. Object Tagging
    s3.put_object(Bucket=BUCKET, Key="tagged-obj.txt", Body=b"tagged payload")
    o_tags = {"TagSet": [{"Key": "Classification", "Value": "Confidential"}]}
    s3.put_object_tagging(Bucket=BUCKET, Key="tagged-obj.txt", Tagging=o_tags)
    print("  -> PASS: PutObjectTagging succeeded")

    got_o_tags = s3.get_object_tagging(Bucket=BUCKET, Key="tagged-obj.txt")
    print(f"  -> PASS: GetObjectTagging returned: {got_o_tags.get('TagSet')}")

    s3.delete_object_tagging(Bucket=BUCKET, Key="tagged-obj.txt")
    print("  -> PASS: DeleteObjectTagging succeeded")
except Exception as e:
    print("  -> FAIL Tagging:", e)

# 7. Bucket Versioning & ListObjectVersions
print("\n[7] Testing Bucket Versioning & ListObjectVersions:")
try:
    s3.put_bucket_versioning(Bucket=BUCKET, VersioningConfiguration={"Status": "Enabled"})
    print("  -> PASS: PutBucketVersioning (Enabled) succeeded")

    v_status = s3.get_bucket_versioning(Bucket=BUCKET)
    print(f"  -> PASS: GetBucketVersioning returned: {v_status.get('Status')}")

    # Write multiple versions
    v1 = s3.put_object(Bucket=BUCKET, Key="versioned-file.txt", Body=b"Version 1 content")
    v1_id = v1.get("VersionId")
    print(f"  -> PASS: Wrote Version 1, VersionId: {v1_id}")

    v2 = s3.put_object(Bucket=BUCKET, Key="versioned-file.txt", Body=b"Version 2 overwritten content")
    v2_id = v2.get("VersionId")
    print(f"  -> PASS: Wrote Version 2, VersionId: {v2_id}")

    # Read latest
    latest = s3.get_object(Bucket=BUCKET, Key="versioned-file.txt")
    print(f"  -> PASS: GetObject (latest) returned: {latest['Body'].read().decode('utf-8')}")

    # Read specific historical version
    hist = s3.get_object(Bucket=BUCKET, Key="versioned-file.txt", VersionId=v1_id)
    print(f"  -> PASS: GetObject (v1 historical) returned: {hist['Body'].read().decode('utf-8')}")

    # Delete marker
    del_marker = s3.delete_object(Bucket=BUCKET, Key="versioned-file.txt")
    print(f"  -> PASS: DeleteObject created DeleteMarker: {del_marker.get('DeleteMarker')}")

    # ListObjectVersions
    versions = s3.list_object_versions(Bucket=BUCKET, Prefix="versioned-file.txt")
    v_count = len(versions.get("Versions", []))
    dm_count = len(versions.get("DeleteMarkers", []))
    print(f"  -> PASS: ListObjectVersions returned {v_count} versions and {dm_count} delete markers")

    # Clean up specific version
    s3.delete_object(Bucket=BUCKET, Key="versioned-file.txt", VersionId=v1_id)
    print("  -> PASS: Deleted specific Version 1")

except Exception as e:
    print("  -> FAIL Versioning:", e)

print("\n" + "="*60)
print("TEST RUN COMPLETED")
print("="*60)
