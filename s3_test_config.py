"""Shared configuration for S3 gateway integration tests.

Credentials are NEVER stored in this repository. Provide them through the
environment (see `.env.s3-test.example`):

    S3_TEST_ENDPOINT    optional, defaults to http://127.0.0.1:3211/s3
    S3_TEST_ACCESS_KEY  required
    S3_TEST_SECRET_KEY  required
    S3_TEST_BUCKET      required

Tests fail fast with an actionable message when a required value is missing
instead of silently skipping or using a hardcoded credential.
"""

import os
import sys


DEFAULT_ENDPOINT = "http://127.0.0.1:3211/s3"


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        sys.stderr.write(
            f"\nERROR: missing required environment variable {name}.\n"
            "Set it in your shell or copy `.env.s3-test.example` to a private\n"
            "file (never commit it) and export the values before running.\n"
        )
        raise SystemExit(2)
    return value


ENDPOINT: str = os.environ.get("S3_TEST_ENDPOINT", DEFAULT_ENDPOINT).rstrip("/")
ACCESS_KEY: str = _required("S3_TEST_ACCESS_KEY")
SECRET_KEY: str = _required("S3_TEST_SECRET_KEY")
BUCKET: str = _required("S3_TEST_BUCKET")

# S3 requires every non-final multipart part to be at least this large.
MULTIPART_MIN_PART_BYTES = 5 * 1024 * 1024


def redact(value: str) -> str:
    """Mask secrets in diagnostics so failures never print credentials."""
    if not value:
        return "<unset>"
    if len(value) <= 6:
        return "*" * len(value)
    return f"{value[:2]}{'*' * (len(value) - 4)}{value[-2:]}"
