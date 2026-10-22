import {
  EMPTY_PAYLOAD_HASH,
  presignUrl,
  sha256Hex,
  signRequest,
  type Credential,
} from "./sigv4";
import type { RustFSConfig } from "./config";
import {
  parseErrorResponse,
  parseListObjectsV2,
  type ParsedObjectListing,
} from "./xml";

export type { Credential } from "./sigv4";

/** Error raised for non-2xx RustFS responses. */
export class RustFSError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(
      message ? `${code}: ${message} (HTTP ${status})` : `${code} (HTTP ${status})`,
    );
    this.name = "RustFSError";
    this.status = status;
    this.code = code;
  }
}

export type ObjectMetadata = {
  size: number;
  contentType: string;
  etag: string;
};

/** A RustFS IAM service account (customer-facing S3 credential). */
export type ServiceAccount = {
  accessKey: string;
  /** Only present in the create-service-account response. */
  secretKey: string | null;
  user: string | null;
  name: string | null;
  description: string | null;
  expiration: string | null;
  status: string | null;
};

export type UserInfo = {
  accessKey: string;
  status: string | null;
  memberOf: string[];
  policy: string | null;
};

export type ListUsersResult = {
  users: Array<{
    accessKey: string;
    status: string | null;
    creationDate: string | null;
  }>;
};

/** Request options shared by all signed requests. */
type SendOptions = {
  headers?: Record<string, string>;
  body?: string | Uint8Array;
};

/**
 * Minimal, dependency-free RustFS (S3-compatible) client.
 *
 * Every request is SigV4-signed with Web Crypto. The root credential
 * is used exclusively for the administrative API (/rustfs/admin/v3);
 * data-plane operations take the calling account's own credential so
 * tenant isolation is enforced by RustFS IAM policies, not by this
 * client.
 */
export class RustFSClient {
  constructor(private readonly config: RustFSConfig) {}

