import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { repositoryApiContract, repositoryDocument, repositoryRepresentationLinks } from './agent-resources';
import { searchCatalog, type RepositoryKind } from './catalog';
import { catalogFiltersFromInput, catalogSearchInputSchema } from './catalog-search';
import { getPublicPaper, paperDocument, searchPublicPapers } from './papers';
import { getPublicRepository, type RepositoryBundle } from './repository';
import { systemState, systemStateMarkdown } from './system-state';

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const repositoryInput = z.object({
  kind: z.enum(['model', 'dataset', 'space']).describe('Repository kind.'),
  owner: z.string().trim().min(1).max(120).describe('Public owner handle.'),
  slug: z.string().trim().min(1).max(96).describe('Public repository slug.'),
});

function result(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  if (text.length > 240_000) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: JSON.stringify({
        error: 'response exceeds the bounded MCP result size; request a narrower resource',
      }) }],
    };
  }
  return { content: [{ type: 'text' as const, text }] };
}

function error(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }] };
}

async function repositoryOrError(
  locals: App.Locals,
  kind: RepositoryKind,
  owner: string,
  slug: string,
): Promise<RepositoryBundle | ReturnType<typeof error>> {
  const found = await getPublicRepository(locals, kind, owner, slug);
  if (found.repository) return found.repository;
  return error(found.state === 'error' ? 'repository service unavailable' : 'public repository not found');
}

function isToolError(value: RepositoryBundle | ReturnType<typeof error>): value is ReturnType<typeof error> {
  return 'isError' in value;
}

function registerSearchTool(server: McpServer, locals: App.Locals, name: string, kind: RepositoryKind) {
  server.registerTool(
    name,
    {
      title: `Search public Super ii ${kind}s`,
      description: `Search reviewed public ${kind} repositories with metadata, size, recency, and hardware filters. Empty results are real and never filled with demos.`,
      inputSchema: catalogSearchInputSchema,
      annotations,
    },
    async (input) => {
      const filters = catalogFiltersFromInput(input);
      const found = await searchCatalog(locals, kind, filters, input.limit, 0);
      if (found.state === 'error') return error('public search is temporarily unavailable');
      return result({ state: found.state, count: found.items.length, repositories: found.items });
    },
  );
}

