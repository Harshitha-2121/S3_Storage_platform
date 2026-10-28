// S3 gateway client for the reference backend.
//
// The signing primitives are the repository's own dependency-free SigV4
// implementation, reused rather than re-derived, so gateway-compatible
// signatures cannot drift from what the Convex gateway verifies.
//
// Note the deliberate difference from packages/rustfs: that client overwrites
// url.pathname to build RustFS-native paths. Here the endpoint already carries
// the `/s3` gateway prefix and the path is appended to it, because the gateway
// verifies the signature over the ORIGINAL path including that prefix.

import { EMPTY_PAYLOAD_HASH, sha256Hex, signRequest } from "../packages/rustfs/src/sigv4.ts";

export class S3ConnectionError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = "S3ConnectionError";
    this.code = code;
    this.status = status;
  }
}

const VERIFY_TIMEOUT_MS = 10_000;

/** Extract <Code>/<Message> from an S3 XML error body, bounded and non-fatal. */
function parseS3Error(xml) {
  const code = /<Code>([\s\S]{1,200}?)<\/Code>/.exec(xml);
  const message = /<Message>([\s\S]{1,400}?)<\/Message>/.exec(xml);
  return {
    code: code?.[1] ?? null,
    message: message?.[1] ?? null,
  };
}

export class GatewayS3Client {
  /**
   * @param {{endpoint: string, region: string, accessKeyId: string, secretAccessKey: string}} config
   */
  constructor(config) {
    this.endpoint = config.endpoint.replace(/\/+$/, "");
    this.region = config.region || "us-east-1";
    this.credential = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };
  }

  /** Build a gateway URL. Keys are encoded per segment so '/' stays a path separator. */
  urlFor(bucket, key, query) {
    const base = this.endpoint;
    let path = `/${bucket}`;
    if (key) {
      path += `/${key
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/")}`;
    }
    const url = new URL(base + path);
    if (query) {
      for (const [name, value] of Object.entries(query)) {
        url.searchParams.set(name, value);
      }
    }
    return url;
  }

  async send(method, bucket, key, { query, body, headers, timeoutMs = 30_000 } = {}) {
    const url = this.urlFor(bucket, key, query);
    const payloadHash =
      body === undefined ? EMPTY_PAYLOAD_HASH : await sha256Hex(body);
    const signed = await signRequest({
      method,
      url,
      credential: this.credential,
      region: this.region,
      service: "s3",
      headers,
      payloadHash,
    });
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: signed,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason =
        err && typeof err === "object" && "name" in err && err.name === "TimeoutError"
          ? "timed out"
          : "was unreachable";
      throw new S3ConnectionError(
        "EndpointUnreachable",
        `The S3 gateway endpoint ${reason}`,
        502,
      );
    }
    return res;
  }

  /**
   * Prove the stored credentials actually work end to end: signature verified,
   * credential resolved and not revoked, account active, bucket owned and in
   * scope, and RustFS reachable. A limited ListObjectsV2 is the cheapest call
   * that exercises every one of those checks (it maps to s3:ListBucket).
   */
  async verify(bucket) {
    const res = await this.send("GET", bucket, null, {
      query: { "list-type": "2", "max-keys": "1" },
      timeoutMs: VERIFY_TIMEOUT_MS,
    });
    if (res.ok) {
      // Drain so the socket is released.
      await res.text().catch(() => "");
      return { ok: true, status: res.status };
    }
    const text = await res.text().catch(() => "");
    const parsed = parseS3Error(text);
    const status = res.status;
    const code = parsed.code ?? (status === 403 ? "AccessDenied" : "VerificationFailed");
    throw new S3ConnectionError(
      code,
      parsed.message ?? `The S3 gateway rejected verification (HTTP ${status})`,
      502,
    );
  }
}
