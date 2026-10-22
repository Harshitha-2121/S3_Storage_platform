// Generate the RS256 keypair Convex Auth needs (JWT_PRIVATE_KEY + JWKS).
// Uses `jose`, which ships as a dependency of @convex-dev/auth.
// Run from inside /opt/myos so `jose` resolves from node_modules.
import { writeFileSync } from "node:fs";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const keys = await generateKeyPair("RS256", { extractable: true });
const privateKey = (await exportPKCS8(keys.privateKey)).trimEnd().replace(/\n/g, " ");
const publicKey = await exportJWK(keys.publicKey);
const jwks = JSON.stringify({ keys: [{ use: "sig", ...publicKey }] });

writeFileSync("/tmp/jwt_private_key", privateKey);
writeFileSync("/tmp/jwks", jwks);
console.log("JWT keys generated (private key + JWKS written to /tmp).");
