package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"

	"github.com/spf13/cobra"

	"github.com/aoagents/agent-orchestrator/backend/internal/config"
)

// releaseRepo is the GitHub "owner/repo" that `ao start` fetches the desktop app
// from. It defaults to the production target and is overridable at build time so
// a test binary fetches from the fork without a source edit:
//
//	go build -ldflags "-X github.com/aoagents/agent-orchestrator/backend/internal/cli.releaseRepo=harshitsinghbhandari/agent-orchestrator" ./cmd/ao
//
// Mirrors how version.go's Version var is stamped by release tooling.
var releaseRepo = "AgentWrapper/agent-orchestrator"

// appBundleName is the macOS bundle directory name produced by electron-forge
// (spaced, per frontend/forge.config.ts).
const appBundleName = "Agent Orchestrator.app"

// appStateFileName is the marker the desktop app writes under ~/.ao on every
// launch (spec §5). `ao start` is a read-only consumer of it.
const appStateFileName = "app-state.json"

// appState mirrors the app-written ~/.ao/app-state.json marker (spec §5). Only
// the desktop app writes it; `ao start` reads it as a fast-path hint and never
// trusts appPath without stat-ing it (invariant 2).
type appState struct {
	SchemaVersion    int    `json:"schemaVersion"`
	AppPath          string `json:"appPath"`
	Version          string `json:"version"`
	InstalledAt      string `json:"installedAt"`
	LastReconciledAt string `json:"lastReconciledAt"`
	InstallSource    string `json:"installSource"`
}

type startOptions struct {
	json bool
}

// startResult is the JSON shape emitted with --json: what `ao start` resolved,
// whether it fetched, whether it opened, and the resulting bundle path.
type startResult struct {
	Resolved bool   `json:"resolved"`
	Fetched  bool   `json:"fetched"`
	Opened   bool   `json:"opened"`
	AppPath  string `json:"appPath"`
}

func newStartCommand(ctx *commandContext) *cobra.Command {
	opts := startOptions{}
	cmd := &cobra.Command{
		Use:   "start",
		Short: "Fetch (if needed) and open the Agent Orchestrator desktop app",
		Long: "Fetch (if needed) and open the Agent Orchestrator desktop app.\n\n" +
			"The desktop app now owns the daemon, state, and updates. `ao start` no\n" +
			"longer runs a daemon: it resolves the installed app (or downloads the\n" +
			"latest release), opens it, and exits.",
		Args: noArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			return ctx.runStart(cmd.Context(), cmd, opts)
		},
	}
	cmd.Flags().BoolVar(&opts.json, "json", false, "Output start result as JSON")
	return cmd
}

// TODO(spec §6.4): legacy first-boot import now belongs to the desktop app; standalone `ao import` still available.

// runStart implements the spec §6.1 algorithm: resolve the installed app, fetch
// it if absent, open it, then print the deprecation notice. It never blocks or
// supervises the launched app.
func (c *commandContext) runStart(ctx context.Context, cmd *cobra.Command, opts startOptions) error {
	out := cmd.OutOrStdout()
	res := startResult{}

	appPath, err := c.resolveApp()
	if err != nil {
		return err
	}
	res.Resolved = appPath != ""

	if appPath == "" {
		appPath, err = c.fetchApp(ctx)
		if err != nil {
			return err
		}
		res.Fetched = true
	}
	res.AppPath = appPath

	opened, err := c.openApp(ctx, appPath)
	if err != nil {
		return err
	}
	res.Opened = opened

	if opts.json {
		return writeJSON(out, res)
	}

	c.printDeprecationNotice(out)
	if !opened {
		c.printManualOpen(out, appPath)
	}
	return nil
}

// resolveApp returns the path to a usable desktop bundle, or "" when none is
// found (spec §6.2). Resolution order is fixed: marker path -> stat -> known
// location scan. It never compares versions (invariant 5).
func (c *commandContext) resolveApp() (string, error) {
	if p := c.markerAppPath(); p != "" && isUsableBundle(p) {
		return p, nil
	}
	for _, p := range appScanLocations() {
		if isUsableBundle(p) {
			return p, nil
		}
	}
	return "", nil
}

// appScanLocations is the known-location scan source. It is a package var so
// tests can point the scan at a temp bundle instead of real system paths.
var appScanLocations = knownAppLocations

// markerAppPath reads ~/.ao/app-state.json and returns its recorded appPath, or
// "" if the marker is missing/unreadable. It does not stat the path; callers do.
func (c *commandContext) markerAppPath() string {
	dir, err := aoStateDir()
	if err != nil {
		return ""
	}
	data, err := os.ReadFile(filepath.Join(dir, appStateFileName))
	if err != nil {
		return ""
	}
	var st appState
	if err := json.Unmarshal(data, &st); err != nil {
		return ""
	}
	return st.AppPath
}

// aoStateDir resolves the canonical ~/.ao home, honoring AO_DATA_DIR exactly as
// the daemon's config does (the marker lives beside running.json under ~/.ao).
func aoStateDir() (string, error) {
	cfg, err := config.Load()
	if err != nil {
		return "", err
	}
	// running.json lives directly under ~/.ao; the marker sits beside it.
	return filepath.Dir(cfg.RunFilePath), nil
}

// knownAppLocations lists the platform's standard install paths to scan when the
// marker misses (covers website installs and stale markers, spec §6.2).
func knownAppLocations() []string {
	switch runtime.GOOS {
	case "darwin":
		paths := []string{filepath.Join("/Applications", appBundleName)}
		if home, err := os.UserHomeDir(); err == nil {
			paths = append(paths, filepath.Join(home, "Applications", appBundleName))
		}
		return paths
	default:
		// Windows/Linux scan locations land in T6/T7.
		return nil
	}
}

