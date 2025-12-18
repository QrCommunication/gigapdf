import { RegisterForm } from "@/components/auth/register-form";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign Up",
  description: "Create a new GigaPDF account",
};

export default function RegisterPage() {
  return <RegisterForm />;
}
