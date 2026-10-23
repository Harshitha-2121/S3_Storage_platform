import boto3
from botocore.client import Config

ENDPOINT = "http://127.0.0.1:3211/s3"
KEY_ID = "s3973c5f62029fed2e9492243f"
SECRET = "a1ed6fc257616f43143afc61f575109a77e587b4fda82ecb1b413c41b57afb14"
BUCKET = "ou4ye78j-me-bucket"

s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT,
    aws_access_key_id=KEY_ID,
    aws_secret_access_key=SECRET,
    region_name="us-east-1",
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, connect_timeout=5, read_timeout=60)
)

print("Testing 5MB Part Multipart Upload & Complete...")
mp_key = "large-mp-test.bin"
init = s3.create_multipart_upload(Bucket=BUCKET, Key=mp_key)
upload_id = init["UploadId"]
print(f"Initiated: {upload_id}")

# 5MB + 10 bytes for part 1 (satisfies >= 5MB S3 part min), and 1MB for part 2 (last part can be any size)
part1_data = b"X" * (5 * 1024 * 1024 + 10)
part2_data = b"Y" * (1024 * 1024)

p1 = s3.upload_part(Bucket=BUCKET, Key=mp_key, UploadId=upload_id, PartNumber=1, Body=part1_data)
print(f"Part 1 uploaded: {p1['ETag']}")

p2 = s3.upload_part(Bucket=BUCKET, Key=mp_key, UploadId=upload_id, PartNumber=2, Body=part2_data)
print(f"Part 2 uploaded: {p2['ETag']}")

comp = s3.complete_multipart_upload(
    Bucket=BUCKET,
    Key=mp_key,
    UploadId=upload_id,
    MultipartUpload={"Parts": [{"PartNumber": 1, "ETag": p1["ETag"]}, {"PartNumber": 2, "ETag": p2["ETag"]}]}
)
print(f"Multipart upload completed successfully: {comp['Key']}, ETag: {comp['ETag']}")

# Verify object size
head = s3.head_object(Bucket=BUCKET, Key=mp_key)
print(f"Verified object size: {head['ContentLength']} bytes (expected: {len(part1_data) + len(part2_data)})")
assert head['ContentLength'] == len(part1_data) + len(part2_data), "Size mismatch"

# Clean up
s3.delete_object(Bucket=BUCKET, Key=mp_key)
print("Cleaned up multipart object.")
print("ALL MULTIPART TESTS PASSED!")
