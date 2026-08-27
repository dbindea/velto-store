/**
 * Uploading a generated PDF to Storage and handing back a shareable URL.
 *
 * The download token is what makes the URL work without a signed-in user,
 * which is the whole point: the operator pastes this link into WhatsApp.
 */

import { randomUUID } from 'crypto';
import { storageBucket } from '../admin-guard';

export interface UploadedPdf {
  pdfUrl: string;
  pdfPath: string;
}

/**
 * Save `bytes` at `path` and return a public download URL.
 *
 * When a file already exists at that path its download token is REUSED.
 * Writing a fresh token would silently break the link the customer already
 * has in their chat — regenerating a document must not revoke the copy that
 * was already sent.
 */
export async function uploadPdf(path: string, bytes: Uint8Array): Promise<UploadedPdf> {
  const storage = storageBucket();
  const bucket = storage.bucket();
  const file = bucket.file(path);

  let token: string | undefined;
  try {
    const [exists] = await file.exists();
    if (exists) {
      const [metadata] = await file.getMetadata();
      token = (metadata?.metadata as Record<string, string> | undefined)
        ?.firebaseStorageDownloadTokens;
      // The field holds a comma-separated list; the first one is enough.
      if (token) token = token.split(',')[0];
    }
  } catch {
    // A missing or unreadable object just means we mint a new token.
  }

  const downloadToken = token || randomUUID();

  await file.save(Buffer.from(bytes), {
    contentType: 'application/pdf',
    metadata: {
      metadata: {
        firebaseStorageDownloadTokens: downloadToken
      }
    },
    resumable: false
  });

  return {
    pdfPath: path,
    pdfUrl:
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}` +
      `/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`
  };
}
