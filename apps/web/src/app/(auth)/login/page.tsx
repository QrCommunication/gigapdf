import { LoginForm } from "@/components/auth/login-form";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to your GigaPDF account",
};

export default function LoginPage() {
  return <LoginForm />;
}
