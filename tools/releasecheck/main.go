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

	planIDs := make([]string, 0, len(contract.Plans))
	for _, p := range contract.Plans {
		planIDs = append(planIDs, p.ID)
		if len(p.Features) == 0 {
			errors = append(errors, "plan has no features: "+p.ID)
		}
		if p.ID != "free" && p.Status == "available" {
			errors = append(errors, "paid plan marked available before billing activation: "+p.ID)
		}
	}
	sort.Strings(planIDs)
	if strings.Join(planIDs, ",") != "enterprise,free,pro,team" {
		errors = append(errors, "expected Free, Pro, Team, and Enterprise plan ids")
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
