import { homedir } from "node:os";
import { join } from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import {
  loadGlobalConfig,
  registerProjectInGlobalConfig,
  StorageKeyCollisionError,
} from "@aoagents/ao-core";
import { revalidatePath } from "next/cache";
import { getAllProjects } from "@/lib/project-name";
import { invalidatePortfolioServicesCache } from "@/lib/services";

export const dynamic = "force-dynamic";

function sanitizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function expandHomePath(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return join(homedir(), input.slice(2));
  return input;
}

function revalidatePortfolioPaths(projectId: string): void {
  for (const route of ["/", "/orchestrators", "/prs", `/projects/${projectId}`]) {
    try {
      revalidatePath(route);
    } catch {
      // Route tests do not run inside a full Next.js revalidation context.
    }
  }
}

export async function GET() {
  try {
    const projects = getAllProjects();
    return NextResponse.json({ projects });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load projects" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const projectId = sanitizeString(body["projectId"]);
  const name = sanitizeString(body["name"]) ?? projectId;
  const rawPath = sanitizeString(body["path"]);
  const allowStorageKeyReuse = body["allowStorageKeyReuse"] === true;

  if (!projectId) {
    return NextResponse.json({ error: "Project ID is required." }, { status: 400 });
  }
  if (!rawPath) {
    return NextResponse.json({ error: "Repository path is required." }, { status: 400 });
  }

  try {
    registerProjectInGlobalConfig(
      projectId,
      name ?? projectId,
      expandHomePath(rawPath),
      undefined,
      { allowStorageKeyReuse },
    );
    invalidatePortfolioServicesCache();
    revalidatePortfolioPaths(projectId);
    return NextResponse.json({ ok: true, projectId }, { status: 201 });
  } catch (err) {
    if (err instanceof StorageKeyCollisionError) {
      const globalConfig = loadGlobalConfig();
      const existingPath = globalConfig?.projects[err.existingProjectId]?.path;
      const suggestion =
        existingPath === expandHomePath(rawPath) ? "open-existing" : "register-as-second";

      return NextResponse.json(
        {
          error: err.message,
          existingProjectId: err.existingProjectId,
          suggestion,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to add project" },
      { status: 400 },
    );
  }
}
