package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const expectedLogoHash = "b28353284ddd75513d5344684711a2a2f50065197b9510c12b909adbd346f60f"
const maxWASMBytes int64 = 25 * 1024 * 1024

type plan struct {
	ID       string   `json:"id"`
	Status   string   `json:"status"`
	Price    string   `json:"price"`
	Features []string `json:"features"`
}

type siteContract struct {
	Brand struct {
		Name      string `json:"name"`
		ShortName string `json:"shortName"`
		URL       string `json:"url"`
	} `json:"brand"`
	Catalog map[string][]json.RawMessage `json:"catalog"`
	Plans   []plan                       `json:"plans"`
	Routes  []string                     `json:"routes"`
}

type skillManifest struct {
	SchemaVersion string `json:"schema_version"`
	Name          string `json:"name"`
	Version       string `json:"version"`
	Files         []struct {
		Path   string `json:"path"`
		SHA256 string `json:"sha256"`
	} `json:"files"`
}

type skillPublicKey struct {
	KeyID     string `json:"key_id"`
	Algorithm string `json:"algorithm"`
	PublicKey string `json:"public_key"`
}

type skillSignature struct {
	SignedFile string `json:"signed_file"`
	Algorithm  string `json:"algorithm"`
	KeyID      string `json:"key_id"`
	Signature  string `json:"signature"`
}

