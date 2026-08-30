import officialRegistry from '@/content/notebooks.json';
import type { RepositoryBundle } from './repository';
import { kindPath } from './repository';

import apiMcpSource from '../../notebooks/getting-started/super-ii-api-and-mcp.ipynb?raw';
import datasetSource from '../../notebooks/repositories/create-and-verify-a-dataset.ipynb?raw';
import evaluationSource from '../../notebooks/evaluation/reproducible-model-evaluation.ipynb?raw';

export type NotebookTextOutput = {
  mime_type: 'text/plain';
  text: string;
};

export type NotebookJsonOutput = {
  mime_type: 'application/json';
  value: unknown;
};

export type NotebookImageOutput = {
  mime_type: 'image/png' | 'image/jpeg' | 'image/webp';
  data: string;
  size_bytes: number;
};

export type NotebookOutput =
  | { type: 'stream'; name: 'stdout' | 'stderr'; text: string }
  | { type: 'error'; ename: string; evalue: string; traceback: string[] }
  | {
      type: 'display_data' | 'execute_result';
      execution_count?: number | null;
      data: Array<NotebookTextOutput | NotebookJsonOutput | NotebookImageOutput>;
    };

export type NotebookCell = {
  index: number;
  id?: string;
  type: 'markdown' | 'code' | 'raw';
  source: string;
  execution_count?: number | null;
  outputs?: NotebookOutput[];
};

export type NotebookDocument = {
  version: 1;
  path: string;
  size_bytes: number;
  nbformat: 4;
  nbformat_minor: number;
  kernel: {
    name: string | null;
    display_name: string | null;
    language: string | null;
    language_version: string | null;
  };
  cell_count: number;
  cells: NotebookCell[];
  omitted_outputs: number;
  safety: {
    static_only: true;
    code_executed: false;
    repository_code_imported: false;
    raw_html_rendered: false;
    javascript_rendered: false;
    svg_rendered: false;
    widgets_rendered: false;
    attachments_rendered: false;
  };
};

export type OfficialNotebookMeta = (typeof officialRegistry)[number];

const officialSources: Record<string, string> = {
  'notebooks/getting-started/super-ii-api-and-mcp.ipynb': apiMcpSource,
  'notebooks/repositories/create-and-verify-a-dataset.ipynb': datasetSource,
  'notebooks/evaluation/reproducible-model-evaluation.ipynb': evaluationSource,
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function joinedText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((part) => typeof part === 'string')) {
    return value.join('');
  }
  return null;
}

function boundedString(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.length <= maximum ? value : null;
}

function integer(value: unknown, fallback = 0): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function kernelFromMetadata(metadata: Record<string, unknown> | null): NotebookDocument['kernel'] {
  const kernelspec = object(metadata?.kernelspec);
  const language = object(metadata?.language_info);
  return {
    name: boundedString(kernelspec?.name, 200),
    display_name: boundedString(kernelspec?.display_name, 200),
    language: boundedString(language?.name, 200),
    language_version: boundedString(language?.version, 200),
  };
}

function normalizedKernel(value: unknown): NotebookDocument['kernel'] {
  const kernel = object(value);
  return {
    name: boundedString(kernel?.name, 200),
    display_name: boundedString(kernel?.display_name, 200),
    language: boundedString(kernel?.language, 200),
    language_version: boundedString(kernel?.language_version, 200),
  };
}

function safeOutput(value: unknown): NotebookOutput | null {
  const entry = object(value);
  if (!entry) return null;
  if (entry.type === 'stream') {
    const text = boundedString(entry.text, 250_000);
    if (text === null) return null;
    return { type: 'stream', name: entry.name === 'stderr' ? 'stderr' : 'stdout', text };
  }
  if (entry.type === 'error') {
    const ename = boundedString(entry.ename, 200);
    const evalue = boundedString(entry.evalue, 1_000);
    const traceback = Array.isArray(entry.traceback)
      ? entry.traceback.filter((line): line is string => typeof line === 'string').slice(0, 100)
      : [];
    if (
      ename === null
      || evalue === null
      || traceback.some((line) => line.length > 250_000)
      || traceback.reduce((total, line) => total + line.length, 0) > 250_000
    ) {
      return null;
    }
    return { type: 'error', ename, evalue, traceback };
  }
  if (entry.type !== 'display_data' && entry.type !== 'execute_result') return null;
  const data: Array<NotebookTextOutput | NotebookJsonOutput | NotebookImageOutput> = [];
  for (const raw of Array.isArray(entry.data) ? entry.data.slice(0, 8) : []) {
    const item = object(raw);
    if (!item) continue;
    if (item.mime_type === 'text/plain') {
      const text = boundedString(item.text, 250_000);
      if (text !== null) data.push({ mime_type: 'text/plain', text });
    } else if (item.mime_type === 'application/json') {
      data.push({ mime_type: 'application/json', value: item.value });
    } else if (
      item.mime_type === 'image/png'
      || item.mime_type === 'image/jpeg'
      || item.mime_type === 'image/webp'
    ) {
      const encoded = boundedString(item.data, 7_000_000);
      const size = integer(item.size_bytes);
      if (encoded !== null && size <= 5 * 1024 * 1024 && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
        data.push({ mime_type: item.mime_type, data: encoded, size_bytes: size });
      }
    }
  }
  if (!data.length) return null;
  return {
    type: entry.type,
    execution_count: entry.type === 'execute_result'
      ? entry.execution_count === null ? null : integer(entry.execution_count)
      : undefined,
    data,
  };
}

