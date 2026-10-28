// Validation at the S3 protocol boundary. Persistence and response serialization
// remain native RustFS responsibilities; no parallel metadata/version store.
export class S3ProtocolError extends Error {
  public detail: string;
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(`${code}: ${message}`);
    this.name = code;
    this.detail = message;
  }
}

export function invalid(message: string): never {
  throw new S3ProtocolError("InvalidArgument", message);
}

export function validateVersionId(value: string): void {
  if (!value || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) {
    invalid("Invalid version identifier");
  }
}

export function validateUploadId(value: string): void {
  if (!value || value.length > 2048 || /[\x00-\x20\x7f]/.test(value)) {
    invalid("Invalid upload identifier");
  }
}

export function validatePartNumber(value: string): number {
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 10000) {
    invalid("Part number must be an integer between 1 and 10000");
  }
  return Number(value);
}

/** Validate routing without changing the URL/query that the client signed. */
export function validateS3Route(
  method: string,
  path: string,
  query: URLSearchParams,
): void {
  const slash = path.indexOf("/", 1);
  const object = slash >= 0 && slash < path.length - 1;
  const flags = ["uploads", "location", "delete", "cors", "tagging", "versioning", "versions"];
  for (const name of [...flags, "uploadId", "partNumber", "versionId", "max-parts", "part-number-marker", "max-uploads", "max-keys", "key-marker", "version-id-marker", "upload-id-marker"]) {
    if (query.getAll(name).length > 1) invalid(`Duplicate ${name} parameter`);
  }
  const selected = flags.filter((name) => query.has(name));
  if (selected.length > 1) invalid("Conflicting S3 subresources");
  for (const flag of selected) {
    if (query.get(flag) !== "") invalid(`${flag} must be a flag parameter`);
  }
  if (query.has("versionId")) {
    validateVersionId(query.get("versionId")!);
    if (!object || query.has("uploadId") || query.has("partNumber") || (selected.length && selected[0] !== "tagging")) {
      invalid("versionId is only valid for version-aware object operations");
    }
    if (!["GET", "HEAD", "DELETE"].includes(method) && !(method === "PUT" && query.has("tagging"))) {
      invalid("Unsupported version-aware operation");
    }
  }
  if (query.has("uploadId")) {
    validateUploadId(query.get("uploadId")!);
    if (!object || selected.length) invalid("uploadId requires an object and cannot be combined with another subresource");
    if (!["GET", "PUT", "POST", "DELETE"].includes(method)) invalid("Unsupported multipart method");
    if (method === "PUT" && !query.has("partNumber")) invalid("UploadPart requires partNumber");
  }
  if (query.has("partNumber")) {
    validatePartNumber(query.get("partNumber")!);
    if (!object || method !== "PUT" || !query.has("uploadId")) invalid("partNumber requires PUT and uploadId");
  }
  const flag = selected[0];
  if (flag) {
    const allowed = flag === "uploads"
      ? object ? ["POST"] : ["GET"]
      : flag === "tagging" || flag === "cors"
        ? ["GET", "PUT", "DELETE"]
        : flag === "versioning" ? ["GET", "PUT"]
          : flag === "delete" ? ["POST"] : ["GET"];
    if (!allowed.includes(method) || (object && !["tagging", "uploads"].includes(flag))) {
      throw new S3ProtocolError("MethodNotAllowed", "Method is not supported for this S3 subresource", 405);
    }
  }
  for (const [name, max] of [["max-parts", 1000], ["part-number-marker", 10000], ["max-uploads", 1000], ["max-keys", 1000]] as const) {
    const value = query.get(name);
    if (value !== null && (!/^\d+$/.test(value) || Number(value) > max)) invalid(`Invalid ${name}`);
  }
  if (query.has("version-id-marker") && !query.has("key-marker")) invalid("version-id-marker requires key-marker");
  if (query.has("upload-id-marker") && !query.has("key-marker")) invalid("upload-id-marker requires key-marker");
}

type XmlNode = { name: string; qualified: string; text: string; children: XmlNode[] };
const S3_NAMESPACE = "http://s3.amazonaws.com/doc/2006-03-01/";
function malformed(): never {
  throw new S3ProtocolError("MalformedXML", "The XML document is malformed or does not match the S3 schema");
}
const validXmlCharacter = (n: number) => n === 9 || n === 10 || n === 13 || (n >= 32 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff);

function xmlText(text: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return text.replace(/&([^;]*);|&/g, (_, entity: string | undefined) => {
    if (!entity) return malformed();
    if (entities[entity] !== undefined) return entities[entity]!;
    if (!/^#(?:\d+|x[0-9a-fA-F]+)$/.test(entity)) return malformed();
    const n = entity.startsWith("#x") ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!validXmlCharacter(n)) return malformed();
    return String.fromCodePoint(n);
  });
}

