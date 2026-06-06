import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * `/reviews` is the legacy v1 surface — replaced by `/pipelines` in v2. We
 * keep a permanent redirect so external bookmarks and tab links don't
 * 404 during the transition.
 */
export default async function ReviewsRedirect(props: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await props.searchParams;
  redirect(project ? `/pipelines?project=${encodeURIComponent(project)}` : "/pipelines");
}
