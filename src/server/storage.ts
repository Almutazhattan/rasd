/**
 * Private file storage.
 *
 * Uploads are never served from a public path. The local driver writes under
 * STORAGE_LOCAL_DIR with a key derived from the organization id, and reads go
 * through an authenticated route handler that re-checks tenancy — so a leaked
 * key is not a leaked file.
 *
 * The S3 driver is a documented seam, not a claim: with STORAGE_DRIVER=s3 the
 * methods throw a clear "not implemented in this build" error rather than
 * silently writing somewhere unexpected. See docs/INTEGRATIONS.md.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { AppError } from '@/lib/errors';
import { env } from '@/lib/env';

export const ALLOWED_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'text/plain': 'txt',
};

export interface StoredFile {
  storageKey: string;
  sha256: string;
  byteSize: number;
  mimeType: string;
}

/** Magic-number check: a file is what its bytes say, not what its name claims. */
export function sniff(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05)) return 'zip-based';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf) return 'application/msword';
  return null;
}

export function assertUploadAcceptable(declaredMime: string, bytes: Uint8Array) {
  const e = env();
  if (bytes.byteLength === 0) throw new AppError('VALIDATION', 'The file is empty.');
  if (bytes.byteLength > e.MAX_UPLOAD_BYTES) {
    throw new AppError('FILE_TOO_LARGE', `Files must be ${Math.floor(e.MAX_UPLOAD_BYTES / 1_048_576)} MB or smaller.`);
  }
  if (!ALLOWED_MIME[declaredMime]) {
    throw new AppError('UNSUPPORTED_FILE', `${declaredMime} is not an accepted file type.`);
  }
  const sniffed = sniff(bytes);

  // Plain text has no magic number, so an unrecognized signature is expected
  // there and only there. Every other accepted type must be identifiable from
  // its bytes, and must agree with what the upload claims to be.
  if (declaredMime === 'text/plain') {
    const looksBinary = bytes.subarray(0, 512).includes(0);
    if (looksBinary) {
      throw new AppError('UNSUPPORTED_FILE', 'This file is not plain text.');
    }
    return;
  }

  if (!sniffed) throw new AppError('UNSUPPORTED_FILE', 'The file content could not be recognized.');

  const zipBased = declaredMime.includes('openxmlformats');
  const consistent = sniffed === declaredMime || (zipBased && sniffed === 'zip-based');
  if (!consistent) {
    throw new AppError('UNSUPPORTED_FILE', 'The file content does not match its declared type.');
  }
}

function localRoot(): string {
  return resolve(env().STORAGE_LOCAL_DIR);
}

/** Keys are generated, never taken from user input, and resolved paths are checked. */
function safePath(storageKey: string): string {
  const root = localRoot();
  const full = resolve(join(root, storageKey));
  if (full !== root && !full.startsWith(root + sep)) {
    throw new AppError('FORBIDDEN', 'Invalid storage key.');
  }
  return full;
}

export async function putFile(
  orgId: string, bytes: Uint8Array, mimeType: string, kind = 'doc',
): Promise<StoredFile> {
  assertUploadAcceptable(mimeType, bytes);
  const ext = ALLOWED_MIME[mimeType] ?? 'bin';
  const storageKey = `${orgId}/${kind}/${randomUUID()}.${ext}`;
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  if (env().STORAGE_DRIVER === 's3') {
    throw new AppError('INTERNAL', 'The S3 storage driver is not implemented in this build. Use STORAGE_DRIVER=local.');
  }
  const path = safePath(storageKey);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { mode: 0o600 });
  return { storageKey, sha256, byteSize: bytes.byteLength, mimeType };
}

export async function getFile(storageKey: string): Promise<Buffer> {
  if (env().STORAGE_DRIVER === 's3') {
    throw new AppError('INTERNAL', 'The S3 storage driver is not implemented in this build.');
  }
  try {
    return await readFile(safePath(storageKey));
  } catch {
    throw new AppError('NOT_FOUND', 'The stored file is missing.');
  }
}

export async function deleteFile(storageKey: string): Promise<void> {
  if (env().STORAGE_DRIVER === 's3') return;
  try {
    await unlink(safePath(storageKey));
  } catch {
    // Already gone: deleting a missing file is not an error worth surfacing.
  }
}
