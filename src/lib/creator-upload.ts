import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export type UploadContext = { repositoryId: string; branchId: string; revisionId: string };
export function createUploader(context: UploadContext, t: (text: string, values?: Record<string, string | number>) => string = text => text) {
  const TRANSFER_CHUNK_BYTES = 8 * 1024 * 1024;
  const TRANSFER_SCAN_TIMEOUT_MS = 45 * 60 * 1000;
  const TRANSFER_SCAN_POLL_MS = 5 * 1000;
  function workspacePath(path: string) {
    if (!context.branchId) return path;
    const url = new URL(path, location.origin);
    url.searchParams.set('branch', context.branchId);
    return `${url.pathname}${url.search}`;
  }

  function base64(bytes: Uint8Array) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function transferStateKey(file: File, path: string) {
    return [
      'superii-transfer-v1',
      context.repositoryId,
      context.revisionId,
      context.branchId || 'default',
      path,
      file.name,
      file.size,
      file.lastModified,
    ].join(':');
  }

  async function hashFile(file: File, status: Element | null, progress: Element | null) {
    const digest = sha256.create();
    let offset = 0;
    while (offset < file.size) {
      const end = Math.min(file.size, offset + TRANSFER_CHUNK_BYTES);
      digest.update(new Uint8Array(await file.slice(offset, end).arrayBuffer()));
      offset = end;
      if (status instanceof HTMLElement) {
        status.textContent = t('Hashing {name}… {percent}%',{name:file.name,percent:Math.round(offset/file.size*100)});
      }
      if (progress instanceof HTMLProgressElement) progress.value = offset / file.size * 40;
    }
    return bytesToHex(digest.digest());
  }

  type BrowserTransfer = {
    transfer_id: string;
    upload_url: string;
    transfer_token: string;
    source_sha256: string;
    source_size: number;
    repository_path: string;
  };

  class TransferResumeError extends Error {
    status: number;

    constructor(status: number) {
      super(`Transfer resume failed with ${status}.`);
      this.name = 'TransferResumeError';
      this.status = status;
    }
  }

  function readTransferState(key: string, file: File, path: string, sourceSha256: string) {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as BrowserTransfer;
      const upload = new URL(value.upload_url, location.origin);
      if (
        upload.origin !== location.origin
        || value.source_sha256 !== sourceSha256
        || value.source_size !== file.size
        || value.repository_path !== path
        || typeof value.transfer_token !== 'string'
      ) {
        sessionStorage.removeItem(key);
        return null;
      }
      return value;
    } catch {
      sessionStorage.removeItem(key);
      return null;
    }
  }

  async function createTransfer(file: File, path: string, sourceSha256: string) {
    const response = await fetch(
      workspacePath(`/api/repositories/${context.repositoryId}/transfers`),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path,
          filename: file.name,
          mime_type: file.type || 'application/octet-stream',
          length: file.size,
          sha256: sourceSha256,
        }),
      },
    );
    const value = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(typeof value.error === 'string' ? value.error : 'Transfer could not be created.');
    }
    return {
      transfer_id: String(value.transfer_id),
      upload_url: String(value.upload_url),
      transfer_token: String(value.transfer_token),
      source_sha256: sourceSha256,
      source_size: file.size,
      repository_path: path,
    } satisfies BrowserTransfer;
  }

  async function confirmedOffset(transfer: BrowserTransfer) {
    const response = await fetch(transfer.upload_url, {
      method: 'HEAD',
      headers: {
        'tus-resumable': '1.0.0',
        'x-superii-transfer-token': transfer.transfer_token,
      },
    });
    if (!response.ok) throw new TransferResumeError(response.status);
    const offset = Number(response.headers.get('upload-offset'));
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > transfer.source_size) {
      throw new Error('Transfer returned an invalid offset.');
    }
    return offset;
  }

  async function scanStatus(transfer: BrowserTransfer) {
    const response = await fetch(`${transfer.upload_url}/status`, {
      headers: { 'x-superii-transfer-token': transfer.transfer_token },
    });
    const value = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        typeof value.error === 'string'
          ? value.error
          : `Transfer status failed with ${response.status}.`,
      );
    }
    return value;
  }

  async function waitForScan(
    transfer: BrowserTransfer,
    file: File,
    status: Element | null,
  ) {
    const deadline = Date.now() + TRANSFER_SCAN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const value = await scanStatus(transfer);
      const state = typeof value.state === 'string' ? value.state : '';
      const errorCode = typeof value.error_code === 'string' ? value.error_code : '';
      if (state === 'ready') return value.receipt ?? value;
      if (state === 'rejected' || state === 'aborted') {
        throw new Error(`Security scanning ended with ${state}.`);
      }
      if (errorCode) {
        throw new Error(`Security scanning is safely paused (${errorCode}). Retry after resolving the scanner.`);
      }
      if (state === 'uploaded') {
        throw new Error('Security scanning did not start. Retry this upload to resume the preserved transfer.');
      }
      if (state !== 'scanning') {
        throw new Error('Transfer returned an unexpected scan state.');
      }
      if (status instanceof HTMLElement) {
        status.textContent = t('Scanning {name} in quarantine… You can keep this tab open.',{name:file.name});
      }
      await new Promise((resolve) => window.setTimeout(resolve, TRANSFER_SCAN_POLL_MS));
    }
    throw new Error('Security scanning is still running. Retry later to read its preserved status.');
  }

  async function uploadResumableFile(
    file: File,
    path: string,
    status: Element | null,
    progress: Element | null,
  ) {
    const sourceSha256 = await hashFile(file, status, progress);
    const stateKey = transferStateKey(file, path);
    let transfer = readTransferState(stateKey, file, path, sourceSha256);
    if (!transfer) {
      transfer = await createTransfer(file, path, sourceSha256);
      sessionStorage.setItem(stateKey, JSON.stringify(transfer));
    }
    let offset: number;
    try {
      offset = await confirmedOffset(transfer);
    } catch (error) {
      if (!(error instanceof TransferResumeError) || ![404, 410].includes(error.status)) {
        throw error;
      }
      sessionStorage.removeItem(stateKey);
      transfer = await createTransfer(file, path, sourceSha256);
      sessionStorage.setItem(stateKey, JSON.stringify(transfer));
      offset = 0;
    }

    while (offset < file.size) {
      const end = Math.min(file.size, offset + TRANSFER_CHUNK_BYTES);
      const chunk = file.slice(offset, end);
      const chunkBytes = new Uint8Array(await chunk.arrayBuffer());
      const checksum = base64(sha256(chunkBytes));
      if (status instanceof HTMLElement) {
        status.textContent = t('Uploading {name}… {percent}%',{name:file.name,percent:Math.round(offset/file.size*100)});
      }
      const response = await fetch(transfer.upload_url, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/offset+octet-stream',
          'tus-resumable': '1.0.0',
          'upload-checksum': `sha256 ${checksum}`,
          'upload-chunk-length': String(chunk.size),
          'upload-offset': String(offset),
          'x-superii-transfer-token': transfer.transfer_token,
        },
        body: chunk,
      });
      if (!response.ok) {
        const reconciled = await confirmedOffset(transfer);
        if (reconciled !== offset) {
          offset = reconciled;
          continue;
        }
        const value = await response.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(typeof value.error === 'string' ? value.error : `Chunk upload failed with ${response.status}.`);
      }
      const nextOffset = Number(response.headers.get('upload-offset'));
      if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset || nextOffset > file.size) {
        throw new Error('Transfer returned an invalid committed offset.');
      }
      offset = nextOffset;
      if (progress instanceof HTMLProgressElement) {
        progress.value = 40 + offset / file.size * 55;
      }
    }

    if (status instanceof HTMLElement) status.textContent = t('Scanning {name} in quarantine…',{name:file.name});
    const prior = await scanStatus(transfer);
    let result: unknown;
    if (prior.state === 'ready') {
      result = prior.receipt ?? prior;
    } else if (prior.state === 'scanning' && !prior.error_code) {
      result = await waitForScan(transfer, file, status);
    } else {
      let commit: Response | null = null;
      try {
        commit = await fetch(`${transfer.upload_url}/commit`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'tus-resumable': '1.0.0',
            'x-superii-transfer-token': transfer.transfer_token,
          },
          body: '{}',
        });
      } catch {
        // An edge disconnect after commit is uncertain. Read the durable state.
      }
      if (commit?.ok && commit.status !== 202) {
        result = await commit.json().catch(() => ({}));
      } else if (!commit || commit.status === 202 || commit.status >= 500) {
        result = await waitForScan(transfer, file, status);
      } else {
        const value = await commit.json().catch(() => ({})) as Record<string, unknown>;
        if ([404, 410, 422].includes(commit.status)) sessionStorage.removeItem(stateKey);
        throw new Error(
          typeof value.error === 'string'
            ? value.error
            : `Scan commit failed with ${commit.status}.`,
        );
      }
    }
    sessionStorage.removeItem(stateKey);
    if (progress instanceof HTMLProgressElement) progress.value = 100;
    return result;
  }

  return uploadResumableFile;
}
