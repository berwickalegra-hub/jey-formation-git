# Credentials Encryption (AES-256-GCM)

Why encrypt API keys at rest? In a BYOK marketplace you store credentials for many merchants. A compromised database snapshot would otherwise leak every merchant's keys. AES-256-GCM with a master key kept in the secrets manager (env var) means a DB-only leak is useless without the master key.

## Algorithm

- **AES-256-GCM** — authenticated encryption (provides both confidentiality and integrity).
- **256-bit key** (32 bytes), base64-encoded in env.
- **96-bit IV** (12 bytes) — random per encryption, GCM standard.
- **128-bit auth tag** (16 bytes) — produced by GCM, stored alongside ciphertext.

## Storage shape

```ts
export type EncryptedPayload = {
  ciphertext: string; // base64
  nonce: string; // base64 (the 12-byte IV)
  authTag: string; // base64 (16-byte GCM tag)
  algorithm: "aes-256-gcm";
  keyVersion: number; // 1, 2, ... for rotation
};
```

This struct goes into a `jsonb` column in Postgres (or `JSON` in MySQL). Your `payment_connections.credentials_encrypted` column stores one of these blobs. The plaintext is the JSON-serialized credentials object: `{ secretKey, webhookSecret, ... }`.

## Master key — generation

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Output looks like: `Z6JZ5kqQ2Z8h0V8NuKjV9P9TZ7n6CkIwL1Y3tRXjLhA=`

Store as `BYOK_ENCRYPTION_KEY` in your secrets manager (Doppler, AWS Secrets Manager, Vercel env, fly.io secrets, etc.). NEVER commit. NEVER log. NEVER include in client bundles.

For key rotation, set `BYOK_ENCRYPTION_KEY_V2`, increment `CURRENT_KEY_VERSION` to 2 in code, and existing rows continue to decrypt with v1 since their `keyVersion` field directs to the right env var. Re-encrypt rows lazily as merchants edit their connections.

## Implementation (drop-in)

```ts
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITHM = "aes-256-gcm" as const;
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const CURRENT_KEY_VERSION = 1;

export type EncryptedPayload = {
  ciphertext: string;
  nonce: string;
  authTag: string;
  algorithm: typeof ALGORITHM;
  keyVersion: number;
};

function resolveKeyEnvVar(version: number): string {
  return version === 1
    ? "BYOK_ENCRYPTION_KEY"
    : `BYOK_ENCRYPTION_KEY_V${version}`;
}

function getKey(version: number = CURRENT_KEY_VERSION): Buffer {
  const envName = resolveKeyEnvVar(version);
  const raw = process.env[envName];
  if (!raw) {
    throw new Error(
      `Missing env var ${envName}. Generate one with generateEncryptionKey() (base64-encoded 32 bytes).`,
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== KEY_LENGTH) {
    throw new Error(
      `${envName} must decode to exactly ${KEY_LENGTH} bytes (got ${buf.length}). Did you base64-encode 32 random bytes?`,
    );
  }
  return buf;
}

export function encryptCredentials<T extends Record<string, unknown>>(
  plaintext: T,
): EncryptedPayload {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(plaintext), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("base64"),
    nonce: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    algorithm: ALGORITHM,
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export function decryptCredentials<T = Record<string, unknown>>(
  payload: EncryptedPayload,
): T {
  if (payload.algorithm !== ALGORITHM) {
    throw new Error(`Unsupported algorithm: ${payload.algorithm}`);
  }
  const key = getKey(payload.keyVersion);
  const iv = Buffer.from(payload.nonce, "base64");
  const authTag = Buffer.from(payload.authTag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

export function generateEncryptionKey(): string {
  return randomBytes(KEY_LENGTH).toString("base64");
}
```

Full file: [`../examples/encryption.ts`](../examples/encryption.ts).

## Usage in a typical CRUD flow

### Saving a connection

```ts
import { encryptCredentials } from "@/lib/encryption";
import { monerooCredentialsSchema } from "@/lib/payments/moneroo";

const parsed = monerooCredentialsSchema.parse(req.body);
const encrypted = encryptCredentials(parsed);

await db.insert(paymentConnections).values({
  merchantId,
  provider: "moneroo",
  displayName: req.body.displayName,
  credentialsEncrypted: encrypted, // jsonb column
});
```

### Reading & using a connection

```ts
import { decryptCredentials } from "@/lib/encryption";

const conn = await db.query.paymentConnections.findFirst({
  where: eq(id, connId),
});
if (!conn) throw new Error("not found");

const credentials = decryptCredentials<MonerooCredentials>(
  conn.credentialsEncrypted,
);
// credentials.secretKey is now usable
```

### Updating partial fields

If a merchant edits only their `webhookSecret`, you must decrypt, merge, and re-encrypt:

```ts
const existing = decryptCredentials(conn.credentialsEncrypted);
const merged = { ...existing, webhookSecret: req.body.webhookSecret };
await db
  .update(paymentConnections)
  .set({ credentialsEncrypted: encryptCredentials(merged) })
  .where(eq(paymentConnections.id, connId));
```

## Key rotation procedure

When you rotate (e.g. master key compromised, or yearly hygiene):

1. Generate v2 key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
2. Add to env: `BYOK_ENCRYPTION_KEY_V2=...`. Keep `BYOK_ENCRYPTION_KEY` (v1) in env until all rows are migrated.
3. Update code: `const CURRENT_KEY_VERSION = 2;` — new writes use v2; old rows still decrypt with v1 because their `keyVersion: 1` directs `getKey(1)` to read `BYOK_ENCRYPTION_KEY`.
4. Run a backfill job:
   ```ts
   const rows = await db.select().from(paymentConnections).where(eq(paymentConnections.credentialsEncrypted->>'keyVersion', '1'));
   for (const row of rows) {
     const plain = decryptCredentials(row.credentialsEncrypted); // uses v1
     const re = encryptCredentials(plain); // uses v2 (CURRENT_KEY_VERSION)
     await db.update(paymentConnections)
       .set({ credentialsEncrypted: re })
       .where(eq(paymentConnections.id, row.id));
   }
   ```
5. After migration completes: remove `BYOK_ENCRYPTION_KEY` from env. Now only v2 is needed.

## Testing

```ts
// Round-trip test
const plain = { secretKey: "test_abc", webhookSecret: "whsec_xyz" };
const encrypted = encryptCredentials(plain);
const decrypted = decryptCredentials<typeof plain>(encrypted);
assert.deepEqual(decrypted, plain);

// Tampering test
encrypted.ciphertext = encrypted.ciphertext.slice(0, -2) + "AB";
expect(() => decryptCredentials(encrypted)).toThrow(); // GCM auth tag fails
```

## Common pitfalls

| Pitfall                                | Symptom                              | Fix                                        |
| -------------------------------------- | ------------------------------------ | ------------------------------------------ |
| Stored key as plain text in env        | Anyone with logs sees it             | Use base64                                 |
| Reused IV across encryptions           | Catastrophic GCM key recovery        | `randomBytes(12)` per call (we do this)    |
| Used CBC mode                          | No integrity, padding oracle attacks | Use GCM (`aes-256-gcm`)                    |
| Stored auth tag inline with ciphertext | Format ambiguity                     | Store separately as `authTag`              |
| Lost the master key                    | All credentials unrecoverable        | Back up to secrets manager with versioning |
| Logged plaintext during decrypt        | Plaintext in log files               | Never log credentials                      |
| Encrypted with v2, no v2 env in prod   | Decrypt fails on first read          | Deploy env var BEFORE deploying code       |
