package executors

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/aoagents/agent-orchestrator/backend/internal/pipeline"
)

// findingsFileSizeCapBytes bounds how much of a stage's findings file the
// executor reads (spec §4b). Beyond the cap, trailing lines are dropped and a
// pipeline.findings.truncated observation is emitted. Generous enough for
// thousands of legitimate findings, small enough to keep a misbehaving agent
// from OOMing the engine.
const findingsFileSizeCapBytes = 5 * 1024 * 1024

// stageFindingsRelativePath is the conventional findings drop, relative to the
// stage workspace root.
var stageFindingsRelativePath = filepath.Join(".ao", pipeline.FindingsFilename)

// parseResult is the outcome of harvesting a findings file.
type parseResult struct {
	artifacts []pipeline.ArtifactInput
	// truncated is true when the cap fired and trailing lines were dropped.
	truncated bool
	// bytesRead is how many bytes were consumed before stopping.
	bytesRead int64
}

// validSeverities are the finding severities the coercion accepts.
var validSeverities = map[string]bool{
	string(pipeline.SeverityError):   true,
	string(pipeline.SeverityWarning): true,
	string(pipeline.SeverityInfo):    true,
}

// parseFindingsFile streams the findings JSONL line by line, capping at
// findingsFileSizeCapBytes. Behavior:
//
//   - Complete lines (any line followed by a newline) are parsed strictly; a
//     malformed complete line fails the whole harvest so a human can inspect a
//     genuinely broken file.
//   - A torn final line (the last line, with no trailing newline, that fails to
//     JSON-parse) is tolerated: it is dropped silently. The write-then-rename
//     contract makes torn writes rare, but a truncated tail must never fail an
//     otherwise-good harvest.
//   - When the byte cap fires, reading stops, the in-progress line is dropped,
//     and truncated is set so the caller emits an observation.
//
// An empty or all-blank file yields zero artifacts and no error: file
// existence, not contents, is the completion signal.
func parseFindingsFile(path string) (parseResult, error) {
	f, err := os.Open(path)
	if err != nil {
		return parseResult{}, err
	}
	defer func() { _ = f.Close() }()

	reader := bufio.NewReader(f)
	var out []pipeline.ArtifactInput
	var bytesRead int64
	lineNo := 0
	truncated := false

	for {
		line, readErr := reader.ReadString('\n')
		// A final chunk without a trailing newline is a potentially-torn line:
		// ReadString returns the bytes plus io.EOF.
		torn := errors.Is(readErr, io.EOF) && !hasTrailingNewline(line)

		// Account for the bytes of this line (including its newline) against the
		// cap before parsing so the measured size matches the file size.
		bytesRead += int64(len(line))
		if bytesRead > findingsFileSizeCapBytes {
			truncated = true
			break
		}

		trimmed := trimLine(line)
		if trimmed != "" {
			lineNo++
			artifact, perr := coerceArtifactInput([]byte(trimmed))
			if perr != nil {
				if torn {
					// Tolerate a torn final line: drop it rather than failing an
					// otherwise-complete harvest.
					break
				}
				return parseResult{}, fmt.Errorf("line %d: %w", lineNo, perr)
			}
			out = append(out, artifact)
		}

		if readErr != nil {
			// io.EOF (or any read error) ends the stream. A non-EOF error on a
			// local file is unexpected; surface it.
			if !errors.Is(readErr, io.EOF) {
				return parseResult{}, readErr
			}
			break
		}
	}

	return parseResult{artifacts: out, truncated: truncated, bytesRead: bytesRead}, nil
}

// coerceArtifactInput validates one JSONL record into an ArtifactInput,
// enforcing the per-kind required fields the old executor checked (finding
// needs its structural fields + a valid severity + confidence in [0,1]; json
// needs a data object).
func coerceArtifactInput(raw []byte) (pipeline.ArtifactInput, error) {
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return pipeline.ArtifactInput{}, err
	}

	var art pipeline.ArtifactInput
	if err := json.Unmarshal(raw, &art); err != nil {
		return pipeline.ArtifactInput{}, err
	}

	switch art.Kind {
	case pipeline.ArtifactKindFinding:
		if err := requireFields(probe, "filePath", "startLine", "endLine", "title", "description", "category", "severity", "confidence"); err != nil {
			return pipeline.ArtifactInput{}, err
		}
		if !validSeverities[string(art.Severity)] {
			return pipeline.ArtifactInput{}, fmt.Errorf(`field "severity" must be one of "error", "warning", "info", got %q`, art.Severity)
		}
		if art.Confidence < 0 || art.Confidence > 1 {
			return pipeline.ArtifactInput{}, fmt.Errorf(`field "confidence" must be a number in [0, 1], got %v`, art.Confidence)
		}
		return art, nil
	case pipeline.ArtifactKindJSON:
		if len(art.Data) == 0 {
			return pipeline.ArtifactInput{}, errors.New(`"json" artifact requires object "data"`)
		}
		return art, nil
	default:
		return pipeline.ArtifactInput{}, fmt.Errorf("unknown artifact kind %q", art.Kind)
	}
}

// requireFields checks each named field is present (non-null) in the raw
// object. Type correctness is enforced by the strict json.Unmarshal into the
// typed struct; presence is what the JSON tags cannot assert.
func requireFields(obj map[string]json.RawMessage, keys ...string) error {
	for _, k := range keys {
		v, ok := obj[k]
		if !ok || string(v) == "null" {
			return fmt.Errorf("missing field %q", k)
		}
	}
	return nil
}

// fileExists reports whether path names an existing file. The findings drop's
// existence (not contents) is the stage completion signal.
func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func hasTrailingNewline(s string) bool {
	return s != "" && s[len(s)-1] == '\n'
}

// trimLine strips a trailing CR/LF and surrounding ASCII whitespace so blank
// lines are skipped and CRLF files parse the same as LF.
func trimLine(s string) string {
	// Drop trailing newline / carriage return first, then trim spaces/tabs.
	for s != "" && (s[len(s)-1] == '\n' || s[len(s)-1] == '\r') {
		s = s[:len(s)-1]
	}
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t') {
		end--
	}
	return s[start:end]
}
