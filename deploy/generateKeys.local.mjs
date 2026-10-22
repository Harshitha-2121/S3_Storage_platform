// Generate RS256 keypair for Convex Auth, write to temp files (Windows-safe).
import { writeFileSync } from "node:fs";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const keys = await generateKeyPair("RS256", { extractable: true });
const privateKey = (await exportPKCS8(keys.privateKey)).trimEnd().replace(/\n/g, " ");
const publicKey = await exportJWK(keys.publicKey);
const jwks = JSON.stringify({ keys: [{ use: "sig", ...publicKey }] });

writeFileSync(process.env.JWT_OUT || "/tmp/jwt_private_key", privateKey);
writeFileSync(process.env.JWKS_OUT || "/tmp/jwks", jwks);
console.log("OK");
