import { Card, EmptyState, PageHeader, type Icon } from "@/components/ui";

/** Placeholder for screens delivered in later milestones. */
export function ComingSoon({ title, description, icon, preview }: { title: string; description: string; icon: Icon; preview: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <EmptyState icon={icon} title="Coming soon" description={preview} />
      </Card>
    </>
  );
}