export function normalizeRepositoryNotebook(value: unknown): NotebookDocument | null {
  const notebook = object(value);
  const safety = object(notebook?.safety);
  if (
    !notebook
    || notebook.version !== 1
    || notebook.nbformat !== 4
    || safety?.static_only !== true
    || safety.code_executed !== false
    || safety.raw_html_rendered !== false
    || safety.javascript_rendered !== false
  ) return null;
  const path = boundedString(notebook.path, 1_024);
  if (!path || path.includes('..') || path.startsWith('/')) return null;
  const rawCells = Array.isArray(notebook.cells) ? notebook.cells.slice(0, 2_000) : null;
  if (!rawCells) return null;
  const cells: NotebookCell[] = [];
  for (const [position, rawCell] of rawCells.entries()) {
    const cell = object(rawCell);
    const type = cell?.type;
    const source = boundedString(cell?.source, 250_000);
    if (!cell || !['markdown', 'code', 'raw'].includes(String(type)) || source === null) return null;
    const normalized: NotebookCell = {
      index: integer(cell.index, position),
      type: type as NotebookCell['type'],
      source,
    };
    const id = boundedString(cell.id, 64);
    if (id) normalized.id = id;
    if (type === 'code') {
      normalized.execution_count = cell.execution_count === null
        ? null
        : integer(cell.execution_count);
      normalized.outputs = (Array.isArray(cell.outputs) ? cell.outputs : [])
        .map(safeOutput)
        .filter((output): output is NotebookOutput => output !== null);
    }
    cells.push(normalized);
  }
  return {
    version: 1,
    path,
    size_bytes: integer(notebook.size_bytes),
    nbformat: 4,
    nbformat_minor: integer(notebook.nbformat_minor),
    kernel: normalizedKernel(notebook.kernel),
    cell_count: cells.length,
    cells,
    omitted_outputs: integer(notebook.omitted_outputs),
    safety: {
      static_only: true,
      code_executed: false,
      repository_code_imported: false,
      raw_html_rendered: false,
      javascript_rendered: false,
      svg_rendered: false,
      widgets_rendered: false,
      attachments_rendered: false,
    },
  };
}

function normalizeOfficialNotebook(source: string, path: string): NotebookDocument | null {
  let notebook: Record<string, unknown> | null = null;
  try {
    notebook = object(JSON.parse(source));
  } catch {
    return null;
  }
  if (
    !notebook
    || notebook.nbformat !== 4
    || !Array.isArray(notebook.cells)
    || notebook.cells.length > 2_000
  ) return null;
  const cells: NotebookCell[] = [];
  let omittedOutputs = 0;
  for (const [index, rawCell] of notebook.cells.entries()) {
    const cell = object(rawCell);
    const type = cell?.cell_type;
    const cellSource = joinedText(cell?.source);
    if (
      !cell
      || !['markdown', 'code', 'raw'].includes(String(type))
      || cellSource === null
      || cellSource.length > 250_000
    ) return null;
    const normalized: NotebookCell = {
      index,
      type: type as NotebookCell['type'],
      source: cellSource,
    };
    const id = boundedString(cell.id, 64);
    if (id) normalized.id = id;
    if (type === 'code') {
      normalized.execution_count = null;
      normalized.outputs = [];
      omittedOutputs += Array.isArray(cell.outputs) ? cell.outputs.length : 0;
    }
    cells.push(normalized);
  }
  return {
    version: 1,
    path,
    size_bytes: new TextEncoder().encode(source).byteLength,
    nbformat: 4,
    nbformat_minor: integer(notebook.nbformat_minor),
    kernel: kernelFromMetadata(object(notebook.metadata)),
    cell_count: cells.length,
    cells,
    omitted_outputs: omittedOutputs,
    safety: {
      static_only: true,
      code_executed: false,
      repository_code_imported: false,
      raw_html_rendered: false,
      javascript_rendered: false,
      svg_rendered: false,
      widgets_rendered: false,
      attachments_rendered: false,
    },
  };
}

export function repositoryNotebooks(repository: RepositoryBundle): NotebookDocument[] {
  const analysis = repository.analyses.find(
    (entry) => entry.analysis_type === 'notebook' && entry.status === 'passed',
  );
  const notebooks = object(analysis?.result)?.notebooks;
  return (Array.isArray(notebooks) ? notebooks : [])
    .map(normalizeRepositoryNotebook)
    .filter((notebook): notebook is NotebookDocument => notebook !== null);
}

export function repositoryNotebookHref(repository: RepositoryBundle, path: string): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `/${kindPath(repository.kind)}/${encodeURIComponent(repository.owner_handle)}/${encodeURIComponent(repository.slug)}/notebooks/${encodedPath}`;
}

export const officialNotebooks = officialRegistry;

export function getOfficialNotebook(slug: string | undefined): {
  meta: OfficialNotebookMeta;
  notebook: NotebookDocument;
  githubUrl: string;
  colabUrl: string;
  downloadUrl: string;
} | null {
  const meta = officialRegistry.find((item) => item.slug === slug);
  if (!meta) return null;
  const source = officialSources[meta.path];
  const notebook = source ? normalizeOfficialNotebook(source, meta.path) : null;
  if (!notebook) return null;
  const githubUrl = `https://github.com/smavgs/super-ii/blob/main/${meta.path}`;
  return {
    meta,
    notebook,
    githubUrl,
    colabUrl: `https://colab.research.google.com/github/smavgs/super-ii/blob/main/${meta.path}`,
    downloadUrl: `https://raw.githubusercontent.com/smavgs/super-ii/main/${meta.path}`,
  };
}
