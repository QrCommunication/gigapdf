export default function AuthLayout(props: {
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      {props.children}
    </div>
  );
}
