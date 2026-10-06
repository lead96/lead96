import { Card, PageHeader } from "@/components/ui";

/** Placeholder for screens delivered in later milestones. */
export function ComingSoon({ title, description, milestone }: { title: string; description: string; milestone: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card className="p-10 text-center">
        <p className="text-sm font-medium text-slate-700">Coming soon</p>
        <p className="mt-1 text-sm text-slate-500">This screen is delivered in {milestone}.</p>
      </Card>
    </>
  );
}
