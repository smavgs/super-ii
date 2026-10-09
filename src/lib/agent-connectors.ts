import registry from '@/content/agent-connectors.json';

export type AgentConnectorStatus = 'verified' | 'compatible' | 'planned';

export type AgentConnectorVariant = {
  label: string;
  configuration_version: string;
  config_path: string;
  config_example: string;
  notes: string;
};

export type AgentConnector = {
  id: string;
  name: string;
  vendor: string;
  status: AgentConnectorStatus;
  status_label: string;
  transport: 'streamable-http' | 'unknown';
  configuration_family: 'toml' | 'json' | 'url' | 'unknown';
  configuration_version: string | null;
  command: string | null;
  verify_command: string | null;
  config_path: string | null;
  config_example: string | null;
  configuration_variants?: AgentConnectorVariant[];
  notes: string;
  source_url: string | null;
  source_label: string | null;
};

export type AgentConnectorRegistry = {
  schema_version: '1.0.0';
  registry_updated: string;
  public_mcp_url: string;
  work_mcp_url: string;
  social_mcp_url?: string;
  connection_guide_url?: string;
  authorization?: {
    authorization_server_metadata: string;
    methods: string[];
    headless_connector: string;
    human_approval_required: true;
    refresh_tokens: false;
    client_verification: string;
  };
  connector_policy: {
    default_access: 'public-read-only';
    write_access: 'explicit-workspace-token';
    installer_behavior: 'dry-run-first';
    secrets_in_commands: false;
  };
  connectors: AgentConnector[];
};

export const agentConnectorRegistry = registry as AgentConnectorRegistry;

export function verifiedAgentConnectors(): AgentConnector[] {
  return agentConnectorRegistry.connectors.filter((connector) => connector.status !== 'planned');
}
