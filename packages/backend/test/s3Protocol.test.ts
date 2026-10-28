import { describe, expect, it } from "vitest";
import {
  S3ProtocolError,
  decodeXmlBody,
  parseCompleteMultipart,
  parseDeleteObjects,
  parseS3Xml,
  parseTagging,
  parseVersioning,
  readS3Body,
  validateCors,
  validatePartNumber,
  validateS3Route,
  validateTags,
  validateUploadId,
  validateVersionId,
} from "../convex/s3Protocol";
import {
  bucketFromPath,
  keyFromPath,
  s3ActionForRequest,
} from "../convex/storageValidate";
import { configFromEnv } from "../convex/rustfs";

describe("S3 Protocol & Gateway Route Validation", () => {
  describe("Multipart Upload Routing & Validation", () => {
    it("accepts initiate multipart upload: POST /{bucket}/{key}?uploads", () => {
      expect(() =>
        validateS3Route("POST", "/my-bucket/path/to/file.bin", new URLSearchParams("uploads")),
      ).not.toThrow();
      const action = s3ActionForRequest({
        method: "POST",
        path: "/my-bucket/path/to/file.bin",
        query: new URLSearchParams("uploads"),
      });
      expect(action).toBe("s3:PutObject");
    });

    it("accepts upload part: PUT /{bucket}/{key}?partNumber={n}&uploadId={id}", () => {
      const q = new URLSearchParams("partNumber=1&uploadId=mp-upload-12345");
      expect(() =>
        validateS3Route("PUT", "/my-bucket/path/to/file.bin", q),
      ).not.toThrow();
      const action = s3ActionForRequest({
        method: "PUT",
        path: "/my-bucket/path/to/file.bin",
        query: q,
      });
      expect(action).toBe("s3:PutObject");
    });

    it("rejects upload part missing partNumber or with invalid partNumber", () => {
      expect(() =>
        validateS3Route("PUT", "/my-bucket/file.bin", new URLSearchParams("uploadId=mp-123")),
      ).toThrow(S3ProtocolError);

      expect(() => validatePartNumber("0")).toThrow(S3ProtocolError);
      expect(() => validatePartNumber("-1")).toThrow(S3ProtocolError);
      expect(() => validatePartNumber("10001")).toThrow(S3ProtocolError);
      expect(() => validatePartNumber("abc")).toThrow(S3ProtocolError);
      expect(validatePartNumber("1")).toBe(1);
      expect(validatePartNumber("10000")).toBe(10000);
    });

    it("validates uploadId format", () => {
      expect(() => validateUploadId("")).toThrow(S3ProtocolError);
      expect(() => validateUploadId("a".repeat(2049))).toThrow(S3ProtocolError);
      expect(() => validateUploadId("bad\x00id")).toThrow(S3ProtocolError);
      expect(() => validateUploadId("valid-upload.id_123")).not.toThrow();
    });

    it("accepts complete multipart upload: POST /{bucket}/{key}?uploadId={id}", () => {
      const q = new URLSearchParams("uploadId=mp-upload-12345");
      expect(() =>
        validateS3Route("POST", "/my-bucket/file.bin", q),
      ).not.toThrow();
      const action = s3ActionForRequest({
        method: "POST",
        path: "/my-bucket/file.bin",
        query: q,
      });
      expect(action).toBe("s3:PutObject");
    });

    it("accepts abort multipart upload: DELETE /{bucket}/{key}?uploadId={id}", () => {
      const q = new URLSearchParams("uploadId=mp-upload-12345");
      expect(() =>
        validateS3Route("DELETE", "/my-bucket/file.bin", q),
      ).not.toThrow();
      const action = s3ActionForRequest({
        method: "DELETE",
        path: "/my-bucket/file.bin",
        query: q,
      });
      expect(action).toBe("s3:DeleteObject");
    });

    it("accepts list parts: GET /{bucket}/{key}?uploadId={id}", () => {
      const q = new URLSearchParams("uploadId=mp-upload-12345&max-parts=100&part-number-marker=2");
      expect(() =>
        validateS3Route("GET", "/my-bucket/file.bin", q),
      ).not.toThrow();
      const action = s3ActionForRequest({
        method: "GET",
        path: "/my-bucket/file.bin",
        query: q,
      });
      expect(action).toBe("s3:GetObject");
    });

    it("accepts list multipart uploads: GET /{bucket}?uploads", () => {
      const q = new URLSearchParams("uploads&max-uploads=50&key-marker=foo&upload-id-marker=bar");
      expect(() =>
        validateS3Route("GET", "/my-bucket", q),
      ).not.toThrow();
      const action = s3ActionForRequest({
        method: "GET",
        path: "/my-bucket",
        query: q,
      });
      expect(action).toBe("s3:ListBucket");
    });

    it("rejects upload-id-marker without key-marker", () => {
      expect(() =>
        validateS3Route("GET", "/my-bucket", new URLSearchParams("uploads&upload-id-marker=bar")),
      ).toThrow(S3ProtocolError);
    });

    it("parses and validates CompleteMultipartUpload XML with ascending parts", () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
          <Part><PartNumber>1</PartNumber><ETag>"etag-1"</ETag></Part>
          <Part><PartNumber>2</PartNumber><ETag>"etag-2"</ETag></Part>
        </CompleteMultipartUpload>`;
      const parts = parseCompleteMultipart(xml);
      expect(parts).toEqual([
        { partNumber: 1, etag: '"etag-1"' },
        { partNumber: 2, etag: '"etag-2"' },
      ]);
    });

    it("rejects CompleteMultipartUpload with unordered or duplicate parts", () => {
      const unordered = `<?xml version="1.0" encoding="UTF-8"?>
        <CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
          <Part><PartNumber>2</PartNumber><ETag>"etag-2"</ETag></Part>
          <Part><PartNumber>1</PartNumber><ETag>"etag-1"</ETag></Part>
        </CompleteMultipartUpload>`;
      expect(() => parseCompleteMultipart(unordered)).toThrow(/InvalidPartOrder/);

      const duplicate = `<?xml version="1.0" encoding="UTF-8"?>
        <CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
          <Part><PartNumber>1</PartNumber><ETag>"etag-1"</ETag></Part>
          <Part><PartNumber>1</PartNumber><ETag>"etag-1-dup"</ETag></Part>
        </CompleteMultipartUpload>`;
      expect(() => parseCompleteMultipart(duplicate)).toThrow(/InvalidPartOrder/);
    });
  });

  describe("Bucket Operations (HeadBucket, Location, DeleteObjects, CORS)", () => {
    it("routes HeadBucket correctly to s3:ListBucket", () => {
      expect(() =>
        validateS3Route("HEAD", "/my-bucket", new URLSearchParams()),
      ).not.toThrow();
      const action = s3ActionForRequest({
        method: "HEAD",
        path: "/my-bucket",
        query: new URLSearchParams(),
      });
      expect(action).toBe("s3:ListBucket");
    });

    it("routes GetBucketLocation correctly to s3:GetBucketLocation", () => {
      expect(() =>
        validateS3Route("GET", "/my-bucket", new URLSearchParams("location")),
      ).not.toThrow();
      const action = s3ActionForRequest({
        method: "GET",
        path: "/my-bucket",
        query: new URLSearchParams("location"),
      });
      expect(action).toBe("s3:GetBucketLocation");
    });

    it("parses DeleteObjects batch delete XML and respects Quiet mode", () => {
      const xmlQuiet = `<?xml version="1.0" encoding="UTF-8"?>
        <Delete xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
          <Quiet>true</Quiet>
          <Object><Key>file1.txt</Key></Object>
          <Object><Key>file2.txt</Key><VersionId>v-123</VersionId></Object>
        </Delete>`;
      const batch1 = parseDeleteObjects(xmlQuiet);
      expect(batch1.quiet).toBe(true);
      expect(batch1.objects).toEqual([
        { key: "file1.txt" },
        { key: "file2.txt", versionId: "v-123" },
      ]);

      const xmlVerbose = `<?xml version="1.0" encoding="UTF-8"?>
        <Delete xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
          <Quiet>false</Quiet>
          <Object><Key>file1.txt</Key></Object>
        </Delete>`;
      const batch2 = parseDeleteObjects(xmlVerbose);
      expect(batch2.quiet).toBe(false);
      expect(batch2.objects).toHaveLength(1);
    });

    it("rejects empty batch or oversized batch (>1000 objects)", () => {
      const emptyXml = `<Delete xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></Delete>`;
      expect(() => parseDeleteObjects(emptyXml)).toThrow(S3ProtocolError);

      const oversizedObjects = Array.from({ length: 1001 }, (_, i) => `<Object><Key>f${i}.txt</Key></Object>`).join("");
      const oversizedXml = `<Delete xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${oversizedObjects}</Delete>`;
      expect(() => parseDeleteObjects(oversizedXml)).toThrow(/exceeds 1000/);
    });

    it("validates CORS configuration and rejects invalid rules", () => {
      const validXml = `<?xml version="1.0" encoding="UTF-8"?>
        <CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
          <CORSRule>
            <AllowedOrigin>https://example.com</AllowedOrigin>
            <AllowedMethod>GET</AllowedMethod>
            <AllowedMethod>PUT</AllowedMethod>
            <AllowedHeader>*</AllowedHeader>
            <MaxAgeSeconds>3000</MaxAgeSeconds>
          </CORSRule>
        </CORSConfiguration>`;
      expect(() => validateCors(validXml)).not.toThrow();

      const invalidMethod = `<?xml version="1.0" encoding="UTF-8"?>
        <CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
          <CORSRule>
            <AllowedOrigin>*</AllowedOrigin>
            <AllowedMethod>PATCH</AllowedMethod>
          </CORSRule>
        </CORSConfiguration>`;
      expect(() => validateCors(invalidMethod)).toThrow(/Invalid CORS method/);
    });

    it("routes CORS round-trip operations", () => {
      const q = new URLSearchParams("cors");
      expect(s3ActionForRequest({ method: "GET", path: "/b", query: q })).toBe("s3:GetBucketCors");
      expect(s3ActionForRequest({ method: "PUT", path: "/b", query: q })).toBe("s3:PutBucketCors");
      expect(s3ActionForRequest({ method: "DELETE", path: "/b", query: q })).toBe("s3:PutBucketCors");
    });
  });

  describe("Object and Bucket Tagging", () => {
    it("parses valid Tagging XML", () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <Tagging xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
          <TagSet>
            <Tag><Key>Environment</Key><Value>Production</Value></Tag>
            <Tag><Key>Project</Key><Value>S3Storage</Value></Tag>
          </TagSet>
        </Tagging>`;
      const tags = parseTagging(xml, false);
      expect(tags).toEqual([
        { key: "Environment", value: "Production" },
        { key: "Project", value: "S3Storage" },
      ]);
    });

    it("enforces maximum tag count limits (10 for object, 50 for bucket)", () => {
      const elevenTags = Array.from({ length: 11 }, (_, i) => ({ key: `k${i}`, value: `v${i}` }));
      expect(() => validateTags(elevenTags, true)).toThrow(/Too many tags/);
      expect(() => validateTags(elevenTags, false)).not.toThrow();

      const fiftyOneTags = Array.from({ length: 51 }, (_, i) => ({ key: `k${i}`, value: `v${i}` }));
      expect(() => validateTags(fiftyOneTags, false)).toThrow(/Too many tags/);
    });

    it("rejects reserved 'aws:' prefix and duplicate keys", () => {
      expect(() => validateTags([{ key: "aws:reserved", value: "val" }], false)).toThrow(/Tag keys/);
      expect(() =>
        validateTags([
          { key: "Env", value: "Dev" },
          { key: "Env", value: "Prod" },
        ], false),
      ).toThrow(/Tag keys/);
    });

    it("routes object and bucket tagging operations", () => {
      const q = new URLSearchParams("tagging");
      expect(s3ActionForRequest({ method: "GET", path: "/bucket", query: q })).toBe("s3:GetBucketTagging");
      expect(s3ActionForRequest({ method: "PUT", path: "/bucket", query: q })).toBe("s3:PutBucketTagging");
      expect(s3ActionForRequest({ method: "DELETE", path: "/bucket", query: q })).toBe("s3:PutBucketTagging");

      expect(s3ActionForRequest({ method: "GET", path: "/bucket/obj.txt", query: q })).toBe("s3:GetObjectTagging");
      expect(s3ActionForRequest({ method: "PUT", path: "/bucket/obj.txt", query: q })).toBe("s3:PutObjectTagging");
      expect(s3ActionForRequest({ method: "DELETE", path: "/bucket/obj.txt", query: q })).toBe("s3:DeleteObjectTagging");

      const qVer = new URLSearchParams("tagging&versionId=v-123");
      expect(s3ActionForRequest({ method: "GET", path: "/bucket/obj.txt", query: qVer })).toBe("s3:GetObjectVersionTagging");
      expect(s3ActionForRequest({ method: "PUT", path: "/bucket/obj.txt", query: qVer })).toBe("s3:PutObjectVersionTagging");
      expect(s3ActionForRequest({ method: "DELETE", path: "/bucket/obj.txt", query: qVer })).toBe("s3:DeleteObjectVersionTagging");
    });
  });

  describe("Versioning, Delete Markers, and ListObjectVersions", () => {
    it("parses VersioningConfiguration for Enabled and Suspended", () => {
      const enabled = `<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>Enabled</Status></VersioningConfiguration>`;
      expect(parseVersioning(enabled)).toBe("Enabled");

      const suspended = `<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>Suspended</Status></VersioningConfiguration>`;
      expect(parseVersioning(suspended)).toBe("Suspended");

      const invalid = `<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>Disabled</Status></VersioningConfiguration>`;
      expect(() => parseVersioning(invalid)).toThrow(S3ProtocolError);
    });

    it("rejects MfaDelete with 501 NotImplemented", () => {
      const mfa = `<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>Enabled</Status><MfaDelete>Enabled</MfaDelete></VersioningConfiguration>`;
      try {
        parseVersioning(mfa);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(S3ProtocolError);
        expect((e as S3ProtocolError).status).toBe(501);
      }
    });

    it("routes version-aware object operations", () => {
      const q = new URLSearchParams("versionId=v-abc-123");
      expect(s3ActionForRequest({ method: "GET", path: "/bucket/obj.txt", query: q })).toBe("s3:GetObjectVersion");
      expect(s3ActionForRequest({ method: "HEAD", path: "/bucket/obj.txt", query: q })).toBe("s3:GetObjectVersion");
      expect(s3ActionForRequest({ method: "DELETE", path: "/bucket/obj.txt", query: q })).toBe("s3:DeleteObjectVersion");
    });

    it("validates version identifiers", () => {
      expect(() => validateVersionId("")).toThrow(S3ProtocolError);
      expect(() => validateVersionId("a".repeat(1025))).toThrow(S3ProtocolError);
      expect(() => validateVersionId("bad\x01id")).toThrow(S3ProtocolError);
      expect(() => validateVersionId("3/L4bTzgIbvxPHUwHmMI8WmH61MVgmxK")).not.toThrow();
    });

    it("routes ListObjectVersions: GET /{bucket}?versions", () => {
      const q = new URLSearchParams("versions&prefix=test&key-marker=km&version-id-marker=vm&max-keys=500");
      expect(() => validateS3Route("GET", "/my-bucket", q)).not.toThrow();
      expect(s3ActionForRequest({ method: "GET", path: "/my-bucket", query: q })).toBe("s3:ListBucketVersions");
    });

    it("rejects version-id-marker without key-marker", () => {
      const q = new URLSearchParams("versions&version-id-marker=vm");
      expect(() => validateS3Route("GET", "/my-bucket", q)).toThrow(S3ProtocolError);
    });
  });

  describe("Path and Key Extraction", () => {
    it("extracts bucket name and object keys with slashes preserved", () => {
      expect(bucketFromPath("/my-bucket")).toBe("my-bucket");
      expect(bucketFromPath("/my-bucket/path/to/key.txt")).toBe("my-bucket");
      expect(keyFromPath("/my-bucket/path/to/key.txt")).toBe("path/to/key.txt");
      expect(keyFromPath("/my-bucket/file%20name.txt")).toBe("file name.txt");
    });
  });

  describe("XML Parser Security & Robustness", () => {
    it("handles CDATA and comments correctly", () => {
      const xml = `<Delete xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        <!-- Comment here -->
        <Object>
          <Key><![CDATA[Special<Key>]]></Key>
        </Object>
      </Delete>`;
      const res = parseDeleteObjects(xml);
      expect(res.objects).toEqual([{ key: "Special<Key>" }]);
    });

    it("rejects malformed XML, unclosed tags, and unknown root elements", () => {
      expect(() => parseS3Xml("<unclosed>", "Tagging")).toThrow(/MalformedXML/);
      expect(() => parseS3Xml("<WrongRoot xmlns='http://s3.amazonaws.com/doc/2006-03-01/'/>", "Tagging")).toThrow(/MalformedXML/);
    });
  });

  describe("Streaming Request Body Bounded Reader", () => {
    it("rejects bodies exceeding the configured maximum size", async () => {
      const largeContent = new Uint8Array(1024 * 1024); // 1 MB
      const req = new Request("http://localhost:3211/s3/bucket/obj", {
        method: "PUT",
        headers: { "content-length": String(largeContent.byteLength) },
        body: largeContent,
      });
      // Limit to 512 KB
      await expect(readS3Body(req, 512 * 1024)).rejects.toThrow(/EntityTooLarge/);
    });

    it("reads bounded bodies successfully", async () => {
      const content = new TextEncoder().encode("Hello S3 Gateway");
      const req = new Request("http://localhost:3211/s3/bucket/obj", {
        method: "PUT",
        headers: { "content-length": String(content.byteLength) },
        body: content,
      });
      const body = await readS3Body(req, 1024);
      expect(new TextDecoder().decode(body)).toBe("Hello S3 Gateway");
    });
  });
});
