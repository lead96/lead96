import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo height={30} />
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