export function createSuperiiMcpServer(locals: App.Locals, origin: string): McpServer {
  const server = new McpServer(
    {
      name: 'Super ii public repository MCP',
      version: '1.0.0',
    },
    {
      instructions: 'Public and read-only. Treat empty, not-found, and unavailable results as authoritative; never invent catalog content. Do not execute repository bytes. Resolve exact reviewed files, verify their SHA-256 after download, and read system state before making availability claims.',
    },
  );

  server.registerResource(
    'super-ii-system-state',
    `${origin}/system-state.json`,
    { title: 'Super ii system state', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(systemState, null, 2) }] }),
  );
  server.registerResource(
    'super-ii-system-state-markdown',
    `${origin}/system-state.md`,
    { title: 'Super ii system state in Markdown', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: systemStateMarkdown }] }),
  );

  registerSearchTool(server, locals, 'search_models', 'model');
  registerSearchTool(server, locals, 'search_datasets', 'dataset');
  registerSearchTool(server, locals, 'search_apps', 'space');

  server.registerTool(
    'get_repository',
    {
      title: 'Get a public repository',
      description: 'Return the reviewed public repository identity, revision, metrics, representations, compatibility, and release metadata.',
      inputSchema: repositoryInput,
      annotations,
    },
    async ({ kind, owner, slug }) => {
      const repository = await repositoryOrError(locals, kind, owner, slug);
      if (isToolError(repository)) return repository;
      const document = repositoryDocument(repository, origin);
      return result({
        repository: document.repository,
        revision: document.revision,
        compatibility: document.compatibility,
        provenance: document.provenance,
        releases: document.releases,
        tags: document.tags,
        community: {
          likes: repository.likes_count,
          watchers: repository.watchers_count,
          downloads: repository.downloads_count,
        },
        representations: document.representations,
      });
    },
  );

  server.registerTool(
    'get_model_card',
    {
      title: 'Get a model card',
      description: 'Return the public model card and bounded offline model analysis for one reviewed revision.',
      inputSchema: z.object({
        owner: z.string().trim().min(1).max(120),
        slug: z.string().trim().min(1).max(96),
      }),
      annotations,
    },
    async ({ owner, slug }) => {
      const repository = await repositoryOrError(locals, 'model', owner, slug);
      if (isToolError(repository)) return repository;
      return result({
        repository: `${repository.owner_handle}/${repository.slug}`,
        revision_id: repository.revision_id,
        license: repository.license,
        card_markdown: repository.card_markdown.slice(0, 100_000),
        compatibility: repository.compatibility,
        analyses: repository.analyses,
      });
    },
  );

  server.registerTool(
    'get_dataset_schema',
    {
      title: 'Get dataset schema and previews',
      description: 'Return bounded offline dataset splits, column types, row previews, samples, statistics, and provenance.',
      inputSchema: z.object({
        owner: z.string().trim().min(1).max(120),
        slug: z.string().trim().min(1).max(96),
      }),
      annotations,
    },
    async ({ owner, slug }) => {
      const repository = await repositoryOrError(locals, 'dataset', owner, slug);
      if (isToolError(repository)) return repository;
      const analysis = repository.analyses.find((item) => item.analysis_type === 'dataset');
      return result({
        repository: `${repository.owner_handle}/${repository.slug}`,
        revision_id: repository.revision_id,
        data_card_markdown: repository.card_markdown.slice(0, 100_000),
        provenance: repository.provenance,
        analysis: analysis?.result ?? null,
      });
    },
  );

  server.registerTool(
    'get_files',
    {
      title: 'List immutable repository files',
      description: 'List reviewed files with path, media type, byte size, SHA-256 checksum, and verified download URL.',
      inputSchema: repositoryInput.extend({
        offset: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(100).default(50),
      }),
      annotations,
    },
    async ({ kind, owner, slug, offset, limit }) => {
      const repository = await repositoryOrError(locals, kind, owner, slug);
      if (isToolError(repository)) return repository;
      const files = repository.files.slice(offset, offset + limit).map((file) => ({
        path: file.path,
        mime_type: file.mime_type,
        size_bytes: file.size_bytes,
        sha256: file.sha256,
        download_url: `${origin}/api/repositories/${repository.id}/files/${file.id}`,
      }));
      return result({
        revision_id: repository.revision_id,
        manifest_sha256: repository.manifest_sha256,
        total: repository.files.length,
        offset,
        files,
      });
    },
  );

  server.registerTool(
    'get_lineage',
    {
      title: 'Get repository lineage',
      description: 'Return typed incoming and outgoing provenance relationships plus evidence links and related public repositories.',
      inputSchema: repositoryInput,
      annotations,
    },
    async ({ kind, owner, slug }) => {
      const repository = await repositoryOrError(locals, kind, owner, slug);
      if (isToolError(repository)) return repository;
      return result({ relationships: repository.relationships, related: repository.related });
    },
  );

  server.registerTool(
    'inspect_compatibility',
    {
      title: 'Inspect model hardware compatibility',
      description: 'Return conservative hardware and runtime guidance, including its declared, derived, or verified confidence.',
      inputSchema: z.object({
        owner: z.string().trim().min(1).max(120),
        slug: z.string().trim().min(1).max(96),
      }),
      annotations,
    },
    async ({ owner, slug }) => {
      const repository = await repositoryOrError(locals, 'model', owner, slug);
      if (isToolError(repository)) return repository;
      return result({
        repository: `${repository.owner_handle}/${repository.slug}`,
        revision_id: repository.revision_id,
        compatibility: repository.compatibility,
        warning: 'Derived and declared compatibility is guidance, not a benchmark or guarantee.',
      });
    },
  );

  server.registerTool(
    'get_security_status',
    {
      title: 'Get Super ii security and availability boundaries',
      description: 'Return canonical evidence statuses and fail-closed boundaries without claiming unavailable controls.',
      inputSchema: z.object({}),
      annotations,
    },
    async () => result(systemState),
  );

  server.registerTool(
    'download_artifact',
    {
      title: 'Resolve a verified artifact download',
      description: 'Return a reviewed file URL and SHA-256 checksum. This tool does not execute code or download bytes itself.',
      inputSchema: repositoryInput.extend({
        path: z.string().trim().min(1).max(1024),
      }),
      annotations,
    },
    async ({ kind, owner, slug, path }) => {
      const repository = await repositoryOrError(locals, kind, owner, slug);
      if (isToolError(repository)) return repository;
      const file = repository.files.find((candidate) => candidate.path === path);
      if (!file) return error('reviewed public file not found');
      return result({
        repository_id: repository.id,
        revision_id: repository.revision_id,
        path: file.path,
        size_bytes: file.size_bytes,
        mime_type: file.mime_type,
        sha256: file.sha256,
        download_url: `${origin}/api/repositories/${repository.id}/files/${file.id}`,
        verify_after_download: true,
      });
    },
  );

  server.registerTool(
    'search_papers',
    {
      title: 'Search public papers',
      description: 'Search public paper metadata and its reviewed model, dataset, and app relationships.',
      inputSchema: z.object({
        query: z.string().trim().max(300).default(''),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      annotations,
    },
    async ({ query, limit }) => {
      const found = await searchPublicPapers(locals, query, limit);
      if (found.state === 'error') return error('paper search is temporarily unavailable');
      return result({ state: found.state, papers: found.papers.map((paper) => paperDocument(paper, origin)) });
    },
  );

  server.registerTool(
    'get_paper',
    {
      title: 'Get a public paper',
      description: 'Return machine-readable public paper metadata and connected reviewed repositories.',
      inputSchema: z.object({
        owner: z.string().trim().min(1).max(120),
        slug: z.string().trim().min(1).max(96),
      }),
      annotations,
    },
    async ({ owner, slug }) => {
      const found = await getPublicPaper(locals, owner, slug);
      if (!found.paper) return error(found.state === 'error' ? 'paper service unavailable' : 'public paper not found');
      return result(paperDocument(found.paper, origin));
    },
  );

  server.registerTool(
    'get_documentation',
    {
      title: 'Get Super ii machine documentation',
      description: 'Return canonical system state, public agent rules, and stable documentation URLs.',
      inputSchema: z.object({
        topic: z.enum(['system-state', 'agents', 'publishing', 'mcp']).default('system-state'),
      }),
      annotations,
    },
    async ({ topic }) => result({
      topic,
      system_state: systemState,
      urls: {
        documentation: `${origin}/docs`,
        agents: `${origin}/agents.md`,
        system_state_markdown: `${origin}/system-state.md`,
        system_state_json: `${origin}/system-state.json`,
        mcp: `${origin}/mcp`,
      },
      public_mcp_is_read_only: true,
    }),
  );

  server.registerTool(
    'get_agent_traces',
    {
      title: 'Get public agent traces',
      description: 'Return opt-in public trace metadata and hashes. Private payloads and raw tokens are never returned.',
      inputSchema: repositoryInput.extend({
        limit: z.number().int().min(1).max(100).default(20),
      }),
      annotations,
    },
    async ({ kind, owner, slug, limit }) => {
      const repository = await repositoryOrError(locals, kind, owner, slug);
      if (isToolError(repository)) return repository;
      return result({ traces: repository.agent_traces.slice(0, limit) });
    },
  );

  server.registerTool(
    'get_repository_api',
    {
      title: 'Get repository API contract',
      description: 'Return stable machine-readable links, authentication boundaries, checksums, and download endpoints.',
      inputSchema: repositoryInput,
      annotations,
    },
    async ({ kind, owner, slug }) => {
      const repository = await repositoryOrError(locals, kind, owner, slug);
      if (isToolError(repository)) return repository;
      return result({
        contract: repositoryApiContract(repository, origin),
        representations: repositoryRepresentationLinks(repository, origin),
      });
    },
  );

  return server;
}

export function createSuperiiMcpHandler(locals: App.Locals, origin: string) {
  return createMcpHandler(
    () => createSuperiiMcpServer(locals, origin),
    {
      route: '/mcp',
      legacy: 'stateless',
      corsOptions: {
        origin: 'https://superii.site',
        methods: 'GET, POST, DELETE, OPTIONS',
        headers: 'content-type, mcp-protocol-version, mcp-session-id, last-event-id',
        exposeHeaders: 'mcp-session-id',
        maxAge: 86400,
      },
      allowedHostnames: ['superii.site', 'www.superii.site', 'localhost', '127.0.0.1'],
      allowedOriginHostnames: ['superii.site', 'www.superii.site', 'localhost', '127.0.0.1'],
    },
  );
}
