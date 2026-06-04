import type { Metadata } from "next";

import { PipelineWorkbench } from "@/components/PipelineWorkbench";
import { listRunsAcrossProjects } from "@/lib/pipelines";
import { resolveDashboardProjectFilter } from "@/lib/dashboard-page-data";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  searchParams: Promise<{ project?: string }>;
}): Promise<Metadata> {
  const searchParams = await props.searchParams;
  const projectFilter = resolveDashboardProjectFilter(searchParams.project);
  const label = projectFilter && projectFilter !== "all" ? projectFilter : "all projects";
  return { title: { absolute: `ao | pipelines · ${label}` } };
}

export default async function PipelinesPage(props: {
  searchParams: Promise<{ project?: string }>;
}) {
  const searchParams = await props.searchParams;
  const projectFilter = resolveDashboardProjectFilter(searchParams.project);
  const filter = projectFilter && projectFilter !== "all" ? projectFilter : undefined;
  const initial = await listRunsAcrossProjects(filter);

  return <PipelineWorkbench initialRuns={initial.runs} projectFilter={filter ?? null} />;
}
