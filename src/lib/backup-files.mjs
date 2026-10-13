import {
  ArchiveError,
  createArchive,
  validateArchive,
  importArchive,
  exportConversations,
  exportFullBackup,
} from './archive.mjs';

// These prompt a review of memory usage, not a hard limit or a browser quota
// estimate. Users may continue so their own larger backups remain restorable.
export const IMPORT_FILE_REVIEW_BYTES = 25 * 1024 * 1024;
export const IMPORT_BATCH_REVIEW_BYTES = 50 * 1024 * 1024;

function reviewImportSize(fileBytes, batchBytes) {
  if (fileBytes > IMPORT_FILE_REVIEW_BYTES) {
    throw new ArchiveError('LARGE_FILE_REVIEW', '这份文件较大，整理时会多用一些内存和本地空间。原文件和已保存的记录都没有改变。你可以继续尝试，也可以先关闭暂时不用的标签页再试。');
  }
  if (batchBytes > IMPORT_BATCH_REVIEW_BYTES) {
    throw new ArchiveError('LARGE_BATCH_REVIEW', '本次所选文件合计较大，整理时会多用一些内存和本地空间。原文件和已保存的记录都没有改变。你可以继续尝试，也可以一次少选几个文件，再分批导入。');
  }
}

// Compatibility for file-like inputs without File.size. Count without allocating
// another copy of a potentially large string, and stop as soon as it is too large.
function boundedUtf8Size(text) {
  let bytes = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes > IMPORT_FILE_REVIEW_BYTES) break;
  }
  return bytes;
}

async function prepareSelectedFiles(files, currentArchive, allowLargeFiles) {
  if (!files || typeof files[Symbol.iterator] !== 'function') {
    throw new ArchiveError('NO_FILES', '请先选择要导入的 JSON 文件。');
  }
  const selected = Array.from(files);
  if (selected.length === 0) {
    throw new ArchiveError('NO_FILES', '请先选择要导入的 JSON 文件。');
  }
  let batchBytes = 0;
  // Check the entire selection before reading even the first file or cloning the
  // current archive. File.size is authoritative for browser File objects.
  for (const file of selected) {
    if (typeof file?.name !== 'string' || typeof file?.text !== 'function') {
      throw new ArchiveError('INVALID_FILE', '暂时无法读取所选文件，请重新选择 JSON 备份。');
    }
    if (file.size !== undefined) {
      if (!Number.isSafeInteger(file.size) || file.size < 0) {
        throw new ArchiveError('INVALID_FILE', '暂时无法确认所选文件的大小。本次没有导入，请重新选择 JSON 备份。');
      }
      batchBytes += file.size;
      if (!allowLargeFiles) reviewImportSize(file.size, batchBytes);
    }
  }
  let archive = validateArchive(currentArchive);
  const reports = [];
  for (const file of selected) {
    let text;
    try {
      text = await file.text();
    } catch (error) {
      if (error instanceof RangeError || error?.name === 'RangeError') throw error;
      throw new ArchiveError('FILE_READ_FAILED', '有一份文件暂时无法读取。本次没有保存，原文件和已保存的记录都没有改变。请保留原文件，稍后重新选择。');
    }
    if (typeof text !== 'string') {
      throw new ArchiveError('FILE_READ_FAILED', '暂时无法读取这份文件的内容。本次没有保存，请保留原文件并重新选择 JSON 备份。');
    }
    if (file.size === undefined && !allowLargeFiles) {
      const bytes = boundedUtf8Size(text);
      batchBytes += bytes;
      reviewImportSize(bytes, batchBytes);
    }
    const imported = importArchive(text, archive);
    archive = imported.archive;
    reports.push({ name: file.name, ...imported.report });
  }
  return { archive, reports };
}

/** Prepare all selected files before any browser-storage transaction begins. */
export async function prepareFileImport(files, currentArchive = createArchive(), { allowLargeFiles = false } = {}) {
  try {
    return await prepareSelectedFiles(files, currentArchive, allowLargeFiles === true);
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    if (error instanceof RangeError || error?.name === 'RangeError') {
      throw new ArchiveError('IMPORT_RESOURCE_LIMIT', '这次整理记录需要更多运行空间。本次没有保存，原文件和已保存的记录都没有改变。可以关闭暂时不用的标签页，稍后重试；也可以保留原文件，换一台电脑尝试。');
    }
    throw error;
  }
}

/** The filename uses the user's local date; the portable metadata uses UTC. */
export function createExportFile(archive, { kind = 'full', now = new Date() } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new ArchiveError('INVALID_TIMESTAMP', '暂时无法确定备份日期，请稍后重试。');
  }
  if (!['full', 'conversations'].includes(kind)) {
    throw new ArchiveError('INVALID_EXPORT_KIND', '请选择原格式对话或完整备份。');
  }
  const two = value => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
    + `-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  const content = kind === 'full'
    ? exportFullBackup(archive, { exportedAt: now.toISOString() })
    : exportConversations(archive);
  return {
    filename: `shiguang-${kind === 'full' ? 'backup' : 'conversations'}-${stamp}.json`,
    mimeType: 'application/json;charset=utf-8',
    content,
  };
}

/**
 * Starts a browser download. A return value never means the user saved the file:
 * the UI must direct the user to check their downloads before calling it backed up.
 */
export function startFileDownload(file) {
  if (!globalThis.document?.body || !globalThis.URL?.createObjectURL || !globalThis.Blob) {
    throw new ArchiveError('DOWNLOAD_UNAVAILABLE', '当前页面无法开始下载，请保留页面并换用支持下载的浏览器。');
  }
  if (typeof file?.content !== 'string'
      || !/^shiguang-(backup|conversations)-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(file.filename)
      || file.mimeType !== 'application/json;charset=utf-8') {
    throw new ArchiveError('INVALID_EXPORT', '备份文件尚未准备好，请重新选择导出。');
  }
  const blob = new Blob([file.content], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.hidden = true;
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