// isUsableBundle reports whether p stats as a usable app bundle. On macOS a
// bundle is a directory; the filesystem is the source of truth (invariant 2).
func isUsableBundle(p string) bool {
	if p == "" {
		return false
	}
	info, err := os.Stat(p)
	if err != nil {
		return false
	}
	if runtime.GOOS == "darwin" {
		return info.IsDir()
	}
	return true
}

// fetchApp downloads the latest desktop release for this platform, unpacks it
// into a staging dir under ~/.ao/staging, and returns the bundle path (spec
// §6.3). Windows/Linux are tracked as T6/T7.
func (c *commandContext) fetchApp(ctx context.Context) (string, error) {
	if runtime.GOOS != "darwin" {
		return "", fmt.Errorf("ao start: fetch not yet implemented for %s (tracked as spec T6/T7)", runtime.GOOS)
	}

	asset, err := darwinAssetName()
	if err != nil {
		return "", err
	}
	url := downloadURL(asset)

	stateDir, err := aoStateDir()
	if err != nil {
		return "", err
	}
	staging := filepath.Join(stateDir, "staging")
	// Clear any stale or partial prior unpack so ditto extracts into a clean dir
	// (a leftover bundle could otherwise merge with the new one).
	if err := os.RemoveAll(staging); err != nil {
		return "", fmt.Errorf("clear staging dir: %w", err)
	}
	if err := os.MkdirAll(staging, 0o750); err != nil {
		return "", fmt.Errorf("create staging dir: %w", err)
	}

	zipPath := filepath.Join(staging, asset)
	if err := c.download(ctx, url, zipPath); err != nil {
		return "", fmt.Errorf("download %s: %w", url, err)
	}

	// ditto preserves the .app code signature; plain unzip corrupts it (spec §6.3).
	if out, err := c.deps.CommandOutput(ctx, "ditto", "-x", "-k", zipPath, staging); err != nil {
		return "", fmt.Errorf("ditto unpack: %w: %s", err, out)
	}

	appPath := filepath.Join(staging, appBundleName)
	if !isUsableBundle(appPath) {
		return "", fmt.Errorf("ao start: %s not found in unpacked release at %s", appBundleName, staging)
	}
	return appPath, nil
}

// download streams url to dst using the injected HTTP client.
func (c *commandContext) download(ctx context.Context, url, dst string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	// deps.HTTPClient carries a short (2s) timeout sized for loopback daemon
	// probes; a release asset is hundreds of MB. Copy the client and drop the
	// timeout, relying on ctx for cancellation. The Transport is preserved so
	// tests still reach their httptest server.
	client := *c.deps.HTTPClient
	client.Timeout = 0
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status %s", resp.Status)
	}

	f, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	if _, err := io.Copy(f, resp.Body); err != nil {
		return err
	}
	return f.Close()
}

// darwinAssetName maps Go's runtime.GOARCH to the release asset name. The
// release pipeline publishes "x64" for amd64 (spec §6.3, §8).
func darwinAssetName() (string, error) {
	arch, err := assetArch(runtime.GOARCH)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("agent-orchestrator-darwin-%s.zip", arch), nil
}

// assetArch maps a Go GOARCH to the release-asset arch token.
func assetArch(goarch string) (string, error) {
	switch goarch {
	case "arm64":
		return "arm64", nil
	case "amd64":
		return "x64", nil
	default:
		return "", fmt.Errorf("ao start: unsupported architecture %q", goarch)
	}
}

// downloadURL builds the constant releases/latest/download URL for asset.
func downloadURL(asset string) string {
	return fmt.Sprintf("https://github.com/%s/releases/latest/download/%s", releaseRepo, asset)
}

// openApp launches the resolved bundle detached and reports whether it launched
// (spec §6.5). It passes --installed-via=npm-bootstrap so the app can record the
// install source in its marker. It never waits on the app.
func (c *commandContext) openApp(ctx context.Context, appPath string) (bool, error) {
	if runtime.GOOS != "darwin" {
		// Non-darwin open lands in T6/T7; treat as "not opened" so the caller
		// prints manual-open instructions.
		return false, nil
	}
	// `open` returns immediately; --args forwards the rest to the app.
	if out, err := c.deps.CommandOutput(ctx, "open", appPath, "--args", "--installed-via=npm-bootstrap"); err != nil {
		return false, fmt.Errorf("open %s: %w: %s", appPath, err, out)
	}
	return true, nil
}

// printDeprecationNotice explains the new role of the npm `ao` binary. Keep it
// honest: Track B (live auto-update) is not done, so it does not promise it.
func (c *commandContext) printDeprecationNotice(w io.Writer) {
	_, _ = fmt.Fprint(w, "Agent Orchestrator is now a desktop app, and the npm `ao` is just its launcher.\n"+
		"The app is distributed from the website and GitHub Releases; it owns the daemon and updates itself.\n"+
		"You can keep running `ao start` to fetch (if needed) and open it.\n")
}

// printManualOpen tells the user how to open the bundle when `ao start` could
// not launch it for them (non-darwin, or a failed launch handled upstream).
func (c *commandContext) printManualOpen(w io.Writer, appPath string) {
	_, _ = fmt.Fprintf(w, "Could not open the app automatically. Open it manually: %s\n", appPath)
}
