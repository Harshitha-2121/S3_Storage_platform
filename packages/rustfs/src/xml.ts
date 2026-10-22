/** One object in a ListObjectsV2 result. */
export type ParsedObject = {
  key: string;
  size: number;
  etag: string;
  lastModified: string;
};

export type ParsedObjectListing = {
  bucket: string;
  prefix: string;
  objects: ParsedObject[];
  isTruncated: boolean;
  nextContinuationToken: string | null;
  keyCount: number;
};

/**
 * Decode the five predefined XML entities plus numeric character
 * references. &amp; must be decoded last.
 */
export function unescapeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number(decimal)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Extract an S3 error document's code and message, or null if absent. */
export function parseErrorResponse(
  xml: string,
): { code: string; message: string } | null {
  const code = /<Code>([\s\S]*?)<\/Code>/.exec(xml);
  const message = /<Message>([\s\S]*?)<\/Message>/.exec(xml);
  if (!code && !message) return null;
  return {
    code: code ? unescapeXml(code[1] ?? "") : "UnknownError",
    message: message ? unescapeXml(message[1] ?? "") : "",
  };
}

/**
 * Parse a ListObjectsV2 XML document. S3 list responses are flat and
 * predictable, so targeted extraction is sufficient and avoids a DOM
 * dependency (which Node does not provide).
 */
export function parseListObjectsV2(
  xml: string,
  bucket: string,
): ParsedObjectListing {
  const objects: ParsedObject[] = [];
  const contents = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match: RegExpExecArray | null;
  while ((match = contents.exec(xml)) !== null) {
    const block = match[1] ?? "";
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(block);
    if (!key) continue;
    const size = /<Size>([\s\S]*?)<\/Size>/.exec(block);
    const etag = /<ETag>([\s\S]*?)<\/ETag>/.exec(block);
    const lastModified = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(block);
    objects.push({
      key: unescapeXml(key[1] ?? ""),
      size: size ? Number(size[1]) : 0,
      etag: etag ? unescapeXml(etag[1] ?? "") : "",
      lastModified: lastModified?.[1] ?? "",
    });
  }
  const prefix = /<Prefix>([\s\S]*?)<\/Prefix>/.exec(xml);
  const truncated = /<IsTruncated>([\s\S]*?)<\/IsTruncated>/.exec(xml);
  const nextContinuationToken =
    /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml);
  const keyCount = /<KeyCount>([\s\S]*?)<\/KeyCount>/.exec(xml);
  return {
    bucket,
    prefix: prefix ? unescapeXml(prefix[1] ?? "") : "",
    objects,
    isTruncated: (truncated?.[1] ?? "").trim().toLowerCase() === "true",
    nextContinuationToken: nextContinuationToken?.[1] ?? null,
    keyCount: keyCount ? Number(keyCount[1]) : objects.length,
  };
}
