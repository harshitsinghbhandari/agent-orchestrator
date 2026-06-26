package cli

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
	"time"
)

// writeMarker writes a ~/.ao/app-state.json marker pointing at appPath into the
// configured state dir (AO_RUN_FILE's directory).
func writeMarker(t *testing.T, cfg testConfig, appPath string) {
	t.Helper()
	st := appState{SchemaVersion: 1, AppPath: appPath, InstallSource: "npm-bootstrap"}
	data, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Dir(cfg.runFile)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, appStateFileName), data, 0o600); err != nil {
		t.Fatal(err)
	}
}

// makeBundle creates a directory that stats as a usable bundle on every OS.
func makeBundle(t *testing.T, name string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.MkdirAll(p, 0o750); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestResolveApp_MarkerHit(t *testing.T) {
	cfg := setConfigEnv(t)
	bundle := makeBundle(t, appBundleName)
	writeMarker(t, cfg, bundle)
	// No scan locations: a hit must come from the marker.
	t.Cleanup(swapScanLocations(func() []string { return nil }))

	c := &commandContext{deps: Deps{}.withDefaults()}
	got, err := c.resolveApp()
	if err != nil {
		t.Fatal(err)
	}
	if got != bundle {
		t.Fatalf("resolveApp = %q, want marker path %q", got, bundle)
	}
}

func TestResolveApp_MarkerMissThenScanHit(t *testing.T) {
	cfg := setConfigEnv(t)
	// Marker points at a path that does not exist -> must fall through to scan.
	writeMarker(t, cfg, filepath.Join(t.TempDir(), "gone", appBundleName))
	scanBundle := makeBundle(t, appBundleName)
	t.Cleanup(swapScanLocations(func() []string { return []string{scanBundle} }))

	c := &commandContext{deps: Deps{}.withDefaults()}
	got, err := c.resolveApp()
	if err != nil {
		t.Fatal(err)
	}
	if got != scanBundle {
		t.Fatalf("resolveApp = %q, want scan path %q", got, scanBundle)
	}
}

func TestResolveApp_ScanMissReturnsEmpty(t *testing.T) {
	setConfigEnv(t) // no marker written
	t.Cleanup(swapScanLocations(func() []string {
		return []string{filepath.Join(t.TempDir(), "nope", appBundleName)}
	}))

	c := &commandContext{deps: Deps{}.withDefaults()}
	got, err := c.resolveApp()
	if err != nil {
		t.Fatal(err)
	}
	if got != "" {
		t.Fatalf("resolveApp = %q, want empty", got)
	}
}

func TestAssetArchMapping(t *testing.T) {
	cases := map[string]struct {
		want    string
		wantErr bool
	}{
		"arm64": {want: "arm64"},
		"amd64": {want: "x64"},
		"386":   {wantErr: true},
	}
	for goarch, tc := range cases {
		got, err := assetArch(goarch)
		if tc.wantErr {
			if err == nil {
				t.Errorf("assetArch(%q) = %q, want error", goarch, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("assetArch(%q): unexpected error %v", goarch, err)
		}
		if got != tc.want {
			t.Errorf("assetArch(%q) = %q, want %q", goarch, got, tc.want)
		}
	}
}

func TestDownloadURLUsesReleaseRepo(t *testing.T) {
	orig := releaseRepo
	releaseRepo = "owner/repo"
	t.Cleanup(func() { releaseRepo = orig })

	got := downloadURL("agent-orchestrator-darwin-arm64.zip")
	want := "https://github.com/owner/repo/releases/latest/download/agent-orchestrator-darwin-arm64.zip"
	if got != want {
		t.Fatalf("downloadURL = %q, want %q", got, want)
	}
}

func TestOpenApp_ArgConstruction(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("openApp launches via `open` only on darwin")
	}
	var gotName string
	var gotArgs []string
	c := &commandContext{deps: Deps{
		CommandOutput: func(_ context.Context, name string, args ...string) ([]byte, error) {
			gotName = name
			gotArgs = args
			return nil, nil
		},
	}.withDefaults()}

	opened, err := c.openApp(context.Background(), "/Applications/Agent Orchestrator.app")
	if err != nil {
		t.Fatal(err)
	}
	if !opened {
		t.Fatal("openApp reported not opened")
	}
	if gotName != "open" {
		t.Fatalf("command = %q, want open", gotName)
	}
	wantArgs := []string{"/Applications/Agent Orchestrator.app", "--args", "--installed-via=npm-bootstrap"}
	if !reflect.DeepEqual(gotArgs, wantArgs) {
		t.Fatalf("args = %v, want %v", gotArgs, wantArgs)
	}
}

// TestDownload_IgnoresShortClientTimeout proves download() does not inherit the
// 2s deps.HTTPClient timeout (sized for loopback probes), which would otherwise
// fail every real release download. The server responds after a delay that
// exceeds the injected client's tiny timeout; download must still succeed.
func TestDownload_IgnoresShortClientTimeout(t *testing.T) {
	const body = "release-zip-bytes"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(150 * time.Millisecond)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)

	c := &commandContext{deps: Deps{
		// 50ms timeout: if download honored this, the 150ms server would fail it.
		HTTPClient: &http.Client{Timeout: 50 * time.Millisecond},
	}.withDefaults()}

	dst := filepath.Join(t.TempDir(), "out.zip")
	if err := c.download(context.Background(), srv.URL, dst); err != nil {
		t.Fatalf("download failed (short client timeout leaked into large-asset path?): %v", err)
	}
	got, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != body {
		t.Fatalf("downloaded %q, want %q", got, body)
	}
}

// swapScanLocations replaces the scan-location seam and returns a restore func.
func swapScanLocations(fn func() []string) func() {
	orig := appScanLocations
	appScanLocations = fn
	return func() { appScanLocations = orig }
}
