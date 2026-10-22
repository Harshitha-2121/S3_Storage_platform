// Generate a Convex Auth signing keypair (RS256). Writes the private key (single-line,
// spaces for newlines — the format @convex-dev/auth expects) and the JWKS to /tmp.
import { writeFileSync } from "node:fs";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const keys = await generateKeyPair("RS256", { extractable: true });
const privateKey = (await exportPKCS8(keys.privateKey))
  .trimEnd()
  .replace(/\n/g, " ");
const publicKey = await exportJWK(keys.publicKey);
const jwks = JSON.stringify({ keys: [{ use: "sig", ...publicKey }] });

writeFileSync("/tmp/jwt_private_key", privateKey);
writeFileSync("/tmp/jwks", jwks);
console.log("JWT keypair written to /tmp/jwt_private_key and /tmp/jwks");