  private buildUrl(path: string, query?: Record<string, string>): URL {
    const url = new URL(this.config.endpoint);
    url.pathname = path;
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }
    return url;
  }

  private async send(
    method: "GET" | "PUT" | "DELETE" | "HEAD",
    url: URL,
    credential: Credential,
    options: SendOptions = {},
  ): Promise<Response> {
    const payloadHash =
      options.body === undefined
        ? EMPTY_PAYLOAD_HASH
        : await sha256Hex(options.body);
    const signed = await signRequest({
      method,
      url,
      credential,
      region: this.config.region,
      service: "s3",
      payloadHash,
      headers: options.headers,
    });
    return fetch(url, { method, headers: signed, body: options.body });
  }

  private async toError(res: Response): Promise<RustFSError> {
    const text = await res.text().catch(() => "");
    const parsed = parseErrorResponse(text);
    return new RustFSError(
      res.status,
      parsed?.code ?? "UnknownError",
      parsed?.message ?? (text || res.statusText),
    );
  }

  /** Administrative request signed with the root credential. */
  private async admin(
    method: "GET" | "PUT" | "DELETE",
    operation: string,
    query: Record<string, string> = {},
    body?: string,
  ): Promise<Response> {
    const url = this.buildUrl(`/rustfs/admin/v3/${operation}`, query);
    const res = await this.send(method, url, this.config.rootCredential, {
      headers:
        body === undefined
          ? undefined
          : { "content-type": "application/json" },
      body,
    });
    if (!res.ok) throw await this.toError(res);
    return res;
  }

  // ── Administrative API (root credential only) ─────────────────

  async listUsers(): Promise<ListUsersResult> {
    const res = await this.admin("GET", "list-users");
    const json = (await res
      .json()
      .catch(() => ({}))) as {
      users?: Array<{
        accessKey?: string;
        status?: string;
        creationDate?: string;
      }>;
    };
    return {
      users: (json.users ?? []).map((user) => ({
        accessKey: user.accessKey ?? "",
        status: user.status ?? null,
        creationDate: user.creationDate ?? null,
      })),
    };
  }

  /** Create (or update) an IAM user. The secret is shown only here. */
  async createUser(accessKey: string, secretKey: string): Promise<void> {
    await this.admin(
      "PUT",
      "add-user",
      { accessKey },
      JSON.stringify({ secretKey, status: "enabled" }),
    );
  }

  async getUserInfo(accessKey: string): Promise<UserInfo | null> {
    try {
      const res = await this.admin("GET", "user-info", { accessKey });
      const json = (await res.json()) as {
        accessKey?: string;
        status?: string;
        memberOf?: string[];
        policy?: string;
      };
      return {
        accessKey: json.accessKey ?? accessKey,
        status: json.status ?? null,
        memberOf: json.memberOf ?? [],
        policy: json.policy ?? null,
      };
    } catch (err) {
      if (
        err instanceof RustFSError &&
        (err.status === 404 || err.code === "NoSuchUser")
      ) {
        return null;
      }
      throw err;
    }
  }

  async deleteUser(accessKey: string): Promise<void> {
    await this.admin("DELETE", "remove-user", { accessKey });
  }

  async addCannedPolicy(name: string, policy: unknown): Promise<void> {
    await this.admin(
      "PUT",
      "add-canned-policy",
      { name },
      JSON.stringify(policy),
    );
  }

  async removeCannedPolicy(name: string): Promise<void> {
    await this.admin("DELETE", "remove-canned-policy", { name });
  }

  async getCannedPolicy(name: string): Promise<unknown | null> {
    try {
      const res = await this.admin("GET", "info-canned-policy", { name });
      return await res.json();
    } catch (err) {
      if (
        err instanceof RustFSError &&
        (err.status === 404 || err.code === "NoSuchPolicy")
      ) {
        return null;
      }
      throw err;
    }
  }

  /** Attach a canned policy to an IAM user (or group when isGroup). */
  async setUserPolicy(
    policyName: string,
    userOrGroup: string,
    isGroup = false,
  ): Promise<void> {
    await this.admin("PUT", "set-user-or-group-policy", {
      policyName,
      userOrGroup,
      isGroup: String(isGroup),
    });
  }

  /**
   * Issue a service account for an IAM user. Omitting the access key
   * makes RustFS generate the credentials; the secret is returned
   * only in this response.
   */
  async createServiceAccount(input: {
    targetUser: string;
    name?: string;
    description?: string;
    /** RFC 3339 expiration. */
    expiration?: string;
  }): Promise<ServiceAccount> {
    const body: Record<string, string> = { targetUser: input.targetUser };
    if (input.name) body.name = input.name;
    if (input.description) body.description = input.description;
    if (input.expiration) body.expiration = input.expiration;
    const res = await this.admin(
      "PUT",
      "add-service-account",
      {},
      JSON.stringify(body),
    );
    return parseServiceAccount(await res.json());
  }

  async listServiceAccounts(user: string): Promise<ServiceAccount[]> {
    const res = await this.admin("GET", "list-service-accounts", { user });
    const json = (await res.json().catch(() => ({}))) as {
      accounts?: Array<Record<string, unknown>>;
    };
    return (json.accounts ?? []).map(parseServiceAccount);
  }

  async deleteServiceAccount(accessKey: string): Promise<void> {
    await this.admin("DELETE", "delete-service-account", { accessKey });
  }

  // ── Data-plane API (account credential) ───────────────────────

  async createBucket(credential: Credential, bucket: string): Promise<void> {
    const res = await this.send(
      "PUT",
      this.buildUrl(`/${bucket}`),
      credential,
    );
    if (!res.ok) throw await this.toError(res);
  }

  async deleteBucket(credential: Credential, bucket: string): Promise<void> {
    const res = await this.send(
      "DELETE",
      this.buildUrl(`/${bucket}`),
      credential,
    );
    if (!res.ok) throw await this.toError(res);
  }

  async bucketExists(
    credential: Credential,
    bucket: string,
  ): Promise<boolean> {
    const res = await this.send(
      "HEAD",
      this.buildUrl(`/${bucket}`),
      credential,
    );
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    throw await this.toError(res);
  }

  async putObject(
    credential: Credential,
    bucket: string,
    key: string,
    body: string | Uint8Array,
    contentType = "application/octet-stream",
  ): Promise<{ etag: string }> {
    const res = await this.send(
      "PUT",
      this.buildUrl(`/${bucket}/${key}`),
      credential,
      { headers: { "content-type": contentType }, body },
    );
    if (!res.ok) throw await this.toError(res);
    return { etag: res.headers.get("etag") ?? "" };
  }

  /** GET an object. The caller consumes (and must close) the response. */
  async getObject(
    credential: Credential,
    bucket: string,
    key: string,
  ): Promise<Response> {
    const res = await this.send(
      "GET",
      this.buildUrl(`/${bucket}/${key}`),
      credential,
    );
    if (!res.ok) throw await this.toError(res);
    return res;
  }

  async headObject(
    credential: Credential,
    bucket: string,
    key: string,
  ): Promise<ObjectMetadata | null> {
    const res = await this.send(
      "HEAD",
      this.buildUrl(`/${bucket}/${key}`),
      credential,
    );
    if (res.status === 200) {
      return {
        size: Number(res.headers.get("content-length") ?? 0),
        contentType:
          res.headers.get("content-type") ?? "application/octet-stream",
        etag: res.headers.get("etag") ?? "",
      };
    }
    if (res.status === 404) return null;
    throw await this.toError(res);
  }

  async deleteObject(
    credential: Credential,
    bucket: string,
    key: string,
  ): Promise<void> {
    const res = await this.send(
      "DELETE",
      this.buildUrl(`/${bucket}/${key}`),
      credential,
    );
    if (!res.ok) throw await this.toError(res);
  }

  async listObjectsV2(
    credential: Credential,
    bucket: string,
    options: {
      prefix?: string;
      continuationToken?: string;
      maxKeys?: number;
    } = {},
  ): Promise<ParsedObjectListing> {
    const query: Record<string, string> = { "list-type": "2" };
    if (options.prefix) query.prefix = options.prefix;
    if (options.continuationToken) {
      query["continuation-token"] = options.continuationToken;
    }
    if (options.maxKeys) query["max-keys"] = String(options.maxKeys);
    const res = await this.send(
      "GET",
      this.buildUrl(`/${bucket}`, query),
      credential,
    );
    if (!res.ok) throw await this.toError(res);
    return parseListObjectsV2(await res.text(), bucket);
  }

  /**
   * Presigned URL for direct client-to-RustFS transfers (no bytes
   * flow through the application servers). extraSignedHeaders (e.g.
   * a content-type on PUTs) must be sent unchanged with the URL.
   */
  async presign(
    credential: Credential,
    method: "GET" | "PUT" | "DELETE",
    bucket: string,
    key: string,
    expiresSecs: number,
    extraSignedHeaders?: Record<string, string>,
  ): Promise<string> {
    return presignUrl({
      method,
      url: this.buildUrl(`/${bucket}/${key}`),
      credential,
      region: this.config.region,
      service: "s3",
      expiresSecs,
      extraSignedHeaders,
    });
  }
}

function parseServiceAccount(
  json: Record<string, unknown>,
): ServiceAccount {
  const text = (value: unknown) =>
    typeof value === "string" ? value : null;
  return {
    accessKey: text(json.accessKey) ?? "",
    secretKey: text(json.secretKey),
    user: text(json.user),
    name: text(json.name),
    description: text(json.description),
    expiration: text(json.expiration),
    status: text(json.status),
  };
}
