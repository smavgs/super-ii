package main

import (
	"crypto/sha256"
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
	for _, requiredRoute := range []string{"/agents.md", "/mcp", "/notebooks", "/system-state", "/system-state.json", "/system-state.md"} {
		if !routes[requiredRoute] {
			errors = append(errors, "missing agent-native route: "+requiredRoute)
		}
	}
	for _, requiredFile := range []string{
		"SYSTEM-STATE.md",
		filepath.Join("src", "lib", "agent-resources.ts"),
		filepath.Join("src", "lib", "mcp-server.ts"),
		filepath.Join("src", "pages", "mcp.ts"),
		filepath.Join("public", "schemas", "repository-manifest-v1.json"),
		filepath.Join("public", "schemas", "repository-api-v1.json"),
		filepath.Join("database", "migrations", "0007_agent_native_foundation.sql"),
		filepath.Join("database", "migrations", "0008_notebook_foundation.sql"),
		filepath.Join("docs", "architecture", "notebook-security.md"),
		filepath.Join("runtime", "src", "superii_runtime", "inspectors", "notebooks.py"),
		filepath.Join("src", "content", "notebooks.json"),
		filepath.Join("notebooks", "getting-started", "super-ii-api-and-mcp.ipynb"),
		filepath.Join("notebooks", "repositories", "create-and-verify-a-dataset.ipynb"),
		filepath.Join("notebooks", "evaluation", "reproducible-model-evaluation.ipynb"),
	} {
		if info, statErr := os.Stat(filepath.Join(root, requiredFile)); statErr != nil || !info.Mode().IsRegular() {
			errors = append(errors, "missing agent-native release file: "+requiredFile)
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
