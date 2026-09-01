export type InfoHelpEntry = {
  label: string;
  text: string;
  learnMore?: string;
};

export const infoHelp = {
  publicBeta: {
    label: 'Public beta',
    text: 'Super ii is live, but still early. Features can improve quickly and some capabilities are intentionally limited while they are being verified.',
  },
  reviewFirst: {
    label: 'Reviewed / Review-first',
    text: 'Public releases are checked before they appear in the catalog. Uploading something does not automatically make it public.',
    learnMore: '/docs#publish',
  },
  joinFree: {
    label: 'Join free',
    text: 'Creating an account is free and does not publish anything or start a paid service.',
    learnMore: '/docs#account',
  },
  bringMyWork: {
    label: 'Bring my work',
    text: 'Bring existing models, datasets and apps into Super ii without starting again. Your original work stays where it is.',
    learnMore: '/docs#bring-my-work',
  },
  import: {
    label: 'Import',
    text: 'Super ii copies supported work into your account. It does not delete or move the original.',
  },
  model: {
    label: 'Model',
    text: 'A model is trained AI that can perform tasks such as generating text, understanding images or making predictions.',
  },
  dataset: {
    label: 'Dataset',
    text: 'A dataset is organized data used to train, test or evaluate AI.',
  },
  app: {
    label: 'App',
    text: 'An app is an interactive AI project you can try through Super ii.',
  },
  agent: {
    label: 'Agent',
    text: 'An agent is AI software that can use tools and take steps toward a goal. Super ii is designed for both humans and agents.',
    learnMore: '/docs#agent-native',
  },
  repository: {
    label: 'Repository / Repo',
    text: 'A repository is the home for one project and its files, versions and history.',
  },
  publicRepository: {
    label: 'Public repository',
    text: 'Anyone can discover and view this repository, subject to its license.',
  },
  privateRepository: {
    label: 'Private repository',
    text: 'Only people or agents with permission can access this repository.',
  },
  organization: {
    label: 'Organization',
    text: 'An organization is a shared Super ii workspace for a team.',
  },
  collection: {
    label: 'Collection',
    text: 'A collection groups useful models, datasets or apps around a topic or purpose.',
  },
  follow: {
    label: 'Follow',
    text: 'Follow a creator or organization to see their new public activity.',
  },
  watch: {
    label: 'Watch',
    text: 'Watch this project for important updates such as new revisions or releases.',
  },
  like: {
    label: 'Like',
    text: 'A like is a lightweight way to show that you found this work useful or interesting.',
  },
  discussion: {
    label: 'Discussion',
    text: 'Discuss the project with its creators and community without changing the project files.',
  },
  version: {
    label: 'Version',
    text: 'A version identifies a particular state of this project so you know exactly what you are using.',
  },
  revision: {
    label: 'Revision',
    text: 'A revision is a recorded change to the repository. Older revisions remain part of its history.',
  },
  commit: {
    label: 'Commit',
    text: 'A commit records a specific set of changes.',
  },
  branch: {
    label: 'Branch',
    text: 'A branch lets work develop separately before it is combined with the main version.',
  },
  tag: {
    label: 'Tag',
    text: 'A tag gives an important revision a permanent name, often for a release.',
  },
  release: {
    label: 'Release',
    text: 'A release is a version the creator has intentionally marked for others to use.',
  },
  immutable: {
    label: 'Immutable',
    text: 'Once this recorded version is created, its contents cannot silently change. A new change creates a new revision.',
  },
  checksum: {
    label: 'SHA-256 / Checksum',
    text: 'A checksum is a fingerprint of a file. If even one byte changes, the fingerprint changes too.',
  },
  manifest: {
    label: 'Manifest',
    text: 'A manifest is a machine-readable record describing the files and important facts in this release.',
  },
  provenance: {
    label: 'Provenance',
    text: 'Provenance means where something came from and what evidence supports that history.',
  },
  lineage: {
    label: 'Lineage',
    text: 'Lineage shows how one model, dataset or artifact was derived from another.',
  },
  license: {
    label: 'License',
    text: 'The license explains what you are legally allowed to do with this work. Always check it before reuse.',
  },
  gated: {
    label: 'Gated',
    text: 'This work requires additional permission or acceptance of terms before you can access it.',
  },
  modelCard: {
    label: 'Model card',
    text: 'A model card explains what the model is, how it was made, what it can do and important limitations.',
  },
  dataCard: {
    label: 'Data card',
    text: 'A data card explains what a dataset contains, where it came from and how it should be used.',
  },
  files: {
    label: 'Files',
    text: 'These are the actual files contained in this specific repository revision.',
  },
  download: {
    label: 'Download',
    text: 'Downloads the selected artifact. Check its license, size and hardware requirements before using it.',
  },
  verifiedDownload: {
    label: 'Verified download',
    text: 'Super ii resolves the file against its recorded checksum so you can verify you received the expected artifact.',
  },
  reviewPending: {
    label: 'Review pending',
    text: 'The release has been submitted but has not yet completed Super ii review. It is not public yet.',
  },
  reviewed: {
    label: 'Reviewed',
    text: 'This release passed the required Super ii publishing checks. Review does not mean Super ii guarantees every claim made by its creator.',
    learnMore: '/docs#publish',
  },
  quarantine: {
    label: 'Quarantine',
    text: 'New uploads stay isolated while Super ii checks them before they can be released.',
  },
  securityScan: {
    label: 'Security scan',
    text: 'Super ii checks uploads for known malware, exposed secrets and unsupported or unsafe file conditions before release.',
  },
  failClosed: {
    label: 'Fail-closed',
    text: 'If a required safety check is unavailable, Super ii stops the action instead of skipping the check.',
  },
  resumableUpload: {
    label: 'Large-file / Resumable upload',
    text: 'Large uploads can continue from where they stopped instead of restarting from zero. The current file policy ceiling is 10 GiB.',
  },
  analysis: {
    label: 'Analysis',
    text: 'Super ii inspects supported files and extracts useful technical information without changing the original artifact.',
  },
  tensorInformation: {
    label: 'Tensor information',
    text: 'Tensors are the numerical arrays that contain much of a model’s learned information.',
  },
  tokenizer: {
    label: 'Tokenizer',
    text: 'A tokenizer converts text into the smaller units a language model processes.',
  },
  parameters: {
    label: 'Parameters',
    text: 'Parameters are learned numerical values inside a model. More parameters usually means a larger model, not automatically a better one.',
  },
  quantization: {
    label: 'Quantization',
    text: 'Quantization reduces the numerical precision of a model so it can use less memory and often run faster. Quality can change slightly.',
  },
  gguf: {
    label: 'GGUF',
    text: 'GGUF is a model file format commonly used for efficient local inference, especially with llama.cpp.',
  },
  safetensors: {
    label: 'Safetensors',
    text: 'Safetensors is a model-weight format designed for safe and efficient loading.',
  },
  ram: {
    label: 'RAM',
    text: 'RAM is your computer’s main memory. Large models may need much more RAM than ordinary applications.',
  },
  vram: {
    label: 'VRAM',
    text: 'VRAM is memory on your GPU. It is often the main limit when running AI models locally.',
  },
  hardwareCompatibility: {
    label: 'Hardware compatibility',
    text: 'Super ii checks the model against known hardware requirements to estimate where it can run.',
    learnMore: '/docs#hardware',
  },
  compatible: {
    label: 'Compatible',
    text: 'Super ii found a technically compatible path for this hardware. Actual speed depends on the complete machine and configuration.',
  },
  derivedCompatibility: {
    label: 'Derived compatibility',
    text: 'This result is calculated from known model and hardware facts. It is guidance, not a measured benchmark.',
  },
  verifiedCompatibility: {
    label: 'Verified compatibility',
    text: 'This combination has supporting verification evidence rather than only a calculated estimate.',
  },
  runOnHardware: {
    label: 'Run on my hardware',
    text: 'Super ii helps choose a suitable way to run this model using your own machine. It does not automatically buy cloud compute.',
  },
  useThisModel: {
    label: 'Use this model',
    text: 'Shows practical ways to use this exact reviewed model—locally, through supported software, scripts, notebooks or APIs.',
    learnMore: '/docs#use-model',
  },
  verifiedUse: {
    label: 'Verified Use',
    text: 'Verified Use provides reviewed instructions for running a model with supported software and compatible hardware.',
    learnMore: '/docs#use-model',
  },
  recommendedRuntime: {
    label: 'Recommended runtime',
    text: 'A runtime is the software that actually loads and runs the model. Super ii recommends one based on the model and available hardware.',
  },
  llamaCpp: {
    label: 'llama.cpp',
    text: 'A popular open-source runtime for running many language models efficiently on local hardware.',
  },
  mlx: {
    label: 'MLX',
    text: 'Apple’s machine-learning framework optimized for Apple silicon Macs.',
  },
  ktransformers: {
    label: 'KTransformers',
    text: 'A runtime designed especially for large models that can divide work between CPU and GPU.',
  },
  vllm: {
    label: 'vLLM',
    text: 'A high-throughput serving engine designed for running language models efficiently on GPU servers.',
  },
  sglang: {
    label: 'SGLang',
    text: 'A serving and execution system designed for efficient language-model and agent workloads.',
  },
  browserWebgpu: {
    label: 'Browser / WebGPU',
    text: 'Some models can run directly in your browser using your device’s GPU. Your hardware and browser determine availability.',
  },
  local: {
    label: 'Local',
    text: 'Local means the model runs on hardware you control instead of a Super ii-hosted GPU service.',
  },
  openAiCompatibleApi: {
    label: 'OpenAI-compatible API',
    text: 'This API uses a request format supported by many existing AI applications. It does not mean OpenAI hosts or operates the model.',
  },
  notebook: {
    label: 'Notebook',
    text: 'A notebook combines explanations, code and results in one document.',
    learnMore: '/docs#notebooks',
  },
  staticNotebook: {
    label: 'Static notebook',
    text: 'Reading this notebook does not execute its code. You can inspect it safely like a document.',
  },
  runNotebook: {
    label: 'Run notebook',
    text: 'This explicitly starts code execution. Reading the notebook alone never runs anything.',
  },
  isolatedExecution: {
    label: 'Isolated execution',
    text: 'Super ii runs this notebook in a restricted temporary environment with defined resource and access limits.',
  },
  mcp: {
    label: 'MCP',
    text: 'MCP is a standard way for AI agents to discover and use tools provided by Super ii.',
    learnMore: '/docs#agent-native',
  },
  connectAgent: {
    label: 'Connect an agent',
    text: 'Connect your coding or AI agent to Super ii so it can search and understand Super ii directly.',
  },
  publicMcp: {
    label: 'Public MCP',
    text: 'Agents can search and inspect public Super ii information through MCP. The public connection is read-only.',
  },
  readOnly: {
    label: 'Read-only',
    text: 'The agent can look, search and retrieve information, but it cannot change or publish anything.',
  },
  agentPermissions: {
    label: 'Agent permissions',
    text: 'You control exactly what an authenticated agent may do. Access can be limited by repository, action and time.',
  },
  scopedAccess: {
    label: 'Scoped access',
    text: 'Scoped means the credential works only for the permissions it was specifically given.',
  },
  accessToken: {
    label: 'Access token',
    text: 'A token is a credential software can use instead of your password. Treat it like a secret.',
  },
  serviceAccount: {
    label: 'Service account',
    text: 'A service account is an identity for software or automation rather than a human user.',
  },
  trustedPublishing: {
    label: 'Trusted publishing',
    text: 'Trusted publishing lets approved automation publish using short-lived verified identity instead of storing a permanent upload password.',
    learnMore: '/docs#trusted-publishing',
  },
  agentTrace: {
    label: 'Agent trace',
    text: 'A trace records selected information about an agent’s activity so its work can be understood or audited. Private data is not automatically made public.',
  },
  machineReadable: {
    label: 'Machine-readable',
    text: 'The same information is available in structured formats so software and agents do not need to scrape the human webpage.',
  },
  agentsMd: {
    label: 'agents.md',
    text: 'A simple file that tells AI agents how to understand and work with this repository.',
  },
  useJson: {
    label: 'use.json',
    text: 'Machine-readable instructions describing supported ways to use this model.',
  },
  useMd: {
    label: 'use.md',
    text: 'A human- and agent-readable guide generated from the same usage information.',
  },
  useSh: {
    label: 'use.sh',
    text: 'A shell script containing a supported usage path for this model. Read it before running it on your machine.',
  },
  mcpTool: {
    label: 'MCP tool',
    text: 'A specific action an AI agent can discover and call through Super ii’s MCP interface.',
  },
  agentCard: {
    label: 'Agent Card / A2A',
    text: 'An Agent Card tells other AI agents what a service can do and how they can communicate with it.',
  },
  systemStatus: {
    label: 'Status',
    text: 'Super ii separates code existing from a feature actually being usable. Check the status before depending on a capability.',
    learnMore: '/system-state',
  },
  designed: {
    label: 'Designed',
    text: 'The feature and its safety boundaries are defined, but it is not yet implemented for use.',
  },
  implemented: {
    label: 'Implemented',
    text: 'The code exists. That does not mean the feature is deployed or available yet.',
  },
  tested: {
    label: 'Tested',
    text: 'Repeatable tests pass for this capability.',
  },
  integrated: {
    label: 'Integrated',
    text: 'The required parts work together through the real system path.',
  },
  production: {
    label: 'Production',
    text: 'The capability is deployed on the public production system and has production evidence. This does not automatically mean GA.',
  },
  ga: {
    label: 'GA',
    text: 'Generally Available: mature enough for documented general use and support.',
  },
  availability: {
    label: 'Availability',
    text: 'Status tells you how mature the capability is. Availability tells you whether you can actually use it now.',
  },
  thirtyDayAccess: {
    label: '30-day access',
    text: 'Your paid plan stays active for 30 days from payment. Renew whenever you want.',
  },
  unlimitedPublicRepositories: {
    label: 'Unlimited public repositories',
    text: 'Create as many public repositories as you need. Included hosted storage is limited to 5 GB.',
  },
  hostedStorage25: {
    label: '25 GB hosted storage',
    text: 'Your Pro account includes up to 25 GB of hosted Super ii storage across your repositories. Additional storage can be purchased separately.',
  },
  pooledStorage: {
    label: 'Pooled storage',
    text: "Each paid Team member adds 50 GB to the organization's shared storage pool. Five paid members provide 250 GB total.",
  },
  ssoAddOn: {
    label: 'SSO add-on',
    text: 'Single Sign-On can be added separately for organizations that need managed identity access.',
  },
  customerSuppliedInfrastructure: {
    label: 'Customer-supplied infrastructure',
    text: 'Run Super ii Runtime on your own AWS, Google Cloud, Azure, GPU servers, datacenter or compatible infrastructure while Super ii provides the control and governance layer.',
  },
  browserLocalExecution: {
    label: 'Browser / local execution',
    text: 'The model runs on your device or infrastructure instead of requiring Super ii hosted compute. This keeps execution private, portable and inexpensive.',
  },
  byocHardware: {
    label: 'BYOC / BYO hardware',
    text: 'BYOC means Bring Your Own Cloud. BYO hardware means using infrastructure you already own or rent directly.',
  },
  storage: {
    label: 'Storage',
    text: "Storage measures the actual hosted data attached to your Super ii account or organization. Identical content may be stored efficiently through Super ii's content-addressed storage system.",
  },
  highlights: {
    label: 'Highlights',
    text: 'Creators can purchase clearly marked promotional placement without changing organic rankings or community voting.',
  },
  usdcEthereum: {
    label: 'USDC on Ethereum',
    text: 'Send USDC using the Ethereum network shown during checkout. Sending another asset or using the wrong network can result in loss of funds.',
  },
  freePlan: {
    label: 'Free plan',
    text: 'Free public participation. Paid infrastructure is not automatically started by using the Free plan.',
  },
  pro30Days: {
    label: 'Pro · 30 days',
    text: 'Pro access lasts 30 days from activation and currently requires manual renewal.',
  },
  teamPerMember: {
    label: 'Team · per member',
    text: 'The Team price applies to each participating team member for the stated period.',
  },
  usdc: {
    label: 'USDC',
    text: 'USDC is a digital currency designed to track the US dollar. Super ii currently accepts it for paid plan activation.',
  },
  ethereum: {
    label: 'Ethereum',
    text: 'Ethereum is the blockchain network used for the current USDC payment. Sending through the wrong network can cause loss.',
  },
  manualRenewal: {
    label: 'Manual renewal',
    text: 'The plan does not automatically charge you again. You choose whether to purchase the next period.',
  },
  networkFee: {
    label: 'Network fee',
    text: 'Blockchain transactions can include a network fee that is separate from the Super ii plan price.',
  },
  usageInfrastructure: {
    label: 'Usage-based infrastructure',
    text: 'Your subscription gives you the Super ii platform and included allowances. Infrastructure with substantial storage or compute cost is measured separately.',
  },
  compute: {
    label: 'Compute',
    text: 'Compute is the CPU/GPU processing used to run AI workloads.',
  },
  hostedEndpoint: {
    label: 'Hosted endpoint',
    text: 'A hosted endpoint keeps a model available behind an API so applications can call it remotely.',
  },
  resourceGroup: {
    label: 'Resource group',
    text: 'A resource group lets a team control access to a defined group of repositories or resources together.',
  },
  rbac: {
    label: 'RBAC / Roles',
    text: 'Role-based access control gives different permissions to different people, such as owner, maintainer or viewer.',
  },
  auditHistory: {
    label: 'Audit history',
    text: 'A record of important actions so a team can see who did what and when.',
  },
  sso: {
    label: 'SSO',
    text: 'Single Sign-On lets employees use their organization’s existing identity system to sign in.',
  },
  directorySync: {
    label: 'Directory sync',
    text: 'Directory sync keeps Super ii organization membership aligned with your company’s identity directory.',
  },
  regionalDeployment: {
    label: 'Regional deployment',
    text: 'A regional deployment places agreed services or data in a specified geographic region. Exact scope belongs in the Enterprise agreement.',
  },
  enterpriseProposal: {
    label: 'Enterprise proposal',
    text: 'Enterprise features are agreed in writing for the specific customer. A label alone is not the contract.',
    learnMore: '/enterprise',
  },
  creatorMonetization: {
    label: 'Creator monetization — planned',
    text: 'This feature is being considered or built but is not currently an active earning promise.',
  },
  emptyCatalog: {
    label: 'Empty catalog',
    text: 'Nothing is missing. Super ii starts without fake community content and adds work only after real creators publish reviewed releases.',
  },
} as const;

export type InfoHelpKey = keyof typeof infoHelp;

export function getInfoHelp(term: InfoHelpKey): InfoHelpEntry {
  return infoHelp[term];
}
