import { Logo } from "@/components/logo";

export default function AuthLayout(props: {
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <div className="mb-8">
        <Logo href="/" size="lg" />
      </div>
      {props.children}
    </div>
  );
}