func verifyAgentSkill(root string) []string {
	errors := make([]string, 0)
	skillRoot := filepath.Join(root, "public", "skills", "superii")
	manifestBytes, err := os.ReadFile(filepath.Join(skillRoot, "manifest.json"))
	if err != nil {
		return []string{"cannot read signed Agent Skill manifest"}
	}
	var manifest skillManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return []string{"Agent Skill manifest is invalid JSON"}
	}
	if manifest.SchemaVersion != "1.0.0" || manifest.Name != "superii" || manifest.Version == "" {
		errors = append(errors, "Agent Skill manifest identity changed")
	}
	if len(manifest.Files) == 0 {
		errors = append(errors, "Agent Skill manifest contains no files")
	}
	seen := map[string]bool{}
	for _, file := range manifest.Files {
		clean := filepath.Clean(file.Path)
		if clean == "." || clean == ".." || filepath.IsAbs(clean) || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || seen[clean] {
			errors = append(errors, "Agent Skill manifest contains unsafe or duplicate path: "+file.Path)
			continue
		}
		seen[clean] = true
		bytes, readErr := os.ReadFile(filepath.Join(skillRoot, clean))
		if readErr != nil {
			errors = append(errors, "Agent Skill manifest file missing: "+clean)
			continue
		}
		hash := sha256.Sum256(bytes)
		if hex.EncodeToString(hash[:]) != file.SHA256 {
			errors = append(errors, "Agent Skill file checksum changed: "+clean)
		}
	}

	keyBytes, keyErr := os.ReadFile(filepath.Join(skillRoot, "public-key.json"))
	signatureBytes, signatureErr := os.ReadFile(filepath.Join(skillRoot, "signature.json"))
	if keyErr != nil || signatureErr != nil {
		return append(errors, "Agent Skill public key or signature is missing")
	}
	var key skillPublicKey
	var signature skillSignature
	if json.Unmarshal(keyBytes, &key) != nil || json.Unmarshal(signatureBytes, &signature) != nil {
		return append(errors, "Agent Skill public key or signature JSON is invalid")
	}
	if key.Algorithm != "Ed25519" || signature.Algorithm != "Ed25519" || signature.SignedFile != "manifest.json" || key.KeyID != signature.KeyID {
		return append(errors, "Agent Skill signature contract changed")
	}
	publicKey, publicKeyErr := base64.StdEncoding.DecodeString(key.PublicKey)
	detachedSignature, detachedErr := base64.StdEncoding.DecodeString(signature.Signature)
	if publicKeyErr != nil || detachedErr != nil || len(publicKey) != ed25519.PublicKeySize || len(detachedSignature) != ed25519.SignatureSize {
		return append(errors, "Agent Skill signature material is malformed")
	}
	if !ed25519.Verify(ed25519.PublicKey(publicKey), manifestBytes, detachedSignature) {
		errors = append(errors, "Agent Skill Ed25519 signature verification failed")
	}
	return errors
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: releasecheck <site.json>")
		os.Exit(2)
	}

	contractPath, err := filepath.Abs(os.Args[1])
	check(err)
	root := filepath.Clean(filepath.Join(filepath.Dir(contractPath), "..", ".."))

	data, err := os.ReadFile(contractPath)
	check(err)
	var contract siteContract
	check(json.Unmarshal(data, &contract))

	errors := make([]string, 0)
	if contract.Brand.Name != "Super ii" || contract.Brand.ShortName != "Sii" {
		errors = append(errors, "brand contract changed")
	}
	if contract.Brand.URL != "https://superii.site" {
		errors = append(errors, "canonical URL changed")
	}

	for _, kind := range []string{"models", "datasets", "spaces"} {
		entries, ok := contract.Catalog[kind]
		if !ok {
			errors = append(errors, "missing catalog: "+kind)
		} else if len(entries) != 0 {
			errors = append(errors, kind+" catalog must be empty at launch")
		}
	}

	routes := map[string]bool{}
	for _, route := range contract.Routes {
		if routes[route] {
			errors = append(errors, "duplicate route: "+route)
		}
		routes[route] = true
		if !strings.HasPrefix(route, "/") {
			errors = append(errors, "route must begin with /: "+route)
		}
	}
	for _, requiredRoute := range []string{"/agents", "/agents.md", "/agent-connectors.json", "/llms-full.txt", "/openapi.json", "/docs.json", "/.well-known/agent-card.json", "/a2a/v1/message:send", "/mcp", "/mcp/work", "/notebooks", "/runtime-registry.json", "/system-state", "/system-state.json", "/system-state.md"} {
		if !routes[requiredRoute] {
			errors = append(errors, "missing agent-native route: "+requiredRoute)
		}
	}
	for _, requiredFile := range []string{
		"SYSTEM-STATE.md",
		filepath.Join("src", "lib", "agent-resources.ts"),
		filepath.Join("src", "lib", "mcp-server.ts"),
		filepath.Join("src", "pages", "mcp.ts"),
		filepath.Join("src", "pages", "agents.astro"),
		filepath.Join("src", "content", "agent-connectors.json"),
		filepath.Join("public", "schemas", "agent-connector-registry-v1.json"),
		filepath.Join("public", "skills", "superii", "SKILL.md"),
		filepath.Join("public", "skills", "superii", "manifest.json"),
		filepath.Join("public", "skills", "superii", "signature.json"),
		filepath.Join("public", "skills", "superii", "public-key.json"),
		filepath.Join("src", "pages", ".well-known", "agent-card.json.ts"),
		filepath.Join("src", "pages", "a2a", "v1", "[...operation].ts"),
		filepath.Join("src", "lib", "a2a.ts"),
		filepath.Join("src", "lib", "agent-auth.ts"),
		filepath.Join("src", "lib", "agent-profile.ts"),
		filepath.Join("src", "lib", "work-mcp-server.ts"),
		filepath.Join("src", "pages", "mcp", "work.ts"),
		filepath.Join("src", "components", "AgentWorkspace.astro"),
		filepath.Join("database", "migrations", "0012_agent_participation.sql"),
		filepath.Join("docs", "architecture", "agent-participation.md"),
		filepath.Join("public", "schemas", "repository-manifest-v1.json"),
		filepath.Join("public", "schemas", "repository-api-v1.json"),
		filepath.Join("public", "schemas", "use-manifest-v1.json"),
		filepath.Join("public", "schemas", "runtime-registry-v1.json"),
		filepath.Join("src", "content", "runtime-registry.json"),
		filepath.Join("src", "lib", "use-model.ts"),
		filepath.Join("src", "components", "UseModel.astro"),
		filepath.Join("src", "pages", "runtime-registry.json.ts"),
		filepath.Join("database", "migrations", "0007_agent_native_foundation.sql"),
		filepath.Join("database", "migrations", "0008_notebook_foundation.sql"),
		filepath.Join("database", "migrations", "0009_resumable_runtime.sql"),
		filepath.Join("database", "migrations", "0010_use_model_foundation.sql"),
		filepath.Join("docs", "architecture", "notebook-security.md"),
		filepath.Join("docs", "architecture", "resumable-transfers.md"),
		filepath.Join("docs", "architecture", "persistent-inference.md"),
		filepath.Join("runtime", "src", "superii_runtime", "inspectors", "notebooks.py"),
		filepath.Join("runtime", "src", "superii_runtime", "notebooks.py"),
		filepath.Join("runtime", "src", "superii_runtime", "workspace_cache.py"),
		filepath.Join("runtime", "src", "superii_runtime", "runtimes", "llama_server.py"),
		filepath.Join("runtime", "notebook-image", "Dockerfile"),
		filepath.Join("rust", "Cargo.toml"),
		filepath.Join("rust", "Cargo.lock"),
		filepath.Join("rust", "src", "transfer.rs"),
		filepath.Join("rust", "src", "bin", "superii-transferd.rs"),
		filepath.Join("rust", "src", "bin", "superii.rs"),
		filepath.Join("rust", "src", "connect.rs"),
		filepath.Join("src", "lib", "transfer-ticket.ts"),
		filepath.Join("src", "pages", "api", "transfers", "[transferId].ts"),
		filepath.Join("src", "pages", "repositories", "[repositoryId]", "edit.astro"),
		filepath.Join("src", "content", "notebooks.json"),
		filepath.Join("notebooks", "getting-started", "super-ii-api-and-mcp.ipynb"),
		filepath.Join("notebooks", "repositories", "create-and-verify-a-dataset.ipynb"),
		filepath.Join("notebooks", "evaluation", "reproducible-model-evaluation.ipynb"),
	} {
		if info, statErr := os.Stat(filepath.Join(root, requiredFile)); statErr != nil || !info.Mode().IsRegular() {
			errors = append(errors, "missing agent-native release file: "+requiredFile)
		}
	}
	errors = append(errors, verifyAgentSkill(root)...)
	for relative, markers := range map[string][]string{
		filepath.Join("rust", "src", "transfer.rs"): {
			`TUS_VERSION: &str = "1.0.0"`, "is_loopback()", "ct_eq", "sync_all",
		},
		filepath.Join("runtime", "src", "superii_runtime", "notebooks.py"): {
			`"--network=none"`, `"--ipc=none"`, `"--cap-drop=ALL"`, "result_sha256",
		},
		filepath.Join("runtime", "src", "superii_runtime", "runtimes", "llama_server.py"): {
			`"127.0.0.1"`, `"--cont-batching"`, `"--no-webui"`, "record_model_instance",
		},
		filepath.Join("src", "lib", "transfer-ticket.ts"): {
			"superii-transfer-ticket-v1", "HMAC", "SHA-256",
		},
		filepath.Join("src", "pages", "api", "transfers", "[transferId].ts"): {
			"transfer_runtime_state_missing", "advance_resumable_upload",
		},
		filepath.Join("src", "pages", "repositories", "[repositoryId]", "edit.astro"): {
			"TransferResumeError", "sessionStorage", "upload-checksum",
		},
		filepath.Join("src", "lib", "use-model.ts"): {
			"superii-local-deterministic-v1", "transmittedToSuperii: false", "local_files_only=True", "useDownloadScript", "useNotebook",
		},
		filepath.Join("src", "components", "UseModel.astro"): {
			"Hardware profile", "data-use-model-open", "hostedInference.statement",
		},
		filepath.Join("src", "lib", "work-mcp-server.ts"): {
			"createMcpHandler", "create_draft_repository", "create_revision", "prepare_resumable_upload",
			"submit_revision_for_review", "claim_contribution_job", "submit_contribution_job", "get_action_receipt",
			"This tool cannot publish",
		},
		filepath.Join("database", "migrations", "0012_agent_participation.sql"): {
			"spend_limit_cents = 0", "consume_agent_access_token", "agent_create_repository_with_receipt",
			"agent_action_receipts_immutable", "review_agent_contribution",
		},
		filepath.Join("rust", "src", "connect.rs"): {
			`PUBLIC_MCP_URL: &str = "https://superii.site/mcp"`, "atomic_replace", "mode(0o600)",
			"configuration changed since connect; rollback refused", "already exists with a different URL; no file was changed",
		},
	} {
		content, readErr := os.ReadFile(filepath.Join(root, relative))
		if readErr != nil {
			continue
		}
		for _, marker := range markers {
			if !strings.Contains(string(content), marker) {
				errors = append(errors, "release contract missing "+marker+" in "+relative)
			}
		}
	}

	planIDs := make([]string, 0, len(contract.Plans))
	availablePaid := make([]string, 0)
	for _, p := range contract.Plans {
		planIDs = append(planIDs, p.ID)
		if len(p.Features) == 0 {
			errors = append(errors, "plan has no features: "+p.ID)
		}
		if p.ID != "free" && p.Status == "available" {
			availablePaid = append(availablePaid, p.ID)
		}
	}
	sort.Strings(planIDs)
	if strings.Join(planIDs, ",") != "enterprise,free,pro,team" {
		errors = append(errors, "expected Free, Pro, Team, and Enterprise plan ids")
	}
	sort.Strings(availablePaid)
	if strings.Join(availablePaid, ",") != "pro,team" {
		errors = append(errors, "paid availability must be exactly Pro and Team")
	} else {
		billingPaths := []string{
			filepath.Join(root, "src", "lib", "nowpayments.ts"),
			filepath.Join(root, "src", "pages", "api", "checkout.ts"),
			filepath.Join(root, "src", "pages", "api", "payments", "nowpayments", "ipn.ts"),
			filepath.Join(root, "database", "migrations", "0005_creator_commerce.sql"),
		}
		billingContract := ""
		for _, path := range billingPaths {
			content, readErr := os.ReadFile(path)
			if readErr != nil {
				errors = append(errors, "paid billing source missing: "+path)
				continue
			}
			billingContract += strings.ToLower(string(content))
		}
		for _, marker := range []string{"nowpayments_api_key", "nowpayments_ipn_secret", "usdc", "apply_nowpayments_status"} {
			if !strings.Contains(billingContract, marker) {
				errors = append(errors, "paid billing contract missing "+marker)
			}
		}
	}

	logo, err := os.ReadFile(filepath.Join(root, "public", "brand", "super-ii-logo.png"))
	if err != nil {
		errors = append(errors, "cannot read supplied logo")
	} else {
		hash := sha256.Sum256(logo)
		if hex.EncodeToString(hash[:]) != expectedLogoHash {
			errors = append(errors, "supplied logo checksum changed")
		}
	}

	wasmFiles, globErr := filepath.Glob(filepath.Join(root, "public", "runtime-assets", "wasm", "*.wasm"))
	if globErr != nil || len(wasmFiles) == 0 {
		errors = append(errors, "browser inference release has no WASM assets")
	}
	for _, wasmPath := range wasmFiles {
		info, statErr := os.Stat(wasmPath)
		if statErr != nil {
			errors = append(errors, "cannot stat browser WASM asset: "+wasmPath)
			continue
		}
		if info.Size() > maxWASMBytes {
			errors = append(errors, "browser WASM asset exceeds 25 MiB: "+filepath.Base(wasmPath))
		}
	}

	if len(errors) > 0 {
		for _, message := range errors {
			fmt.Fprintln(os.Stderr, "ERROR:", message)
		}
		os.Exit(1)
	}

	fmt.Printf("OK: Go release contract verified %d routes, %d plans, empty catalogs, and supplied logo\n", len(contract.Routes), len(contract.Plans))
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "ERROR:", err)
		os.Exit(1)
	}
}