/** Small bounded structural parser for S3 configuration XML, not regex extraction.
 * Rejects DTDs/entities, arbitrary attributes, mixed content and unbound prefixes.
 * Supports the standard default namespace, optional XML declaration and CDATA.
 */
export function parseS3Xml(input: string, rootName: string): XmlNode {
  if (input.length > 2 * 1024 * 1024) malformed();
  let xml = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  for (const c of xml) if (!validXmlCharacter(c.codePointAt(0)!)) malformed();
  xml = xml.replace(/^<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?(?:\s+standalone=["'](?:yes|no)["'])?\s*\?>/i, "");
  const stack: Array<XmlNode & { qualified: string }> = [];
  let root: XmlNode | undefined;
  let prefix = "";
  let count = 0;
  let offset = 0;
  while (offset < xml.length) {
    if (xml.startsWith("<!--", offset)) {
      const end = xml.indexOf("-->", offset + 4);
      if (end < 0 || xml.slice(offset + 4, end).includes("--")) malformed();
      offset = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", offset)) {
      const end = xml.indexOf("]]>", offset + 9);
      if (end < 0 || !stack.length) malformed();
      stack[stack.length - 1]!.text += xml.slice(offset + 9, end);
      offset = end + 3;
      continue;
    }
    if (xml[offset] !== "<") {
      const end = xml.indexOf("<", offset);
      const text = xml.slice(offset, end < 0 ? xml.length : end);
      if (text.includes("]]>")) malformed();
      if (stack.length) stack[stack.length - 1]!.text += xmlText(text);
      else if (text.trim()) malformed();
      offset = end < 0 ? xml.length : end;
      continue;
    }
    const end = xml.indexOf(">", offset);
    if (end < 0) malformed();
    const token = xml.slice(offset + 1, end);
    offset = end + 1;
    if (token.startsWith("/")) {
      const node = stack.pop();
      if (!node || token.slice(1).trim() !== node.qualified) malformed();
      continue;
    }
    const match = /^([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)([\s\S]*?)(\/?)$/.exec(token);
    if (!match) return malformed();
    const qualified = match[1]!;
    const attrs = match[2]!.trim();
    if (!root && attrs) {
      const ns = /^xmlns(?::([A-Za-z_][\w.-]*))?\s*=\s*(["'])([^"']*)\2$/.exec(attrs);
      if (!ns || ns[3] !== S3_NAMESPACE) return malformed();
      prefix = ns[1] ? `${ns[1]}:` : "";
    } else if (attrs) return malformed();
    if ((prefix && !qualified.startsWith(prefix)) || (!prefix && qualified.includes(":"))) return malformed();
    const name = prefix ? qualified.slice(prefix.length) : qualified;
    const node = { name, qualified, text: "", children: [] as XmlNode[] };
    if (++count > 40005 || stack.length >= 16) return malformed();
    if (stack.length) stack[stack.length - 1]!.children.push(node);
    else if (root) return malformed();
    else root = node;
    if (!match[3]) stack.push(node);
  }
  if (stack.length || !root || root.name !== rootName) return malformed();
  return root;
}

function children(node: XmlNode, allowed: string[]): void {
  if (node.text.trim() || node.children.some((c) => !allowed.includes(c.name))) malformed();
}
function field(node: XmlNode, name: string, optional = false): string | undefined {
  const matches = node.children.filter((c) => c.name === name);
  if (!matches.length && optional) return undefined;
  if (matches.length !== 1 || matches[0]!.children.length) malformed();
  return matches[0]!.text;
}

export type S3Tag = { key: string; value: string };
export function validateTags(tags: S3Tag[], object: boolean): void {
  if (tags.length > (object ? 10 : 50)) throw new S3ProtocolError("InvalidTag", "Too many tags");
  const keys = new Set<string>();
  for (const { key, value } of tags) {
    if (!key || [...key].length > 128 || [...value].length > 256 || key.toLowerCase().startsWith("aws:") || keys.has(key) || !/^[\p{L}\p{N}\p{Z}_.:/=+@-]+$/u.test(key) || (value && !/^[\p{L}\p{N}\p{Z}_.:/=+@-]+$/u.test(value))) {
      throw new S3ProtocolError("InvalidTag", "Tag keys must be unique, nonreserved and 1–128 characters; values at most 256 characters using supported S3 tag characters");
    }
    keys.add(key);
  }
}
export function parseTagging(xml: string, object: boolean): S3Tag[] {
  const root = parseS3Xml(xml, "Tagging");
  children(root, ["TagSet"]);
  if (root.children.length !== 1) malformed();
  const set = root.children[0]!;
  children(set, ["Tag"]);
  const tags = set.children.map((node) => {
    children(node, ["Key", "Value"]);
    return { key: field(node, "Key")!, value: field(node, "Value")! };
  });
  validateTags(tags, object);
  return tags;
}

export function parseVersioning(xml: string): "Enabled" | "Suspended" {
  const root = parseS3Xml(xml, "VersioningConfiguration");
  children(root, ["Status", "MfaDelete"]);
  if (root.children.some((c) => c.name === "MfaDelete")) throw new S3ProtocolError("NotImplemented", "MFA delete is not supported", 501);
  const status = field(root, "Status");
  if (status !== "Enabled" && status !== "Suspended") invalid("Versioning status must be Enabled or Suspended");
  return status;
}

export type DeleteEntry = { key: string; versionId?: string };
export function parseDeleteObjects(xml: string): { objects: DeleteEntry[]; quiet: boolean } {
  const root = parseS3Xml(xml, "Delete");
  children(root, ["Object", "Quiet"]);
  const entries = root.children.filter((c) => c.name === "Object");
  if (!entries.length) malformed();
  if (entries.length > 1000) {
    throw new S3ProtocolError("MalformedXML", "Number of objects in DeleteObjects request exceeds 1000");
  }
  const quiet = field(root, "Quiet", true);
  if (quiet !== undefined && !["true", "false", "1", "0"].includes(quiet)) malformed();
  const objects = entries.map((node) => {
    children(node, ["Key", "VersionId"]);
    const key = field(node, "Key")!;
    if (!key || new TextEncoder().encode(key).length > 1024) invalid("Invalid object key in delete batch");
    const versionId = field(node, "VersionId", true);
    if (versionId !== undefined) validateVersionId(versionId);
    return { key, ...(versionId === undefined ? {} : { versionId }) };
  });
  return { objects, quiet: quiet === "true" || quiet === "1" };
}

export function parseCompleteMultipart(xml: string): Array<{ partNumber: number; etag: string }> {
  const root = parseS3Xml(xml, "CompleteMultipartUpload");
  children(root, ["Part"]);
  if (!root.children.length || root.children.length > 10000) malformed();
  let previous = 0;
  return root.children.map((node) => {
    children(node, ["PartNumber", "ETag"]);
    const partNumber = validatePartNumber(field(node, "PartNumber")!.trim());
    const etag = field(node, "ETag")!.trim();
    if (!etag || etag.length > 1024) throw new S3ProtocolError("InvalidPart", "Each part requires a valid ETag");
    if (partNumber <= previous) throw new S3ProtocolError("InvalidPartOrder", "Parts must be in ascending order without duplicates");
    previous = partNumber;
    return { partNumber, etag };
  });
}

export function validateCors(xml: string): void {
  const root = parseS3Xml(xml, "CORSConfiguration");
  children(root, ["CORSRule"]);
  if (!root.children.length || root.children.length > 100) malformed();
  for (const rule of root.children) {
    children(rule, ["ID", "AllowedOrigin", "AllowedMethod", "AllowedHeader", "ExposeHeader", "MaxAgeSeconds"]);
    const id = field(rule, "ID", true);
    if (id !== undefined && [...id].length > 255) invalid("CORS rule ID is too long");
    const age = field(rule, "MaxAgeSeconds", true);
    if (age !== undefined && (!/^\d+$/.test(age) || !Number.isSafeInteger(Number(age)))) invalid("Invalid CORS MaxAgeSeconds");
    if (!rule.children.some((c) => c.name === "AllowedOrigin") || !rule.children.some((c) => c.name === "AllowedMethod")) malformed();
    for (const entry of rule.children) {
      if (entry.children.length) malformed();
      if (entry.name === "AllowedMethod" && !["GET", "PUT", "HEAD", "POST", "DELETE"].includes(entry.text)) invalid("Invalid CORS method");
      if (["AllowedOrigin", "AllowedHeader", "ExposeHeader"].includes(entry.name) && (!entry.text || (entry.text.match(/\*/g)?.length ?? 0) > 1)) invalid("Invalid CORS origin/header");
    }
  }
}

/** Reject oversized streams before buffering the whole request. */
export async function readS3Body(req: Request, limit: number): Promise<Uint8Array> {
  const length = req.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) invalid("Invalid Content-Length");
  if (length !== null && Number(length) > limit) throw new S3ProtocolError("EntityTooLarge", "Gateway request exceeds the configured maximum", 413);
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new S3ProtocolError("EntityTooLarge", "Gateway request exceeds the configured maximum", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}

export function decodeXmlBody(body: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(body); }
  catch { return malformed(); }
}
