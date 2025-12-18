import Image from "next/image";
import Link from "next/link";

export default function AuthLayout(props: {
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Link href="/" className="mb-8">
        <Image
          src="/logo.png"
          alt="GigaPDF"
          width={180}
          height={81}
          className="h-12 w-auto"
          priority
        />
      </Link>
      {props.children}
    </div>
  );
}
